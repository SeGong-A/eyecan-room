#!/Users/sehyunpark/eyecan-room/apps/api/.venv/bin/python
# -*- coding: utf-8 -*-
import os
import sys
import time
from collections import deque
import cv2
import numpy as np
import torch
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from stable_baselines3 import PPO

# ======================================================================
# [섹션 0] 화면(모니터) 해상도 자동 감지 및 반응형 크기 설정
# ======================================================================
# 1) pyautogui를 통해 현재 사용자의 물리적 모니터 디스플레이 해상도를 실시간으로 가져옵니다.
# 2) 만약 권한 거부, SSH 원격 접속, Docker 등 디스플레이 핸들이 없는 환경인 경우
#    프로그램 크래시를 방지하기 위해 가장 표준적인 FHD 해상도(1920x1080)로 안전하게 Fallback합니다.
try:
    import pyautogui
    SCREEN_W, SCREEN_H = pyautogui.size()
    print(f">>> [모니터 해상도 자동 감지]: {SCREEN_W} x {SCREEN_H}")
except Exception:
    SCREEN_W, SCREEN_H = 1920, 1080
    print(f">>> [모니터 감지 실패, 기본 해상도 적용]: {SCREEN_W} x {SCREEN_H}")

# 3) 파일 시스템 경로 설정:
#    터미널의 현재 작업 위치(CWD)와 상관없이 모델 및 Task 파일을 정확히 로드하기 위해
#    스크립트 파일이 위치한 디렉터리를 기준으로 절대 경로를 생성합니다.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(SCRIPT_DIR)
BASE_MODEL_PATH = os.path.join(SCRIPT_DIR, "residual_gaze_model_v3")                      # 사전 학습된 초기 가중치
PERSONAL_MODEL_PATH = os.path.join(SCRIPT_DIR, "residual_gaze_model_v3_personalized.zip")  # 사용자 맞춤형 온라인 학습 가중치

# ======================================================================
# [섹션 1] 실시간 온라인 강화학습 어댑터 (Online PPO Continual Learner)
# ======================================================================
class OnlinePPOTrainer:
    """
    사용자가 시선으로 화면을 조작하는 동안 실시간 경험 데이터(State, Action, Reward)를 버퍼링하고,
    N프레임마다 PPO 정책 신경망을 미세 조정(Fine-tuning)하여 사용자 개인의 눈 특성에 맞추는 트레이너.
    """
    def __init__(self, model, buffer_size=90, lr=1e-4):
        # 1) 사전 학습된 PPO 모델 및 정책망(Actor-Critic) 참조
        self.model = model
        self.policy = model.policy
        # 2) 버퍼 크기: 90프레임(3.0초 분량) 단위로 미니배치 학습 수행
        self.buffer_size = buffer_size
        # 3) 학습률(Learning Rate): 실시간 파라미터가 급격히 튀지 않도록 안전한 미세 학습률(1e-4) 적용
        self.optimizer = torch.optim.Adam(self.policy.parameters(), lr=lr)
        
        # 4) 경험 데이터 수집 리스트
        self.obs_list = []        # 7차원 상태 벡터 리스트
        self.action_list = []     # 4차원 잔차 행동 리스트 (dD, dKp, calib_rate, dVar_thresh)
        self.reward_list = []     # 실시간 계산된 보상 리스트
        self.value_list = []      # Critic 신경망이 예측한 상태 가치(Value) 리스트
        self.log_prob_list = []   # 행동 선택 당시의 로그 확률 리스트
        
        # 5) 학습 모니터링 통계 변수
        self.update_count = 0        # 총 온라인 역전파 업데이트 횟수
        self.recent_avg_reward = 0.0 # 최근 배치 평균 보상값

    def sample_action(self, obs, deterministic=False):
        """
        현재 7차원 상태 벡터를 입력받아 행동(Action), 상태 가치(Value), 로그 확률을 출력합니다.
        - deterministic=False: 온라인 학습 중 미세 탐색(Exploration)을 수행하여 더 나은 제어값 탐색
        - deterministic=True: 학습 일시정지 시 평균값 기반의 확정적 제어 수행
        """
        # numpy 배열을 파이토치 텐서로 변환 (배치 차원 1 추가: [1, 7])
        obs_tensor = torch.as_tensor(obs, dtype=torch.float32, device=self.model.device).unsqueeze(0)
        with torch.no_grad():
            if deterministic:
                dist = self.policy.get_distribution(obs_tensor)
                action = dist.mode()                # 확률 분포의 최빈값(평균) 선택
                log_prob = dist.log_prob(action)
                value = self.policy.predict_values(obs_tensor)
            else:
                # 확률 분포에서 행동을 샘플링하고 가치와 로그 확률을 동시 계산
                action, value, log_prob = self.policy(obs_tensor)
        return action.squeeze(0).cpu().numpy(), value.squeeze(0).item(), log_prob.squeeze(0).item()

    def store_transition(self, obs, action, reward, value, log_prob):
        """
        실시간 프레임에서 발생한 1스텝의 경험 데이터를 리스트에 추가합니다.
        버퍼가 목표 크기(90개)에 도달하면 즉시 학습(train_step)을 실행합니다.
        """
        self.obs_list.append(obs)
        self.action_list.append(action)
        self.reward_list.append(reward)
        self.value_list.append(value)
        self.log_prob_list.append(log_prob)

        if len(self.obs_list) >= self.buffer_size:
            self.train_step()

    def train_step(self):
        """
        수집된 90개의 미니배치를 기반으로 PPO Clipped Surrogate 손실을 계산하고 1-Epoch 역전파를 수행합니다.
        연산 시간은 약 1~3ms로, 30 FPS 비디오 렌더링에 지연을 주지 않습니다.
        """
        # 1) 수집된 리스트들을 파이토치 텐서로 변환
        obs_t = torch.as_tensor(np.array(self.obs_list), dtype=torch.float32, device=self.model.device)
        actions_t = torch.as_tensor(np.array(self.action_list), dtype=torch.float32, device=self.model.device)
        old_log_probs_t = torch.as_tensor(np.array(self.log_prob_list), dtype=torch.float32, device=self.model.device)
        old_values_t = torch.as_tensor(np.array(self.value_list), dtype=torch.float32, device=self.model.device)
        rewards_t = torch.as_tensor(np.array(self.reward_list), dtype=torch.float32, device=self.model.device)

        self.recent_avg_reward = float(rewards_t.mean().item())

        # 2) Advantage(어드밴티지 = 실제 보상 - Critic 예측 가치) 계산 및 정규화
        advantages = (rewards_t - old_values_t).detach()
        if advantages.std() > 1e-6:
            advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

        # 3) PPO 손실 함수 계산
        self.optimizer.zero_grad()
        values, log_prob, entropy = self.policy.evaluate_actions(obs_t, actions_t)
        
        # 중요도 비율 (Importance Sampling Ratio) r(θ) = exp(log π_new - log π_old)
        ratio = torch.exp(log_prob - old_log_probs_t)
        
        # PPO 클리핑 목적함수 L_CLIP = min(r * A, clip(r, 0.85, 1.15) * A)
        policy_loss_1 = advantages * ratio
        policy_loss_2 = advantages * torch.clamp(ratio, 0.85, 1.15)
        policy_loss = -torch.min(policy_loss_1, policy_loss_2).mean()
        
        # Critic 가치 함수 손실 (MSE Loss)
        value_loss = torch.nn.functional.mse_loss(values.squeeze(-1), rewards_t)
        # 탐색 유지를 위한 엔트로피 보너스
        entropy_loss = -torch.mean(entropy) if entropy is not None else 0.0

        # 최종 통합 손실 함수 역전파
        loss = policy_loss + 0.5 * value_loss + 0.01 * entropy_loss
        loss.backward()
        # 그래디언트 폭주 방지를 위한 클리핑
        torch.nn.utils.clip_grad_norm_(self.policy.parameters(), 0.5)
        self.optimizer.step()

        self.update_count += 1
        # 다음 배치를 위해 경험 버퍼 초기화
        self.obs_list.clear()
        self.action_list.clear()
        self.reward_list.clear()
        self.value_list.clear()
        self.log_prob_list.clear()

    def reset_to_base(self):
        """
        'R' 키를 눌렀을 때 실행되며, 온라인 학습된 가중치를 버리고 원본 기본 모델(residual_gaze_model)로 초기화합니다.
        """
        base_m = PPO.load(BASE_MODEL_PATH)
        self.model.policy.load_state_dict(base_m.policy.state_dict())
        self.obs_list.clear()
        self.action_list.clear()
        self.reward_list.clear()
        self.value_list.clear()
        self.log_prob_list.clear()
        self.update_count = 0
        self.recent_avg_reward = 0.0
        # 디스크에 저장된 이전 개인화 모델 파일 삭제
        if os.path.exists(PERSONAL_MODEL_PATH):
            try:
                os.remove(PERSONAL_MODEL_PATH)
            except Exception:
                pass


