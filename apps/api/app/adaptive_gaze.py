from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import os
import tempfile
import time


def _install_numpy_pickle_compat(np) -> None:
    """Load models saved by NumPy 2 while MediaPipe keeps this runtime on NumPy 1.26."""
    import sys

    sys.modules.setdefault("numpy._core", np.core)
    sys.modules.setdefault("numpy._core.numeric", np.core.numeric)
    sys.modules.setdefault("numpy._core.multiarray", np.core.multiarray)
    sys.modules.setdefault("numpy._core.umath", np.core.umath)


@dataclass(frozen=True)
class GazeOutput:
    point_x: float
    point_y: float
    ear: float
    omega_x: float
    omega_y: float
    error_x: float
    error_y: float
    deadzone: float
    calibration_active: bool
    is_blinking: bool
    saccade_braking: bool
    ready: bool
    learning_enabled: bool
    update_count: int


class OnlinePPOTrainer:
    def __init__(self, model, base_model_path: str, personalized_model_path: str, buffer_size: int = 90, lr: float = 1e-4):
        import torch

        self.torch = torch
        self.model = model
        self.policy = model.policy
        self.base_model_path = base_model_path
        self.personalized_model_path = personalized_model_path
        self.buffer_size = buffer_size
        self.optimizer = torch.optim.Adam(self.policy.parameters(), lr=lr)
        self.update_count = 0
        self.recent_avg_reward = 0.0
        self.clear()

    def clear(self) -> None:
        self.obs_list = []
        self.action_list = []
        self.reward_list = []
        self.value_list = []
        self.log_prob_list = []

    def sample_action(self, obs, deterministic: bool):
        torch = self.torch
        obs_tensor = torch.as_tensor(obs, dtype=torch.float32, device=self.model.device).unsqueeze(0)
        with torch.no_grad():
            if deterministic:
                dist = self.policy.get_distribution(obs_tensor)
                action = dist.mode()
                log_prob = dist.log_prob(action)
                value = self.policy.predict_values(obs_tensor)
            else:
                action, value, log_prob = self.policy(obs_tensor)
        return action.squeeze(0).cpu().numpy(), value.squeeze(0).item(), log_prob.squeeze(0).item()

    def store(self, obs, action, reward: float, value: float, log_prob: float) -> None:
        self.obs_list.append(obs)
        self.action_list.append(action)
        self.reward_list.append(reward)
        self.value_list.append(value)
        self.log_prob_list.append(log_prob)
        if len(self.obs_list) >= self.buffer_size:
            self.train()

    def train(self) -> None:
        import numpy as np

        torch = self.torch
        try:
            obs_t = torch.as_tensor(np.array(self.obs_list), dtype=torch.float32, device=self.model.device)
            actions_t = torch.as_tensor(np.array(self.action_list), dtype=torch.float32, device=self.model.device)
            old_log_probs_t = torch.as_tensor(np.array(self.log_prob_list), dtype=torch.float32, device=self.model.device)
            old_values_t = torch.as_tensor(np.array(self.value_list), dtype=torch.float32, device=self.model.device)
            rewards_t = torch.as_tensor(np.array(self.reward_list), dtype=torch.float32, device=self.model.device)
            self.recent_avg_reward = float(rewards_t.mean().item())
            advantages = (rewards_t - old_values_t).detach()
            if advantages.std() > 1e-6:
                advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
            self.optimizer.zero_grad()
            values, log_prob, entropy = self.policy.evaluate_actions(obs_t, actions_t)
            ratio = torch.exp(log_prob - old_log_probs_t)
            policy_loss = -torch.min(advantages * ratio, advantages * torch.clamp(ratio, 0.85, 1.15)).mean()
            value_loss = torch.nn.functional.mse_loss(values.squeeze(-1), rewards_t)
            entropy_loss = -torch.mean(entropy) if entropy is not None else 0.0
            loss = policy_loss + 0.5 * value_loss + 0.01 * entropy_loss
            # backward()/step()은 NaN·Inf에도 예외 없이 조용히 발산한 가중치를 만들 수
            # 있어서, 명시적으로 유한성을 확인해 "실패"로 취급한다.
            if not torch.isfinite(loss):
                raise RuntimeError(f"non-finite PPO loss: {loss.item()!r}")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.policy.parameters(), 0.5)
            self.optimizer.step()
            self.update_count += 1
            self.clear()
        except Exception:
            # 학습 한 스텝이 실패하면(텐서 오류, NaN 발산 등) 이 실패를 밖으로 던져서
            # 비전 파이프라인 전체를 죽이는 대신, 기본 모델로 되돌리고 버퍼를 비운다
            # (reset()이 이미 그 일을 함 — 개인화 가중치 파일도 같이 삭제된다).
            self.reset()

    def save(self) -> None:
        directory = os.path.dirname(self.personalized_model_path)
        with tempfile.TemporaryDirectory(dir=directory) as temp_dir:
            temp_base = os.path.join(temp_dir, "personalized")
            self.model.save(temp_base)
            temp_zip = f"{temp_base}.zip"
            from stable_baselines3 import PPO

            PPO.load(temp_zip)
            os.replace(temp_zip, self.personalized_model_path)

    def reset(self) -> None:
        from stable_baselines3 import PPO

        import numpy as np
        _install_numpy_pickle_compat(np)

        base_model = PPO.load(self.base_model_path)
        self.model.policy.load_state_dict(base_model.policy.state_dict())
        self.clear()
        self.update_count = 0
        self.recent_avg_reward = 0.0
        if os.path.exists(self.personalized_model_path):
            os.remove(self.personalized_model_path)


