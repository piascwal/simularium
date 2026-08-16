import { DIST_CELL } from '../constants';
import { closestPointOnWall } from './geometry';
import type { Obstacle, Point } from '../types';

// Primitive "grilleDistanceNid" (adapted, principe du flood-fill/BFS en robotique
// mobile) : calculé une fois (pas par agent, pas par frame), en tenant compte des
// murs — remplace la ligne droite comme boussole de retour, capable de négocier
// un vrai labyrinthe à boucles. Colonie de fourmis uniquement.
export let nestDistField: Float32Array | null = null;
export let distCols = 0;
export let distRows = 0;

export function computeNestDistanceField(
  isAntsScenario: boolean,
  queen: Point | null | undefined,
  worldW: number,
  worldH: number,
  obstacles: Obstacle[],
): void {
  nestDistField = null;
  if (!isAntsScenario) return;
  if (!queen || worldW <= 0 || worldH <= 0) return;
  distCols = Math.max(1, Math.ceil(worldW / DIST_CELL));
  distRows = Math.max(1, Math.ceil(worldH / DIST_CELL));
  const n = distCols * distRows;
  const dist = new Float32Array(n).fill(-1);
  const blocked = new Uint8Array(n);
  for (let gy = 0; gy < distRows; gy++) {
    for (let gx = 0; gx < distCols; gx++) {
      const cx = gx * DIST_CELL + DIST_CELL / 2, cy = gy * DIST_CELL + DIST_CELL / 2;
      for (const o of obstacles) {
        const cp = closestPointOnWall(cx, cy, o.points);
        // Marge minimale (2px, pas 8 — voir exitDistance.ts pour le raisonnement complet) : un
        // couloir tracé à largeur "normale" pouvait se retrouver entièrement bloqué dans le champ
        // malgré un passage visuellement ouvert, la marge s'ajoutant des deux côtés du couloir.
        if (Math.hypot(cx - cp.x, cy - cp.y) < o.thickness + 2) {
          blocked[gy * distCols + gx] = 1;
          break;
        }
      }
    }
  }
  const startGx = Math.min(distCols - 1, Math.max(0, Math.floor(queen.x / DIST_CELL)));
  const startGy = Math.min(distRows - 1, Math.max(0, Math.floor(queen.y / DIST_CELL)));
  const startIdx = startGy * distCols + startGx;
  blocked[startIdx] = 0; // le nid lui-même ne bloque jamais sa propre case, même sur un mur tracé dessus
  dist[startIdx] = 0;
  const qx = [startGx], qy = [startGy];
  let qi = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (qi < qx.length) {
    const cx = qx[qi], cy = qy[qi];
    const cd = dist[cy * distCols + cx];
    qi++;
    for (const [ddx, ddy] of dirs) {
      const nx = cx + ddx, ny = cy + ddy;
      if (nx < 0 || ny < 0 || nx >= distCols || ny >= distRows) continue;
      const nidx = ny * distCols + nx;
      if (blocked[nidx] || dist[nidx] !== -1) continue;
      dist[nidx] = cd + 1;
      qx.push(nx);
      qy.push(ny);
    }
  }
  nestDistField = dist;
}

export function sampleNestDistance(x: number, y: number): number {
  if (!nestDistField) return -1;
  const gx = Math.floor(x / DIST_CELL), gy = Math.floor(y / DIST_CELL);
  if (gx < 0 || gy < 0 || gx >= distCols || gy >= distRows) return -1;
  return nestDistField[gy * distCols + gx];
}

export function maybeRecomputeNestField(
  isAntsScenario: boolean,
  queen: Point | null | undefined,
  worldW: number,
  worldH: number,
  obstacles: Obstacle[],
): void {
  if (isAntsScenario) computeNestDistanceField(isAntsScenario, queen, worldW, worldH, obstacles);
}
