import type { Box } from '../types/aac';

export function intersection(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
export function iou(a: Box, b: Box): number {
  const overlap = intersection(a, b);
  return overlap / Math.max(Number.EPSILON, a.width * a.height + b.width * b.height - overlap);
}
// Input boxes already describe the rotated full frame. Only cover cropping remains.
export function coverBox(box: Box, videoWidth: number, videoHeight: number, width: number, height: number) {
  if (Math.min(videoWidth, videoHeight, width, height) <= 0) return { box: { x: 0, y: 0, width: 0, height: 0 }, visible: 0 };
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const mapped = { x: box.x * videoWidth * scale + (width - videoWidth * scale) / 2,
    y: box.y * videoHeight * scale + (height - videoHeight * scale) / 2,
    width: box.width * videoWidth * scale, height: box.height * videoHeight * scale };
  const x = Math.max(0, mapped.x), y = Math.max(0, mapped.y);
  return { box: { x, y, width: Math.max(0, Math.min(width, mapped.x + mapped.width) - x),
    height: Math.max(0, Math.min(height, mapped.y + mapped.height) - y) },
    visible: intersection(mapped, { x: 0, y: 0, width, height }) / Math.max(Number.EPSILON, mapped.width * mapped.height) };
}
