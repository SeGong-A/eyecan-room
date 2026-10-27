import type { Detection, DetectionResponse, Track } from '../types/aac';
import { aacObjectTypes } from '../types/aac';
import { iou } from './objectGeometry';

export const LOST_GRACE_MS = 1200;
const MIN_CONFIDENCE: Record<Detection['type'], number> = {
  cup: .60,
  bottle: .60,
  cell_phone: .45,
  tissue_box: .60,
};
const MIN_AREA: Record<Detection['type'], number> = {
  cup: .01,
  bottle: .01,
  cell_phone: .005,
  tissue_box: .01,
};

export function isFreshResponse(result: DetectionResponse, session: string, lastFrame: number, now: number) {
  return result.sessionId === session && result.frameId > lastFrame && Number.isFinite(result.capturedAtMs) && now >= result.capturedAtMs && now - result.capturedAtMs <= LOST_GRACE_MS;
}
export function updateTracks(previous: Track[], detections: Detection[], capturedAt: number, nextId: { current: number }): Track[] {
  const tracks = previous.filter(track => capturedAt - track.lastSeen <= LOST_GRACE_MS);
  const valid = detections.filter(d => aacObjectTypes.includes(d.type) && Number.isFinite(d.confidence) && d.confidence >= MIN_CONFIDENCE[d.type] &&
    Object.values(d.bbox).every(Number.isFinite) && d.bbox.width > 0 && d.bbox.height > 0 && d.bbox.width * d.bbox.height >= MIN_AREA[d.type]);
  const pairs = tracks.flatMap((track, ti) => valid.map((d, di) => ({ ti, di, score: track.type === d.type ? iou(track.bbox, d.bbox) : 0 })))
    .filter(pair => pair.score >= .30).sort((a, b) => b.score - a.score);
  const usedTracks = new Set<number>(), usedDetections = new Set<number>();
  const result = tracks.map(t => ({ ...t }));
  for (const { ti, di } of pairs) {
    if (usedTracks.has(ti) || usedDetections.has(di)) continue;
    usedTracks.add(ti); usedDetections.add(di);
    const hits = [...tracks[ti].hits.filter(t => capturedAt - t <= 600), capturedAt];
    result[ti] = { ...tracks[ti], ...valid[di], hits, lastSeen: capturedAt, stable: tracks[ti].stable || hits.length >= 3 };
  }
  valid.forEach((d, i) => { if (!usedDetections.has(i)) result.push({ ...d, id: ++nextId.current, hits: [capturedAt], lastSeen: capturedAt, stable: false }); });
  return result;
}
