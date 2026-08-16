import { DIST_CELL } from '../constants';
import { closestPointOnWall } from './geometry';
import type { Obstacle } from '../types';
import type { Exit } from '../agent';

// Primitive "grilleDistanceSortie" (adapted, même principe de flood-fill/BFS que
// grilleDistanceNid — voir nestDistance.ts) : sans elle, un piéton vise la sortie en
// ligne droite et s'agglutine contre le premier obstacle qui coupe cette ligne, quel
// que soit le chemin réellement praticable pour la contourner. BFS multi-sources (une
// par sortie) : chaque case du champ porte la distance, en tenant compte des murs,
// jusqu'à la sortie la plus proche par le chemin — pas à vol d'oiseau. Foule humaine uniquement.
export let exitDistField: Float32Array | null = null;
export let exitDistCols = 0;
export let exitDistRows = 0;

export function computeExitDistanceField(
  isFouleScenario: boolean,
  exits: Exit[],
  worldW: number,
  worldH: number,
  obstacles: Obstacle[],
): void {
  exitDistField = null;
  if (!isFouleScenario) return;
  if (!exits.length || worldW <= 0 || worldH <= 0) return;
  exitDistCols = Math.max(1, Math.ceil(worldW / DIST_CELL));
  exitDistRows = Math.max(1, Math.ceil(worldH / DIST_CELL));
  const n = exitDistCols * exitDistRows;
  const dist = new Float32Array(n).fill(-1);
  const blocked = new Uint8Array(n);
  for (let gy = 0; gy < exitDistRows; gy++) {
    for (let gx = 0; gx < exitDistCols; gx++) {
      const cx = gx * DIST_CELL + DIST_CELL / 2, cy = gy * DIST_CELL + DIST_CELL / 2;
      for (const o of obstacles) {
        const cp = closestPointOnWall(cx, cy, o.points);
        if (Math.hypot(cx - cp.x, cy - cp.y) < o.thickness + 8) {
          blocked[gy * exitDistCols + gx] = 1;
          break;
        }
      }
    }
  }
  const qx: number[] = [], qy: number[] = [];
  for (const ex of exits) {
    const startGx = Math.min(exitDistCols - 1, Math.max(0, Math.floor(ex.x / DIST_CELL)));
    const startGy = Math.min(exitDistRows - 1, Math.max(0, Math.floor(ex.y / DIST_CELL)));
    const startIdx = startGy * exitDistCols + startGx;
    if (dist[startIdx] !== -1) continue; // deux sorties dans la même case : déjà une source
    blocked[startIdx] = 0; // une sortie ne bloque jamais sa propre case, même sur un mur tracé dessus
    dist[startIdx] = 0;
    qx.push(startGx);
    qy.push(startGy);
  }
  let qi = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (qi < qx.length) {
    const cx = qx[qi], cy = qy[qi];
    const cd = dist[cy * exitDistCols + cx];
    qi++;
    for (const [ddx, ddy] of dirs) {
      const nx = cx + ddx, ny = cy + ddy;
      if (nx < 0 || ny < 0 || nx >= exitDistCols || ny >= exitDistRows) continue;
      const nidx = ny * exitDistCols + nx;
      if (blocked[nidx] || dist[nidx] !== -1) continue;
      dist[nidx] = cd + 1;
      qx.push(nx);
      qy.push(ny);
    }
  }
  exitDistField = dist;
}

export function sampleExitDistance(x: number, y: number): number {
  if (!exitDistField) return -1;
  const gx = Math.floor(x / DIST_CELL), gy = Math.floor(y / DIST_CELL);
  if (gx < 0 || gy < 0 || gx >= exitDistCols || gy >= exitDistRows) return -1;
  return exitDistField[gy * exitDistCols + gx];
}

export function maybeRecomputeExitField(
  isFouleScenario: boolean,
  exits: Exit[],
  worldW: number,
  worldH: number,
  obstacles: Obstacle[],
): void {
  if (isFouleScenario) computeExitDistanceField(isFouleScenario, exits, worldW, worldH, obstacles);
}