class AdaptiveGazeController:
    def __init__(self, base_model_path: str, personalized_model_path: str) -> None:
        import numpy as np
        from stable_baselines3 import PPO

        _install_numpy_pickle_compat(np)

        model_path = personalized_model_path if os.path.exists(personalized_model_path) else base_model_path
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Missing gaze model: {model_path}")
        self.np = np
        self.model = PPO.load(model_path)
        self.trainer = OnlinePPOTrainer(self.model, base_model_path, personalized_model_path)
        self.learning_enabled = True
        self.c = np.zeros(2, dtype=np.float32)
        self.initial_calib_done = False
        self.base_d = 0.03
        self.base_kp = 1.0
        self.d = self.base_d
        self.kp = self.base_kp
        self.u_filtered = np.zeros(2, dtype=np.float32)
        self.obs_buffer = deque(maxlen=15)
        self.prev_u = np.zeros(2, dtype=np.float32)
        self.prev_v = np.zeros(2, dtype=np.float32)
        self.prev_omega = np.zeros(2, dtype=np.float32)
        self.zero_crossings = 0.0
        self.last_time = time.time()

    def set_learning(self, enabled: bool) -> None:
        self.learning_enabled = enabled

    def save(self) -> None:
        self.trainer.save()

    def reset(self) -> None:
        self.trainer.reset()
        self.c.fill(0.0)
        self.initial_calib_done = False
        self.d = self.base_d
        self.kp = self.base_kp
        self.u_filtered.fill(0.0)
        self.obs_buffer.clear()
        self.prev_u.fill(0.0)
        self.prev_v.fill(0.0)
        self.prev_omega.fill(0.0)
        self.zero_crossings = 0.0
        self.last_time = time.time()

    def handle_face_lost(self) -> None:
        self.obs_buffer.clear()
        self.prev_u = self.u_filtered.copy()
        self.prev_v.fill(0.0)
        self.prev_omega.fill(0.0)
        self.zero_crossings = 0.0
        self.last_time = time.time()

    def recenter(self) -> None:
        if not self.initial_calib_done:
            return
        self.c = self.u_filtered.copy()
        self.obs_buffer.clear()
        self.prev_u = self.u_filtered.copy()
        self.prev_v.fill(0.0)
        self.prev_omega.fill(0.0)
        self.zero_crossings = 0.0
        self.last_time = time.time()

    def get_iris_center(self, landmarks):
        np = self.np
        left_inner = np.array([landmarks[133].x, landmarks[133].y])
        left_outer = np.array([landmarks[33].x, landmarks[33].y])
        right_inner = np.array([landmarks[362].x, landmarks[362].y])
        right_outer = np.array([landmarks[263].x, landmarks[263].y])
        left_width = np.linalg.norm(left_outer - left_inner) + 1e-6
        right_width = np.linalg.norm(right_outer - right_inner) + 1e-6
        left_ear = np.linalg.norm(np.array([landmarks[159].x, landmarks[159].y]) - np.array([landmarks[145].x, landmarks[145].y])) / left_width
        right_ear = np.linalg.norm(np.array([landmarks[386].x, landmarks[386].y]) - np.array([landmarks[374].x, landmarks[374].y])) / right_width
        left_iris = np.array([landmarks[468].x, landmarks[468].y])
        right_iris = np.array([landmarks[473].x, landmarks[473].y])
        dx = ((left_iris[0] - (left_inner[0] + left_outer[0]) / 2) / left_width + (right_iris[0] - (right_inner[0] + right_outer[0]) / 2) / right_width) / 2
        dy = ((left_iris[1] - (left_inner[1] + left_outer[1]) / 2) / left_width + (right_iris[1] - (right_inner[1] + right_outer[1]) / 2) / right_width) / 2
        return np.array([dx * 4.5, dy * 9.0], dtype=np.float32), float((left_ear + right_ear) / 2)

    def update(self, landmarks) -> GazeOutput:
        np = self.np
        now = time.time()
        dt = now - self.last_time
        self.last_time = now
        u_raw, ear = self.get_iris_center(landmarks)
        is_blinking = ear < 0.2
        if not is_blinking:
            self.u_filtered = 0.6 * u_raw + 0.4 * self.u_filtered
        u = self.u_filtered.copy()
        v = u - self.prev_u
        gaze_speed_y = abs(float(v[1])) / (dt + 1e-6)
        if abs(v[0]) > 0.025 or abs(v[1]) > 0.025:
            self.zero_crossings = min(10.0, self.zero_crossings + 1.0) if (v[0] * self.prev_v[0] < 0 or v[1] * self.prev_v[1] < 0) else max(0.0, self.zero_crossings - 0.4)
            self.prev_v = v.copy()
        else:
            self.zero_crossings = max(0.0, self.zero_crossings - 0.5)
        self.prev_u = u.copy()
        # Match the reference loop after initialization. Only the very first
        # zero-point buffer excludes closed-eye frames so startup cannot snap
        # to a blink; established sessions keep the original held-value input.
        if self.initial_calib_done or not is_blinking:
            self.obs_buffer.append([float(u[0]), float(u[1])])
        omega = np.zeros(2, dtype=np.float32)
        x_err = np.zeros(2, dtype=np.float32)
        calibration_active = False
        saccade_braking = gaze_speed_y > 1.6
        if len(self.obs_buffer) == self.obs_buffer.maxlen:
            var = np.var(np.array(self.obs_buffer), axis=0)
            variance_sum = float(np.sum(var))
            if not self.initial_calib_done:
                self.c = u.copy()
                self.initial_calib_done = True
            x_err_raw = u - self.c
            obs = np.concatenate([x_err_raw, v, var, [float(self.zero_crossings)]]).astype(np.float32)
            action, value, log_prob = self.trainer.sample_action(obs, deterministic=not self.learning_enabled)
            self.d = float(np.clip(self.base_d + action[0] * 0.02, 0.02, 0.12))
            self.kp = float(np.clip(self.base_kp + action[1] * 0.5, 0.7, 3.5))
            calib_rate = float(np.clip(0.08 + action[2] * 0.04, 0.02, 0.15))
            var_threshold = float(np.clip(0.0007 + action[3] * 0.0002, 0.0001, 0.0011))
            gaze_dist = float(np.hypot(*x_err_raw))
            weight = float(np.exp(-(gaze_dist**2) / (2 * 0.08**2)))
            effective_rate = calib_rate * weight
            self.c = (1 - effective_rate) * self.c + effective_rate * u
            if variance_sum < var_threshold and weight > 0.25:
                calibration_active = True
                self.d = 0.15
            x_err = u - self.c
            if not is_blinking and not saccade_braking:
                for i in range(2):
                    if x_err[i] > self.d:
                        omega[i] = self.kp * (x_err[i] - self.d)
                    elif x_err[i] < -self.d:
                        omega[i] = self.kp * (x_err[i] + self.d)
                omega = np.clip(omega, -1.5, 1.5)
            if self.learning_enabled and not is_blinking and not saccade_braking:
                reward = -2.0 * float(np.sum((omega - self.prev_omega) ** 2))
                if self.zero_crossings > 4.0:
                    reward -= 5.0 * float(np.sum(np.abs(omega)))
                if variance_sum < var_threshold and float(np.hypot(*x_err)) <= self.d * 1.5:
                    lock_quality = max(0.0, 1.0 - float(np.hypot(*x_err)) / (self.d * 1.5 + 1e-6))
                    reward += 5.0 + 5.0 * lock_quality
                elif variance_sum < var_threshold:
                    reward -= (8.0 + 7.0 * (1.0 - weight)) * float(np.sum(np.abs(x_err)))
                self.trainer.store(obs, action, reward, value, log_prob)
        self.prev_omega = omega.copy()
        return GazeOutput(
            point_x=max(0.0, min(1.0, 0.5 + float(x_err[0]) / 0.3)),
            point_y=max(0.0, min(1.0, 0.5 + float(x_err[1]) / 0.3)),
            ear=ear,
            omega_x=float(omega[0]),
            omega_y=float(omega[1]),
            error_x=float(x_err[0]),
            error_y=float(x_err[1]),
            deadzone=float(self.d),
            calibration_active=calibration_active,
            is_blinking=is_blinking,
            saccade_braking=saccade_braking,
            ready=self.initial_calib_done,
            learning_enabled=self.learning_enabled,
            update_count=self.trainer.update_count,
        )
