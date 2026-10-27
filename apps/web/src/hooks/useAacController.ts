import { useCallback, useEffect, useRef, useState } from 'react';
import { aacMeta, aacRequests, inAacZone, objectItems, objectNames } from '../domain/aac';
import { holdGazeMotion } from '../lib/arduinoSerial';
import { useAppStore, type AppState } from '../store/useAppStore';
import type { AacLog, AacObjectType, AacPhase } from '../types/aac';
import type { CommandItem, Notify } from '../types/control';
import type { useSpeech } from './useSpeech';

type Props = { store: AppState; enabled: boolean; cameraReady: boolean; getCandidates: () => AacObjectType[];
  speech: ReturnType<typeof useSpeech>; notify: Notify };
type State = { phase: AacPhase; objects: AacObjectType[]; object: AacObjectType | null; generation: number; message: string };
const initial: State = { phase: 'IDLE', objects: [], object: null, generation: 0, message: '' };

export function useAacController(props: Props) {
  const latest = useRef(props); latest.current = props;
  const [state, setState] = useState<State>(initial);
  const current = useRef(state);
  const [directionReady, setDirectionReady] = useState(false);
  const down = useRef({ since: 0, stable: false });
  const closed = useRef<{ generation: number; armed: boolean; item: CommandItem | null } | null>(null);
  const lastBlink = useRef('');
  const logs = useRef<AacLog[]>([]);
  const start = useRef(performance.now());
  const feedbackTimer = useRef(0);
  const log = useCallback((event: string, detail?: string) => {
    logs.current.push({ event, detail, at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start.current) });
    if (logs.current.length > 1000) logs.current.shift();
  }, []);
  const change = useCallback((next: Partial<State>) => {
    current.current = { ...current.current, ...next, generation: current.current.generation + 1 };
    closed.current = null; setState(current.current);
  }, []);
  function inputReady() {
    const { enabled, cameraReady } = latest.current;
    const s = useAppStore.getState();
    return enabled && cameraReady && !document.hidden && !s.isPaused && !s.emergencyActive && s.faceDetected && s.gazeReady &&
      s.connectionState === 'STREAMING' && s.arduinoStatus === 'CONNECTED' && s.motionProtocolReady && s.hasArduinoAngle;
  }
  const cancel = useCallback((reason = 'cancel') => {
    window.clearTimeout(feedbackTimer.current);
    latest.current.speech.cancel();
    if (current.current.phase === 'SPEAKING') log('speech_cancel', reason);
    if (current.current.phase !== 'IDLE') log('cancel', reason);
    change({ ...initial });
  }, [change, log]);
  useEffect(() => {
    const tick = () => {
      const s = useAppStore.getState();
      const eligible = inputReady() && s.interactionMode === 'EXPLORE' && !s.activeAngleTarget &&
        inAacZone(s.arduinoLevels.pan, s.arduinoLevels.tilt, down.current.stable);
      if (!eligible) down.current = { since: 0, stable: false };
      else {
        if (!down.current.since) down.current.since = performance.now();
        if (performance.now() - down.current.since >= 500) down.current.stable = true;
      }
      setDirectionReady(down.current.stable);
    };
    tick(); const id = window.setInterval(tick, 50);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => { if (props.store.emergencyActive) cancel('emergency'); }, [props.store.emergencyActive, cancel]);
  const available = inputReady();
  useEffect(() => { if (!available) closed.current = null; }, [available]);
  useEffect(() => () => { window.clearTimeout(feedbackTimer.current); latest.current.speech.cancel(); }, []);
  const candidateKey = props.getCandidates().join(',');
  useEffect(() => { if (candidateKey) log('candidate', candidateKey); }, [candidateKey, log]);

  const onEyeClose = (item: CommandItem | null, transitioning: boolean) => {
    const s = useAppStore.getState();
    closed.current = { generation: current.current.generation,
      armed: down.current.stable && inputReady() && s.interactionMode === 'EXPLORE' && !s.activeAngleTarget && inAacZone(s.arduinoLevels.pan, s.arduinoLevels.tilt, true),
      item: inputReady() && !transitioning ? item : null };
  };
  async function enter() {
    change({ phase: 'ENTERING', message: '카메라 정지 확인 중' });
    const generation = current.current.generation;
    const stopped = await holdGazeMotion();
    if (current.current.generation !== generation) return;
    const p = latest.current, s = useAppStore.getState();
    const objects = p.getCandidates();
    let error = '';
    if (!stopped) error = '카메라 정지 응답을 확인하지 못했습니다';
    else if (!inputReady() || s.activeAngleTarget || !inAacZone(s.arduinoLevels.pan, s.arduinoLevels.tilt, true)) error = '카메라 방향과 연결 상태를 다시 확인해주세요';
    else if (!objects.length) error = '안정적으로 탐지된 객체가 없습니다';
    if (error) { change({ phase: 'IDLE', message: '' }); p.notify(error, 'error'); log('entry_failed', error); return; }
    change({ phase: 'OBJECT_SCAN', objects: [...objects], object: null, message: '' });
    log('menu_enter', objects.join(','));
  }
  async function select(item: CommandItem) {
    const s = current.current;
    if (!inputReady() || !['OBJECT_SCAN', 'REQUEST_SCAN'].includes(s.phase)) return;
    if (item.command === 'AAC_BACK') {
      if (s.phase === 'REQUEST_SCAN') change({ phase: 'OBJECT_SCAN', object: null, message: '' });
      else cancel('back');
      return;
    }
    if (s.phase === 'OBJECT_SCAN') {
      const object = s.objects.find(o => item.command === `AAC_OBJECT_${o}`);
      if (!object) return;
      change({ phase: 'REQUEST_SCAN', object, message: '' }); log('object_select', object); return;
    }
    const request = s.object && aacRequests[s.object].find(r => r.command === item.command && r.command !== 'AAC_BACK');
    if (!request) return;
    change({ phase: 'SPEAKING', message: request.description });
    const generation = current.current.generation;
    log('request_select', request.command);
    try {
      const outcome = await latest.current.speech.speak(request.description, () => log('speech_start', request.command));
      if (generation !== current.current.generation || outcome !== 'ended') return;
      log('speech_end', request.command); latest.current.notify('음성 출력 완료', 'success');
      feedbackTimer.current = window.setTimeout(() => {
        if (current.current.generation === generation) change({ ...initial });
      }, 1000);
    } catch (error) {
      if (generation !== current.current.generation) return;
      const message = error instanceof Error ? error.message : '음성 출력 실패';
      log('speech_failed', message); change({ phase: 'REQUEST_SCAN', message }); latest.current.notify(message, 'error');
    }
  }
  function openObjectRequest(object: AacObjectType, objects: AacObjectType[] = [object]): boolean {
    if (!inputReady() || !objects.includes(object)) return false;
    change({ phase: 'REQUEST_SCAN', objects: [...objects], object, message: '' });
    log('context_object_select', object);
    return true;
  }
  function handleBlink(id: string, event: string | null): boolean {
    const snapshot = closed.current; closed.current = null;
    const active = current.current.phase !== 'IDLE';
    if (id === lastBlink.current) return active;
    lastBlink.current = id;
    const liveStore = useAppStore.getState();
    if (liveStore.emergencyActive) { cancel('emergency'); return true; }
    if (event === 'CANCEL') { if (active) cancel('long_blink'); else latest.current.speech.cancel(); return active; }
    if (!inputReady()) return active;
    if (event !== 'SELECT') return active;
    if (active) {
      if (snapshot?.generation === current.current.generation && snapshot.item) void select(snapshot.item);
      return true;
    }
    if (snapshot?.armed && snapshot.generation === current.current.generation && liveStore.interactionMode === 'EXPLORE' && !liveStore.activeAngleTarget) {
      void enter(); return true;
    }
    return false;
  }
  function exportLogs() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: '2.1', events: logs.current }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'eyecan-aac-log.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const list = state.object && state.phase !== 'OBJECT_SCAN' ? aacRequests[state.object] : objectItems(state.objects);
  return { ...state, active: state.phase !== 'IDLE', scanning: state.phase === 'OBJECT_SCAN' || state.phase === 'REQUEST_SCAN',
    inputReady: inputReady(), directionReady, list, meta: { ...aacMeta, name: state.object ? objectNames[state.object] : aacMeta.name },
    onEyeClose, handleBlink, select, openObjectRequest, cancel, exportLogs };
}
