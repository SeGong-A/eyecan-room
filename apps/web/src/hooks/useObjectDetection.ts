import { useCallback, useEffect, useRef, useState } from 'react';
import type { AacObjectType, DetectionHealth, DetectionResponse, Track } from '../types/aac';
import { coverBox } from '../utils/objectGeometry';
import { isFreshResponse, LOST_GRACE_MS, updateTracks } from '../utils/objectTracking';
import { objectOrder } from '../domain/aac';

const initialHealth: DetectionHealth = { status: 'LOADING', supportedTypes: [], modelId: null, error: null };

export function useObjectDetection(enabled: boolean, getVideoElement: () => HTMLVideoElement | null) {
  const [health, setHealth] = useState<DetectionHealth>(initialHealth);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [size, setSize] = useState({ videoWidth: 1, videoHeight: 1, width: 1, height: 1 });
  const [retryKey, setRetryKey] = useState(0);
  const tracksRef = useRef<Track[]>([]);
  const healthRef = useRef(health);
  healthRef.current = health;
  const retry = useCallback(() => {
    void fetch('/objects/reload', { method: 'POST', signal: AbortSignal.timeout(15000) }).catch(() => {}).finally(() => setRetryKey(k => k + 1));
  }, []);

  useEffect(() => {
    let disposed = false, timer = 0, timeout = 0, frameId = 0, lastFrame = 0, failures = 0;
    let sessionId = crypto.randomUUID();
    let controller: AbortController | null = null;
    let running = false;
    const nextId = { current: 0 };
    const canvas = document.createElement('canvas');
    const clear = () => { tracksRef.current = []; setTracks([]); };
    clear();
    if (!enabled) return;
    const publish = (next: Track[]) => { tracksRef.current = next; setTracks(next); };
    const expire = window.setInterval(() => {
      const fresh = tracksRef.current.filter(t => performance.now() - t.lastSeen <= LOST_GRACE_MS);
      if (fresh.length !== tracksRef.current.length) publish(fresh);
    }, 100);
    const schedule = (ms: number) => { window.clearTimeout(timer); if (!disposed && !document.hidden) timer = window.setTimeout(() => void poll(), ms); };
    async function poll() {
      if (disposed || document.hidden || running) return;
      running = true;
      const started = performance.now();
      const ownSession = sessionId;
      controller = new AbortController();
      timeout = window.setTimeout(() => controller?.abort(), 2000);
      let delay = 200;
      let backoff = false;
      try {
        if (healthRef.current.status !== 'READY') {
          const response = await fetch('/objects/health', { signal: controller.signal });
          if (!response.ok) throw new Error('객체 탐지 서비스에 연결하지 못했습니다');
          const next: DetectionHealth = await response.json();
          if (disposed || ownSession !== sessionId) return;
          healthRef.current = next; setHealth(next);
          if (next.status !== 'READY') throw new Error(next.error || '객체 모델 준비 중');
        }
        const video = getVideoElement();
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) { clear(); return; }
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('영상 프레임을 읽지 못했습니다');
        context.translate(canvas.width, canvas.height); context.rotate(Math.PI);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const rect = video.getBoundingClientRect();
        setSize({ videoWidth: video.videoWidth, videoHeight: video.videoHeight, width: rect.width, height: rect.height });
        const capturedAt = performance.now();
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .8));
        if (!blob || disposed || ownSession !== sessionId || controller.signal.aborted) return;
        const id = ++frameId;
        const query = new URLSearchParams({ session_id: ownSession, frame_id: String(id), captured_at_ms: String(capturedAt) });
        const response = await fetch(`/objects/detect?${query}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' }, signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 429 ? '객체 탐지 처리 중' : '객체 탐지 응답을 확인하지 못했습니다');
        const result: DetectionResponse = await response.json();
        if (disposed || ownSession !== sessionId) return;
        if (isFreshResponse(result, sessionId, lastFrame, performance.now()) && result.frameId === id && result.capturedAtMs === capturedAt) {
          lastFrame = result.frameId;
          const supported = result.detections.filter(d => healthRef.current.supportedTypes.includes(d.type));
          publish(updateTracks(tracksRef.current, supported, result.capturedAtMs, nextId));
        }
        failures = 0;
      } catch (error) {
        if (!disposed && ownSession === sessionId && !document.hidden) {
          const message = error instanceof Error && error.name !== 'AbortError' ? error.message : '객체 탐지 응답 시간 초과';
          healthRef.current = { ...healthRef.current, status: 'ERROR', error: message };
          setHealth(healthRef.current);
          delay = [1000, 2000, 5000][Math.min(failures++, 2)];
          backoff = true;
        }
      } finally {
        window.clearTimeout(timeout); running = false;
        schedule(backoff ? delay : Math.max(0, delay - (performance.now() - started)));
      }
    }
    const visibility = () => {
      sessionId = crypto.randomUUID(); lastFrame = 0; controller?.abort(); clear();
      window.clearTimeout(timer);
      if (!document.hidden) schedule(0);
    };
    document.addEventListener('visibilitychange', visibility);
    schedule(0);
    return () => { disposed = true; controller?.abort(); window.clearTimeout(timer); window.clearTimeout(timeout); window.clearInterval(expire); document.removeEventListener('visibilitychange', visibility); };
  }, [enabled, getVideoElement, retryKey]);

  const boxes = tracks.map(track => ({ ...track, ...coverBox(track.bbox, size.videoWidth, size.videoHeight, size.width, size.height) }));
  const candidates: AacObjectType[] = health.status === 'READY' ? objectOrder.filter(type => boxes.some(t => t.type === type && t.stable && t.visible >= .5)) : [];
  const latest = useRef({ candidates, health, enabled });
  latest.current = { candidates, health, enabled };
  const getCandidates = useCallback(() => {
    const state = latest.current;
    return state.enabled && !document.hidden && state.health.status === 'READY' ? state.candidates.filter(type => tracksRef.current.some(t => t.type === type && t.stable && performance.now() - t.lastSeen <= LOST_GRACE_MS)) : [];
  }, []);
  return { health, boxes, candidates, getCandidates, retry };
}