# ======================================================================
# [섹션 2] 가상의 방(Virtual Room) 렌더링 - 1점 투시 원근법 & 다양한 가구 배치
# ======================================================================
# 전체 방의 파노라마 월드 캔버스 크기 (모니터 전체 해상도와 동일하게 동적 설정)
world_w, world_h = SCREEN_W, SCREEN_H
virtual_world = np.zeros((world_h, world_w, 3), dtype=np.uint8)

# 1) 1점 원근법(1-Point Perspective) 기준점 계산:
#    화면 중앙을 소실점(Vanishing Point)으로 두고, 정면 벽의 상/하/좌/우 비율 경계를 설정합니다.
x_in_l = int(world_w * 0.208)  # 정면 벽 좌측 x좌표 (20.8%)
x_in_r = int(world_w * 0.792)  # 정면 벽 우측 x좌표 (79.2%)
y_in_t = int(world_h * 0.185)  # 정면 벽 상단 y좌표 (18.5%)
y_in_b = int(world_h * 0.815)  # 정면 벽 하단 y좌표 (81.5%)

# 2) 5개 면 다각형 좌표 정의 (천장, 바닥, 좌측벽, 우측벽, 정면벽)
pts_ceiling = np.array([[0, 0], [world_w, 0], [x_in_r, y_in_t], [x_in_l, y_in_t]], np.int32)
pts_floor = np.array([[0, world_h], [world_w, world_h], [x_in_r, y_in_b], [x_in_l, y_in_b]], np.int32)
pts_left = np.array([[0, 0], [x_in_l, y_in_t], [x_in_l, y_in_b], [0, world_h]], np.int32)
pts_right = np.array([[world_w, 0], [x_in_r, y_in_t], [x_in_r, y_in_b], [world_w, world_h]], np.int32)
pts_back = np.array([[x_in_l, y_in_t], [x_in_r, y_in_t], [x_in_r, y_in_b], [x_in_l, y_in_b]], np.int32)

# 3) 벽면 기본 베이스 색상 및 명암 채우기
cv2.fillPoly(virtual_world, [pts_ceiling], (225, 225, 230))  # 밝은 웜그레이 천장
cv2.fillPoly(virtual_world, [pts_floor], (55, 75, 95))       # 다크 네이비 우드 바닥
cv2.fillPoly(virtual_world, [pts_left], (150, 150, 155))     # 좌측 그림자 벽면
cv2.fillPoly(virtual_world, [pts_right], (130, 130, 135))    # 우측 그림자 벽면
cv2.fillPoly(virtual_world, [pts_back], (180, 180, 185))     # 정면 밝은 벽면

# 4) 벽면 모서리 몰딩 라인 렌더링
cv2.polylines(virtual_world, [pts_ceiling, pts_floor, pts_left, pts_right, pts_back], True, (90, 90, 95), 2)

# ----------------------------------------------------------------------
# [가구 1] 천장 모던 펜던트 조명 (Pendant Light with Warm Glow)
# ----------------------------------------------------------------------
lamp_x, lamp_y = world_w // 2, int(world_h * 0.12)
cv2.line(virtual_world, (lamp_x, 0), (lamp_x, lamp_y), (40, 40, 40), 3)  # 천장 전선 줄
# 조명 갓 (사다리꼴 다각형)
lamp_pts = np.array([
    [lamp_x - 35, lamp_y + 20], [lamp_x + 35, lamp_y + 20],
    [lamp_x + 18, lamp_y], [lamp_x - 18, lamp_y]
], np.int32)
cv2.fillPoly(virtual_world, [lamp_pts], (30, 30, 35))
# 따뜻한 반투명 조명 글로우(Glow) 효과 레이어 합성
light_overlay = virtual_world.copy()
cv2.circle(light_overlay, (lamp_x, lamp_y + 22), 70, (160, 240, 255), -1)
cv2.addWeighted(light_overlay, 0.25, virtual_world, 0.75, 0, virtual_world)
cv2.circle(virtual_world, (lamp_x, lamp_y + 22), 12, (200, 255, 255), -1)  # 전구 발광 중심

