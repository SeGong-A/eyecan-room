import type { CameraStatus } from '../hooks/useCamera';
import type { FullGazeDirection } from '../types/control';

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function directionFromPoint(point: { x: number; y: number }): FullGazeDirection {
  if (point.y < 0.34) return 'UP';
  if (point.y > 0.68) return 'DOWN';
  if (point.x < 0.36) return 'LEFT';
  if (point.x > 0.64) return 'RIGHT';
  return 'CENTER';
}

export function cameraMessage(status: CameraStatus) {
  if (status === 'REQUESTING') return '카메라 연결을 기다리는 중입니다';
  if (status === 'DENIED') return '브라우저 설정에서 카메라 권한을 허용해주세요';
  if (status === 'UNAVAILABLE') return '사용할 수 있는 카메라를 찾지 못했습니다';
  if (status === 'ERROR') return '카메라 연결 중 문제가 발생했습니다';
  return '내장 카메라를 연결하면 눈의 위치를 확인할 수 있어요';
}

export function visionMessage(status: string) {
  if (status === 'STARTING') return '시선 추적 엔진을 시작하는 중입니다';
  if (status === 'RUNNING') return '시선 추적 중입니다';
  if (status === 'ERROR') return '시선 추적 엔진에서 오류가 발생했습니다';
  return '아직 시선 추적을 시작하지 않았습니다';
}
