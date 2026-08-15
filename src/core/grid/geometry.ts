import type { Point } from '../types';

export function closestPointOnSegment(px: number, py: number, p1: Point, p2: Point): Point {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - p1.x) * dx + (py - p1.y) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: p1.x + t * dx, y: p1.y + t * dy };
}

export function closestPointOnWall(px: number, py: number, points: Point[]): Point {
  if (points.length === 1) return points[0];
  let best: Point | null = null;
  let bestD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const cp = closestPointOnSegment(px, py, points[i], points[i + 1]);
    const d = Math.hypot(px - cp.x, py - cp.y);
    if (d < bestD) {
      bestD = d;
      best = cp;
    }
  }
  return best as Point;
}