# ----------------------------------------------------------------------
# [가구 2] 정면 벽 창문 (Window with Sky & Mountain View)
# ----------------------------------------------------------------------
win_x1, win_y1 = int(world_w * 0.235), int(world_h * 0.25)
win_x2, win_y2 = int(world_w * 0.385), int(world_h * 0.53)
cv2.rectangle(virtual_world, (win_x1, win_y1), (win_x2, win_y2), (245, 210, 140), -1)  # 푸른 하늘
# 창문 밖 산 능선 렌더링
mtn_pts1 = np.array([[win_x1, win_y2], [win_x1 + 60, win_y1 + 100], [win_x1 + 140, win_y2]], np.int32)
cv2.fillPoly(virtual_world, [mtn_pts1], (120, 160, 100))
mtn_pts2 = np.array([[win_x1 + 90, win_y2], [win_x1 + 170, win_y1 + 80], [win_x2, win_y2]], np.int32)
cv2.fillPoly(virtual_world, [mtn_pts2], (90, 130, 80))
# 원목 프레임 및 4분할 십자 격자
cv2.rectangle(virtual_world, (win_x1, win_y1), (win_x2, win_y2), (50, 40, 30), 8)
mid_wx, mid_wy = (win_x1 + win_x2) // 2, (win_y1 + win_y2) // 2
cv2.line(virtual_world, (mid_wx, win_y1), (mid_wx, win_y2), (50, 40, 30), 6)
cv2.line(virtual_world, (win_x1, mid_wy), (win_x2, mid_wy), (50, 40, 30), 6)
cv2.putText(virtual_world, "WINDOW", (win_x1 + 25, win_y1 - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.7 * (world_w / 1920), (50, 50, 50), 2)

# ----------------------------------------------------------------------
# [가구 3] 정면 벽 스마트 TV & 미디어 콘솔 (Smart TV & Media Console)
# ----------------------------------------------------------------------
tv_x1, tv_y1 = int(world_w * 0.43), int(world_h * 0.28)
tv_x2, tv_y2 = int(world_w * 0.62), int(world_h * 0.52)
cv2.rectangle(virtual_world, (tv_x1, tv_y1), (tv_x2, tv_y2), (20, 20, 20), -1)        # 슬림 베젤
cv2.rectangle(virtual_world, (tv_x1 + 6, tv_y1 + 6), (tv_x2 - 6, tv_y2 - 6), (60, 40, 30), -1)  # 화면
cv2.circle(virtual_world, ((tv_x1 + tv_x2) // 2, (tv_y1 + tv_y2) // 2), 35, (255, 140, 40), -1)  # UI 로고
cv2.putText(virtual_world, "AI ROBOTICS", (tv_x1 + 25, tv_y1 + 40), cv2.FONT_HERSHEY_SIMPLEX, 0.75 * (world_w / 1920), (255, 255, 255), 2)
cv2.putText(virtual_world, "EyeCan PTZ Camera", (tv_x1 + 20, tv_y2 - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.65 * (world_w / 1920), (200, 230, 255), 2)

# TV 하단 원목 거실 수납장
cs_x1, cs_y1 = tv_x1 - 25, tv_y2 + 25
cs_x2, cs_y2 = tv_x2 + 25, tv_y2 + 75
cv2.rectangle(virtual_world, (cs_x1, cs_y1), (cs_x2, cs_y2), (40, 70, 110), -1)
cv2.rectangle(virtual_world, (cs_x1, cs_y1), (cs_x2, cs_y2), (25, 45, 75), 4)
# 3구 서랍장 손잡이
cv2.circle(virtual_world, (cs_x1 + 60, (cs_y1 + cs_y2) // 2), 4, (200, 200, 200), -1)
cv2.circle(virtual_world, ((cs_x1 + cs_x2) // 2, (cs_y1 + cs_y2) // 2), 4, (200, 200, 200), -1)
cv2.circle(virtual_world, (cs_x2 - 60, (cs_y1 + cs_y2) // 2), 4, (200, 200, 200), -1)

# ----------------------------------------------------------------------
# [가구 4] 정면 우측 벽걸이 선반 & 화분 (Floating Shelf & Green Plant)
# ----------------------------------------------------------------------
sh_x1, sh_y1 = int(world_w * 0.66), int(world_h * 0.32)
sh_x2, sh_y2 = int(world_w * 0.76), sh_y1 + 14
cv2.rectangle(virtual_world, (sh_x1, sh_y1), (sh_x2, sh_y2), (45, 65, 95), -1)  # 원목 선반 바
# 선반 위 책들
cv2.rectangle(virtual_world, (sh_x1 + 15, sh_y1 - 35), (sh_x1 + 30, sh_y1), (40, 40, 180), -1)
cv2.rectangle(virtual_world, (sh_x1 + 32, sh_y1 - 42), (sh_x1 + 47, sh_y1), (180, 50, 40), -1)
cv2.rectangle(virtual_world, (sh_x1 + 49, sh_y1 - 30), (sh_x1 + 64, sh_y1), (40, 150, 60), -1)
# 화분 (Pot & Green Plant Leaves)
pot_x = sh_x2 - 35
cv2.rectangle(virtual_world, (pot_x - 12, sh_y1 - 22), (pot_x + 12, sh_y1), (60, 100, 160), -1)
cv2.circle(virtual_world, (pot_x - 8, sh_y1 - 30), 12, (70, 180, 80), -1)
cv2.circle(virtual_world, (pot_x + 8, sh_y1 - 32), 14, (50, 160, 60), -1)
cv2.circle(virtual_world, (pot_x, sh_y1 - 40), 12, (90, 200, 90), -1)
cv2.putText(virtual_world, "SHELF", (sh_x1 + 20, sh_y1 - 50), cv2.FONT_HERSHEY_SIMPLEX, 0.6 * (world_w / 1920), (50, 50, 50), 2)

# ----------------------------------------------------------------------
# [가구 5] 좌측 벽 방 문 & 모던 벽시계 (Door & Wall Clock)
# ----------------------------------------------------------------------
clk_x, clk_y = int(world_w * 0.11), int(world_h * 0.28)
# 원근법 적용: 좌측 벽이므로 가로 폭을 좁게 한 타원(ellipse)으로 변경
cv2.ellipse(virtual_world, (clk_x, clk_y), (14, 32), 0, 0, 360, (240, 240, 245), -1)
cv2.ellipse(virtual_world, (clk_x, clk_y), (14, 32), 0, 0, 360, (50, 50, 55), 4)
cv2.line(virtual_world, (clk_x, clk_y), (clk_x, clk_y - 18), (30, 30, 30), 3)  # 분침
cv2.line(virtual_world, (clk_x, clk_y), (clk_x + 6, clk_y + 8), (30, 30, 30), 3)  # 시침 (원근법에 맞게 각도 조정)
cv2.circle(virtual_world, (clk_x, clk_y), 4, (0, 0, 200), -1)
cv2.putText(virtual_world, "CLOCK", (clk_x - 25, clk_y + 48), cv2.FONT_HERSHEY_SIMPLEX, 0.55 * (world_w / 1920), (50, 50, 50), 2)

# 좌측 원목 문 (소실점 투시 사다리꼴)
door_pts = np.array([
    [int(world_w * 0.04), int(world_h * 0.38)],
    [int(world_w * 0.15), int(world_h * 0.34)],
    [int(world_w * 0.15), int(world_h * 0.85)],
    [int(world_w * 0.04), int(world_h * 0.94)]
], np.int32)
cv2.fillPoly(virtual_world, [door_pts], (70, 95, 130))
cv2.polylines(virtual_world, [door_pts], True, (45, 65, 90), 5)
cv2.circle(virtual_world, (int(world_w * 0.13), int(world_h * 0.62)), 6, (220, 220, 220), -1)

# ----------------------------------------------------------------------
# [가구 6] 우측 벽 슬림 에어컨 & 대형 책장 (Air Conditioner & Bookshelf)
# ----------------------------------------------------------------------
# 에어컨
ac_pts = np.array([
    [int(world_w * 0.83), int(world_h * 0.28)],
    [int(world_w * 0.96), int(world_h * 0.20)],
    [int(world_w * 0.96), int(world_h * 0.30)],
    [int(world_w * 0.83), int(world_h * 0.36)]
], np.int32)
cv2.fillPoly(virtual_world, [ac_pts], (240, 240, 245))
cv2.polylines(virtual_world, [ac_pts], True, (180, 180, 185), 3)
cv2.putText(virtual_world, "AIR CON", (int(world_w * 0.85), int(world_h * 0.31)), cv2.FONT_HERSHEY_SIMPLEX, 0.55 * (world_w / 1920), (100, 100, 100), 2)

# 대형 책장
bs_pts = np.array([
    [int(world_w * 0.84), int(world_h * 0.40)],
    [int(world_w * 0.96), int(world_h * 0.36)],
    [int(world_w * 0.96), int(world_h * 0.88)],
    [int(world_w * 0.84), int(world_h * 0.84)]
], np.int32)
cv2.fillPoly(virtual_world, [bs_pts], (50, 75, 105))
cv2.polylines(virtual_world, [bs_pts], True, (35, 55, 80), 4)

# ----------------------------------------------------------------------
# [가구 7] 바닥 러그 & 커피 테이블 (Floor Carpet Rug & Coffee Table)
# ----------------------------------------------------------------------
rug_pts = np.array([
    [int(world_w * 0.32), int(world_h * 0.82)],
    [int(world_w * 0.68), int(world_h * 0.82)],
    [int(world_w * 0.78), int(world_h * 0.98)],
    [int(world_w * 0.22), int(world_h * 0.98)]
], np.int32)
cv2.fillPoly(virtual_world, [rug_pts], (90, 115, 140))
cv2.polylines(virtual_world, [rug_pts], True, (130, 160, 190), 3)

tbl_pts = np.array([
    [int(world_w * 0.38), int(world_h * 0.85)],
    [int(world_w * 0.62), int(world_h * 0.85)],
    [int(world_w * 0.66), int(world_h * 0.94)],
    [int(world_w * 0.34), int(world_h * 0.94)]
], np.int32)
cv2.fillPoly(virtual_world, [tbl_pts], (45, 65, 90))
cv2.polylines(virtual_world, [tbl_pts], True, (30, 45, 65), 3)
cv2.circle(virtual_world, (int(world_w * 0.46), int(world_h * 0.89)), 9, (230, 230, 240), -1)
cv2.putText(virtual_world, "COFFEE TABLE", (int(world_w * 0.44), int(world_h * 0.92)), cv2.FONT_HERSHEY_SIMPLEX, 0.5 * (world_w / 1920), (200, 200, 200), 1)

# 가상 PTZ 카메라의 뷰포트(FOV, 화각) 크기 및 초기 중앙 위치
cam_w = int(world_w * 0.60)
cam_h = int(world_h * 0.60)
cam_x = (world_w - cam_w) // 2
cam_y = (world_h - cam_h) // 2

# ======================================================================
# [섹션 3] MediaPipe Tasks 및 PPO 모델 초기화
# ======================================================================
# 1) MediaPipe 최신 Tasks API 설정 (FaceLandmarker)
TASK_PATH = os.path.join(PARENT_DIR, "face_landmarker.task")
if not os.path.exists(TASK_PATH):
    TASK_PATH = os.path.join(SCRIPT_DIR, "face_landmarker.task")

base_options = python.BaseOptions(model_asset_path=TASK_PATH)
options = vision.FaceLandmarkerOptions(
    base_options=base_options,
    running_mode=vision.RunningMode.IMAGE,
    num_faces=1,
    min_face_detection_confidence=0.5,
    min_face_presence_confidence=0.5,
    min_tracking_confidence=0.5
)
landmarker = vision.FaceLandmarker.create_from_options(options)

# 2) 강화학습 가중치 로드:
#    이전 세션에서 온라인 학습된 개인화 파일이 있으면 우선 로드하고, 없으면 기본 모델 로드
if os.path.exists(PERSONAL_MODEL_PATH):
    print(">>> [RL Model] 개인화 학습 모델 로드")
    model = PPO.load(PERSONAL_MODEL_PATH)
else:
    print(">>> [RL Model] 기본 모델 로드")
    model = PPO.load(BASE_MODEL_PATH)

online_trainer = OnlinePPOTrainer(model, buffer_size=90, lr=1e-4)
online_learning_active = True
should_quit = False

# 3) 화면 팝업 알림 메시지 제어 변수
msg_text = ""
msg_color = (0, 255, 0)
msg_expire_time = 0.0

def show_popup(text, color=(0, 255, 0), duration=2.5):
    """화면 중앙 상단에 팝업 알림 배너를 duration초 동안 표시합니다."""
    global msg_text, msg_color, msg_expire_time
    msg_text = text
    msg_color = color
    msg_expire_time = time.time() + duration

def handle_toggle_learning():
    """'L' 키 입력 핸들러: 실시간 온라인 학습 활성/일시정지 토글"""
    global online_learning_active
    online_learning_active = not online_learning_active
    if online_learning_active:
        show_popup(">> ONLINE LEARNING: ON <<", (50, 255, 50), duration=2.5)
        print(">>> [온라인 학습 토글]: 활성화 (ON)")
    else:
        show_popup(">> ONLINE LEARNING: PAUSED <<", (0, 165, 255), duration=2.5)
        print(">>> [온라인 학습 토글]: 일시정지 (OFF)")

def handle_reset_model():
    """'R' 키 입력 핸들러: 모델 가중치 원본 복원 및 영점(c) 즉시 초기화"""
    global c, initial_calib_done
    online_trainer.reset_to_base()
    c = np.zeros(2)  # 영점 초기화
    initial_calib_done = False  # 다음 감지 시 현재 시선으로 재스냅
    show_popup(">> RL MODEL RESET TO DEFAULT <<", (0, 100, 255), duration=2.5)
    print(">>> [모델 리셋]: 기본 가중치로 초기화 완료!")

def handle_save_model():
    """'S' 키 입력 핸들러: 현재 학습된 개인화 가중치 수동 디스크 저장"""
    save_target = os.path.join(SCRIPT_DIR, "residual_gaze_model_v3_personalized")
    model.save(save_target)
    show_popup(f">> SAVED (Updates: {online_trainer.update_count}) <<", (255, 255, 0), duration=2.5)
    print(f">>> [수동 저장 완료]: {save_target}.zip (총 업데이트: {online_trainer.update_count}회)")

# ======================================================================
# [섹션 4] 전역 키보드 리스너 (pynput - 창 포커스 및 한영 전환 상관없이 즉시 반응)
# ======================================================================
try:
    from pynput import keyboard as pynput_kb

    def on_press(key):
        global should_quit
        try:
            char = key.char.lower() if hasattr(key, 'char') and key.char else ''
        except Exception:
            char = ''

        # L 키 (한글 'ㅣ' 포함): 온라인 학습 토글
        if char in ['l', 'ㅣ']:
            handle_toggle_learning()
        # R 키 (한글 'ㄱ' 포함): 모델 가중치 및 영점 초기화
        elif char in ['r', 'ㄱ']:
            handle_reset_model()
        # S 키 (한글 'ㄴ' 포함): 개인화 모델 수동 저장
        elif char in ['s', 'ㄴ']:
            handle_save_model()
        # Q 키 (한글 'ㅂ' 또는 Esc): 시뮬레이터 종료
        elif char in ['q', 'ㅂ'] or key == pynput_kb.Key.esc:
            should_quit = True

    kb_listener = pynput_kb.Listener(on_press=on_press)
    kb_listener.daemon = True
    kb_listener.start()
    print(">>> [키보드 리스너]: 전역 키 감지(한영 호환) 활성화 완료")
except Exception as e:
    print(f">>> [키보드 리스너 경고]: pynput 미지원({e}), cv2.waitKey만 사용합니다.")

# ======================================================================
# [섹션 5] 시선 추적 및 제어 파라미터 상태 변수 초기화
# ======================================================================
c = np.zeros(2)       # 영점(Zero-point / 캘리브레이션 기준점): 화면 중앙 시선 위치
initial_calib_done = False # 부팅/리셋 직후 첫 시선 위치 자동 스냅 여부
base_D = 0.03         # 룰베이스 기본 데드존(Deadzone) 크기 (미세 조준을 위해 0.03으로 설정)
base_Kp = 1.0         # 룰베이스 기본 비례 게인(민감도) (부드러운 조작을 위해 1.0으로 설정)
D = base_D            # 현재 동적 데드존 (RL에 의해 실시간 보정됨)
Kp = base_Kp          # 현재 동적 민감도 (RL에 의해 실시간 보정됨)

obs_buffer = deque(maxlen=15)   # 시선 움직임 분산 및 통계를 위한 15프레임 시계열 큐
u_filtered = np.zeros(2)        # 1차 저역통과필터(EMA LPF) 상태 벡터
alpha_ema = 0.6                 # EMA 필터 가중치 
prev_u = np.zeros(2)            # 이전 프레임 시선 위치
prev_v = np.zeros(2)            # 이전 프레임 시선 속도
prev_omega = np.zeros(2)        # 이전 프레임 모터 각속도 지령
zero_crossings = 0.0            # 시선 방향 역전(떨림/헌팅) 빈도 카운터
max_gaze_speed = 1.6            # y축 시선 급변(사카딕/깜빡임) 감지 임계 각속도 (기존 0.8에서 2배 상향)
gaze_speed_y = 0.0              # 현재 계산된 y축 시선 속도
max_motor_speed = 1.5           # 하드웨어 물리적 최대 모터 각속도 클램핑 (rad/s)
stuck_wall_timer = 0.0          # 벽 충돌 지속 시간 측정 타이머 (영점 강제 리셋용)

cap = cv2.VideoCapture(0)
last_time = time.time()


def get_iris_center(landmarks):
    """
    얼굴 랜드마크에서 양쪽 눈의 내안각, 외안각, 상하 눈꺼풀, 홍채 중심을 추출하여:
    1) EAR(Eye Aspect Ratio) 기반 눈 깜빡임 여부(is_blinking)와
    2) 정규화된 시선 오프셋 벡터(dx, dy)를 계산하여 반환합니다.
    """
    # 1. 좌우 눈 내안각(Inner), 외안각(Outer), 홍채(Iris) 중심 랜드마크
    p_l_inner = np.array([landmarks[133].x, landmarks[133].y])
    p_l_outer = np.array([landmarks[33].x, landmarks[33].y])
    p_l_iris = np.array([landmarks[468].x, landmarks[468].y])

    # ------------------------------------------------------------------
    # 2. 오른쪽 눈 핵심 랜드마크 추출
    # ------------------------------------------------------------------
    # 362번: 오른쪽 눈 안쪽 모서리(내안각)
    p_r_inner = np.array([landmarks[362].x, landmarks[362].y])
    # 263번: 오른쪽 눈 바깥쪽 모서리(외안각)
    p_r_outer = np.array([landmarks[263].x, landmarks[263].y])
    # 473번: 오른쪽 눈동자(홍채, Iris) 정중앙점
    p_r_iris = np.array([landmarks[473].x, landmarks[473].y])

    # 2. 눈 깜빡임(EAR) 판정을 위한 상하 눈꺼풀 랜드마크
    p_l_top = np.array([landmarks[159].x, landmarks[159].y])
    p_l_bot = np.array([landmarks[145].x, landmarks[145].y])

    p_r_top = np.array([landmarks[386].x, landmarks[386].y])
    p_r_bot = np.array([landmarks[374].x, landmarks[374].y])

    # 3. 눈의 가로 너비(스케일 불변 정규화 기준)
    l_width = np.linalg.norm(p_l_outer - p_l_inner) + 1e-6
    r_width = np.linalg.norm(p_r_outer - p_r_inner) + 1e-6

    # 4. EAR (Eye Aspect Ratio) 연산: 세로길이 / 가로길이
    #    평균 EAR이 0.20 미만이면 눈을 감은(깜빡임) 상태로 신속 판정
    l_ear = np.linalg.norm(p_l_top - p_l_bot) / l_width
    r_ear = np.linalg.norm(p_r_top - p_r_bot) / r_width
    ear = (l_ear + r_ear) / 2.0
    is_blinking = ear < 0.20

    # ------------------------------------------------------------------
    # 6. 눈 중심 대비 홍채의 상대적 시선 변위(dx, dy) 계산
    #    - 눈 중심: (내안각 + 외안각) / 2
    #    - 눈 너비(l_width, r_width)로 나누어 정규화
    # ------------------------------------------------------------------
    l_dx = (p_l_iris[0] - (p_l_inner[0] + p_l_outer[0]) / 2) / l_width
    l_dy = (p_l_iris[1] - (p_l_inner[1] + p_l_outer[1]) / 2) / l_width

    r_dx = (p_r_iris[0] - (p_r_inner[0] + p_r_outer[0]) / 2) / r_width
    r_dy = (p_r_iris[1] - (p_r_inner[1] + p_r_outer[1]) / 2) / r_width

    dx = (l_dx + r_dx) / 2.0
    dy = (l_dy + r_dy) / 2.0

    # 6. 상하(y) 눈 움직임의 물리적 범위가 좁으므로 y축에 2배 높은 증폭 가중치(4.5 vs 9.0) 부여
    return np.array([dx * 4.5, dy * 9.0], dtype=np.float32), is_blinking


WIN_NAME = 'PTZ Camera - Gen 3 (7D Adaptive RL)'
cv2.namedWindow(WIN_NAME, cv2.WINDOW_NORMAL)
cv2.setWindowProperty(WIN_NAME, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

# ======================================================================
# [섹션 6] 메인 실시간 제어 및 시뮬레이션 루프
# ======================================================================
while cap.isOpened() and not should_quit:
    ret, frame = cap.read()
    if not ret:
        break
    frame = cv2.flip(frame, 1)  # 사용자 편의를 위한 거울 모드 좌우 반전
    h, w, _ = frame.shape

    # 1) 프레임 간 시간 간격(dt) 측정 (적분기 플랜트 구동에 사용)
    current_time = time.time()
    dt = current_time - last_time
    last_time = current_time

    # 2) MediaPipe Tasks로 얼굴 및 시선 랜드마크 감지
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
    results = landmarker.detect(mp_image)

    omega = np.zeros(2)             # 모터 각속도 제어 지령 (rad/s)
    x_err = np.zeros(2)             # 영점 기준 시선 오차 벡터
    calibration_active = False      # 자동 캘리브레이션 활성 플래그
    is_blinking = False             # 눈 감음 상태 플래그

    if results.face_landmarks:
        landmarks = results.face_landmarks[0]

        # 1. 시선 원시 신호 및 눈 깜빡임 감지
        u_raw, is_blinking = get_iris_center(landmarks)

        # 2. 저역통과필터(EMA LPF) 상태 갱신 (눈 감았을 땐 이전 상태 유지)
        if not is_blinking:
            u_filtered = alpha_ema * u_raw + (1 - alpha_ema) * u_filtered

        u = u_filtered.copy()
        v = u - prev_u                                      # 프레임당 시선 변위 벡터
        gaze_speed_y = abs(v[1]) / (dt + 1e-6)              # 깜빡임 영향이 큰 y축(상하) 시선 속도만 정밀 측정 (x축 빠른 조작은 허용)

        # 3. 방향 역전(Zero-Crossing) 헌팅 감지기:
        #    시선의 속도 부호가 연속으로 바뀌며 널뛰는(진동) 현상을 수치화 (미세 노이즈 무시 및 신속 감쇄)
        if abs(v[0]) > 0.025 or abs(v[1]) > 0.025:
            if (v[0] * prev_v[0] < 0) or (v[1] * prev_v[1] < 0):
                zero_crossings = min(10.0, zero_crossings + 1.0)
            else:
                zero_crossings = max(0.0, zero_crossings - 0.4) # 빠른 감쇄
            prev_v = v.copy()
        else:
            zero_crossings = max(0.0, zero_crossings - 0.5) # 정지 시 신속 초기화

        prev_u = u.copy()
        obs_buffer.append([u[0], u[1]])

        # 4. 시계열 버퍼가 가득 차면 잔차 강화학습 추론 및 온라인 학습 수집
        if len(obs_buffer) == obs_buffer.maxlen:
            buf_np = np.array(obs_buffer)
            var = np.var(buf_np, axis=0)        # 시선 분산 [var_x, var_y]
            variance_sum = np.sum(var)

            # -------------------------------------------------------------
            # [초기 1단계] 프로그램 시작 직후 버퍼가 처음 채워지는 순간: 현재 시선으로 초기 영점 즉시 스냅(Snap)
            # -------------------------------------------------------------
            if not initial_calib_done:
                c = u.copy()
                initial_calib_done = True
                show_popup(">> INITIAL ZERO-POINT SET <<", (0, 255, 255), duration=1.5)
                print(f">>> [초기 영점 자동 스냅 완료]: c = {c}")

            x_err_raw = u - c
            # 7차원 상태 벡터 생성: [x_err(2), v(2), var(2), zero_crossings(1)]
            obs = np.concatenate([x_err_raw, v, var, [float(zero_crossings)]]).astype(np.float32)

            # -------------------------------------------------------------
            # 1) 강화학습(RL) 에이전트가 상태(obs)를 보고 잔차 행동(Action) 샘플링
            # -------------------------------------------------------------
            action, value, log_prob = online_trainer.sample_action(
                obs, deterministic=not online_learning_active
            )

            # -------------------------------------------------------------
            # 2) 행동 디코딩 (잔차 보정): 기본값에 RL 보정값을 더하여 최종 파라미터 결정
            # -------------------------------------------------------------
            D = np.clip(base_D + action[0] * 0.02, 0.02, 0.12)           # 동적 데드존 D 보정
            Kp = np.clip(base_Kp + action[1] * 0.5, 0.7, 3.5)            # 동적 민감도 Kp 보정
            calib_rate = np.clip(0.08 + action[2] * 0.04, 0.02, 0.15)    # 캘리브레이션 속도 동적 결정
            dynamic_var_thresh = np.clip(0.0007 + action[3] * 0.0002, 0.0001, 0.0011) # 동적 분산 임계값 보정

            # -------------------------------------------------------------
            # 3) [지능형 자동 영점 조절 로직 (방법 2: 가우시안 거리 감쇄)]
            #    중앙에서 멀어질수록(스캐닝 중) 영점 당김 강도가 지수함수적으로 0에 수렴하여 멈춤 방지
            # -------------------------------------------------------------
            gaze_dist = np.hypot(x_err_raw[0], x_err_raw[1])
            att_weight = np.exp(-(gaze_dist ** 2) / (2 * (0.08 ** 2)))   # sigma=0.08
            effective_calib_rate = calib_rate * att_weight

            # 분산이 작고 + "중앙 부근(att_weight > 0.25)"일 때만 캘리브레이션 활성화
            if (variance_sum < dynamic_var_thresh) and (att_weight > 0.25):
                calibration_active = True
                c = (1 - effective_calib_rate) * c + effective_calib_rate * u
                D = 0.15  # 보정 중에는 화면이 움직이지 않도록 데드존을 넓혀 브레이크
            else:
                calibration_active = False
                c = (1 - effective_calib_rate) * c + effective_calib_rate * u

            # -------------------------------------------------------------
            # 4) [P-Controller 연산] 보정된 영점(c)을 기준으로 실제 조이스틱 제어 오차 및 속도 계산
            # -------------------------------------------------------------
            x_err = u - c

            # y축 시선 각속도가 임계값(max_gaze_speed)을 초과하거나 눈을 감은 경우:
            # 깜빡임/급격한 상하 튐으로 판정하여 모터 각속도를 0으로 즉시 제동 (x축 좌우 빠른 이동은 정상 허용)
            if is_blinking or (gaze_speed_y > max_gaze_speed):
                omega = np.zeros(2)
            else:
                for i in range(2):
                    if x_err[i] > D:
                        omega[i] = Kp * (x_err[i] - D)
                    elif x_err[i] < -D:
                        omega[i] = Kp * (x_err[i] + D)
                # 실제 하드웨어 구동 한계에 따른 최대 각속도 클램핑
                omega = np.clip(omega, -max_motor_speed, max_motor_speed)

            # -------------------------------------------------------------
            # 5) [실시간 온라인 강화학습 보상 계산 및 경험 버퍼 수집]
            # -------------------------------------------------------------
            if online_learning_active and not is_blinking and (gaze_speed_y <= max_gaze_speed):
                reward = 0.0
                jerk = np.sum((omega - prev_omega) ** 2)
                reward -= 2.0 * jerk                   # 보상 1: 제어 급변(Jerk) 억제하여 부드러움 보장
                if zero_crossings > 4.0:
                    reward -= 5.0 * np.sum(np.abs(omega)) # 보상 2: 심한 헌팅 널뛰기 시 모터 회전 억제
                # 보상 3: 목표 도달 및 안정적 응시(시선 추적 성공) 보너스 보상
                gaze_dist = np.hypot(x_err[0], x_err[1])
                if (variance_sum < dynamic_var_thresh) and (gaze_dist <= D * 1.5):
                    # 사용자가 원하는 위치에 정확히 도달하여 안정적으로 쳐다보고 있을 때 큰 양수 보상(+5.0 ~ +10.0)
                    lock_quality = max(0.0, 1.0 - (gaze_dist / (D * 1.5 + 1e-6)))
                    reward += 5.0 + 5.0 * lock_quality
                elif variance_sum < dynamic_var_thresh:
                    # 통합 영점 정렬 & 스캐닝 오작동 방지 페널티 (거리에 따라 -8.0 ~ -15.0 자동 연속 스케일링)
                    err_sum = np.sum(np.abs(x_err))
                    dynamic_calib_weight = 8.0 + 7.0 * (1.0 - att_weight)
                    reward -= dynamic_calib_weight * err_sum

                # 경험 데이터(S, A, R, V, LogProb)를 온라인 트레이너 버퍼에 저장
                online_trainer.store_transition(obs, action, float(reward), value, log_prob)

            prev_omega = omega.copy()

    # ======================================================================
    # [섹션 7] 플랜트 동역학 구동 및 가상 PTZ 카메라 뷰 크롭
    # ======================================================================
    # 각속도(omega)을 적분하여 가상 카메라 중심 위치(cam_x, cam_y) 갱신
    speed_scale = int(world_w * 0.5)
    cam_x += int(omega[0] * speed_scale * dt)
    cam_y += int(omega[1] * speed_scale * dt)

    # 카메라 화각이 가상의 방을 벗어나 가장자리(시계, 러그 등)까지 닿을 수 있도록 클램핑 범위 확장
    pad_x = cam_w // 2
    pad_y = cam_h // 2
    min_cam_x, max_cam_x = -pad_x, world_w - pad_x
    min_cam_y, max_cam_y = -pad_y, world_h - pad_y

    # 카메라가 벽 끝(한계선)에 닿아있는데도 계속 바깥쪽으로 모터 회전 지령이 들어오는지 감지
    is_at_wall_x = (cam_x <= min_cam_x and omega[0] < -D) or (cam_x >= max_cam_x and omega[0] > D)
    is_at_wall_y = (cam_y <= min_cam_y and omega[1] < -D) or (cam_y >= max_cam_y and omega[1] > D)
    is_stuck_at_wall = is_at_wall_x or is_at_wall_y

    if is_stuck_at_wall and (not is_blinking):
        stuck_wall_timer += dt
        # 1.5초 이상 벽에 부딪혀 카메라가 더 이상 움직이지 못하는 상태 지속 시:
        if stuck_wall_timer >= 1.5:
            c = u.copy()  # 영점이 완전히 틀어진 것으로 판정하고 현재 시선 위치로 강제 재영점
            stuck_wall_timer = 0.0
            calibration_active = False
            show_popup(">> AUTO RE-ZEROING (WALL STUCK) <<", (0, 200, 255), duration=2.0)
            print(f">>> [벽 충돌 지속에 따른 영점 강제 재설정 완료]: c = {c}")
    else:
        stuck_wall_timer = max(0.0, stuck_wall_timer - dt * 2.0)

    cam_x = max(min_cam_x, min(cam_x, max_cam_x))
    cam_y = max(min_cam_y, min(cam_y, max_cam_y))

    # 가상의 방 전체에서 현재 카메라가 비추는 뷰포트 영역 크롭 (여백은 검은색 처리)
    src_y1 = max(0, cam_y)
    src_y2 = min(world_h, cam_y + cam_h)
    src_x1 = max(0, cam_x)
    src_x2 = min(world_w, cam_x + cam_w)
    
    dst_y1 = max(0, -cam_y)
    dst_y2 = dst_y1 + (src_y2 - src_y1)
    dst_x1 = max(0, -cam_x)
    dst_x2 = dst_x1 + (src_x2 - src_x1)

    virtual_fov = np.zeros((cam_h, cam_w, 3), dtype=np.uint8)
    virtual_fov[dst_y1:dst_y2, dst_x1:dst_x2] = virtual_world[src_y1:src_y2, src_x1:src_x2]

    # ======================================================================
    # [섹션 8] 화면 중앙 HUD 가상 조이스틱 시각화
    # ======================================================================
    joy_center_x, joy_center_y = cam_w // 2, cam_h // 2
    joy_radius = int(min(cam_w, cam_h) * 0.24)  # 기존 0.16에서 1.5배 확장 (시각적 해상도 증대)
    scale_factor = joy_radius / 0.15  # 시선 오차(약 0.15)를 픽셀 단위로 스케일링

    # 조이스틱 스틱 노브(Knob) 위치 계산 및 클램핑
    knob_x = int(joy_center_x + (x_err[0] * scale_factor))
    knob_y = int(joy_center_y + (x_err[1] * scale_factor))
    dist = np.hypot(knob_x - joy_center_x, knob_y - joy_center_y)

    if dist > joy_radius:
        knob_x = int(joy_center_x + (knob_x - joy_center_x) * (joy_radius / dist))
        knob_y = int(joy_center_y + (knob_y - joy_center_y) * (joy_radius / dist))

    dz_pixel_radius = int(D * scale_factor)

    # 1) 조이스틱 반투명 배경 원 오버레이 (항상 유지)
    overlay = virtual_fov.copy()
    cv2.circle(overlay, (joy_center_x, joy_center_y), joy_radius, (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.3, virtual_fov, 0.7, 0, virtual_fov)

    # 2) 조이스틱 외곽 원 (항상 유지)
    cv2.circle(virtual_fov, (joy_center_x, joy_center_y), joy_radius, (255, 255, 255), 2)

    # 3~4) 움직이는 조이스틱 라인 및 노브: 캘리브레이션 중이거나 데드존 내부(정지 상태)일 때는 숨김
    #       (실제 모터가 구동될 때만 빨간색 노브 및 방향 라인 표시)
    if not calibration_active and (dist > dz_pixel_radius):
        # 3) 조이스틱 방향 벡터 라인
        cv2.line(virtual_fov, (joy_center_x, joy_center_y), (knob_x, knob_y), (200, 200, 255), 2)

        # 4) 스틱 노브 (모터 구동 중: 빨간색)
        cv2.circle(virtual_fov, (knob_x, knob_y), max(8, int(joy_radius * 0.15)), (0, 0, 255), -1)

    # 5) 화면 정중앙 십자선 (Zero-Target Crosshair) - 보정 중에는 노란색으로 강조
    cross_col = (0, 255, 255) if calibration_active else (255, 255, 255)
    cv2.line(virtual_fov, (joy_center_x - 20, joy_center_y), (joy_center_x + 20, joy_center_y), cross_col, 3)
    cv2.line(virtual_fov, (joy_center_x, joy_center_y - 20), (joy_center_x, joy_center_y + 20), cross_col, 3)

    # ======================================================================
    # [섹션 9] UI 상태 정보, 상단 대시보드 및 팝업 배너 출력
    # ======================================================================
    font_scale = 0.7 * (cam_w / 800)

    # 1. 상단 정보 대시보드 박스 배경
    box_w = int(cam_w * 0.72)
    cv2.rectangle(virtual_fov, (10, 10), (box_w, 90), (0, 0, 0), -1)
    cv2.rectangle(virtual_fov, (10, 10), (box_w, 90), (100, 100, 100), 1)

    # 2. 실시간 온라인 학습 상태 배지 (ON: 밝은 초록색, PAUSED: 주황색)
    if online_learning_active:
        status_str = f"[RL: Gen 3 (7D Adaptive ON)] Updates: {online_trainer.update_count} | Rew: {online_trainer.recent_avg_reward:.1f}"
        badge_col = (50, 255, 50)
    else:
        status_str = "[RL: Gen 3 LEARNING PAUSED] (Press 'L' to Resume)"
        badge_col = (0, 165, 255)

    cv2.putText(virtual_fov, status_str, (25, 42), cv2.FONT_HERSHEY_SIMPLEX, font_scale * 0.9, badge_col, 2)
    cv2.putText(virtual_fov, f"Kp: {Kp:.2f} | D: {D:.2f} | Key: [L] Toggle  [R] Reset  [S] Save", (25, 75), cv2.FONT_HERSHEY_SIMPLEX, font_scale * 0.75, (220, 220, 220), 1)

    # 3. 팝업 알림 메시지 오버레이 배너 (L, R, S 키 입력 시 표시)
    if time.time() < msg_expire_time:
        popup_w = int(cam_w * 0.6)
        popup_h = 45
        px1 = (cam_w - popup_w) // 2
        py1 = 110
        cv2.rectangle(virtual_fov, (px1, py1), (px1 + popup_w, py1 + popup_h), (20, 20, 20), -1)
        cv2.rectangle(virtual_fov, (px1, py1), (px1 + popup_w, py1 + popup_h), msg_color, 2)
        cv2.putText(virtual_fov, msg_text, (px1 + 20, py1 + 30), cv2.FONT_HERSHEY_SIMPLEX, font_scale * 0.9, msg_color, 2)

    # 4. 하단 상태 표시 (영점 캘리브레이션 / 눈 깜빡임 / 고속 시선 도약 브레이크)
    if calibration_active:
        cv2.putText(virtual_fov, "CALIBRATING ZERO POINT...", (int(cam_w * 0.28), cam_h - 60), cv2.FONT_HERSHEY_SIMPLEX, font_scale * 1.1, (0, 255, 255), 3)
    elif is_blinking:
        cv2.putText(virtual_fov, "BLINK DETECTED (HOLD)", (int(cam_w * 0.32), cam_h - 60), cv2.FONT_HERSHEY_SIMPLEX, font_scale * 1.0, (0, 255, 0), 2)
    elif gaze_speed_y > max_gaze_speed:
        cv2.putText(virtual_fov, "SACCADE DETECTED (Y-AXIS SPEED BRAKE)", (int(cam_w * 0.20), cam_h - 60), cv2.FONT_HERSHEY_SIMPLEX, font_scale * 1.0, (0, 200, 255), 2)

    if zero_crossings > 4.0:
        cv2.putText(virtual_fov, "RL BRAKING (Hunting Detected)", (int(cam_w * 0.25), cam_h - 25), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 255), 2)

    # 5. 우측 상단 사용자 웹캠 PIP(Picture-in-Picture) 모드 렌더링
    pip_w, pip_h = int(cam_w * 0.28), int(cam_h * 0.28)
    frame_resized = cv2.resize(frame, (pip_w, pip_h))
    virtual_fov[10:10 + pip_h, cam_w - pip_w - 10:cam_w - 10] = frame_resized
    cv2.rectangle(virtual_fov, (cam_w - pip_w - 10, 10), (cam_w - 10, 10 + pip_h), (255, 255, 255), 1)

    cv2.imshow(WIN_NAME, virtual_fov)

    # OpenCV 키보드 입력 폴백 처리
    key = cv2.waitKey(1) & 0xFF
    if key in [ord('q'), ord('Q'), 27]:
        should_quit = True
    elif key in [ord('l'), ord('L')]:
        handle_toggle_learning()
    elif key in [ord('r'), ord('R')]:
        handle_reset_model()
    elif key in [ord('s'), ord('S')]:
        handle_save_model()

# ======================================================================
# [섹션 10] 종료 및 개인화 모델 자동 저장
# ======================================================================
cap.release()
cv2.destroyAllWindows()

# 온라인 학습이 1회 이상 진행되었을 경우 종료 시 최신 개인화 가중치를 자동 저장
if online_trainer.update_count > 0:
    save_target = os.path.join(SCRIPT_DIR, "residual_gaze_model_v3_personalized")
    model.save(save_target)
    print(f"\n=======================================================")
    print(f"[개인화 온라인 모델 자동 저장 완료]")
    print(f"   - 저장 위치: {save_target}.zip")
    print(f"   - 총 실시간 정책 업데이트: {online_trainer.update_count} 회")
    print(f"=======================================================\n")