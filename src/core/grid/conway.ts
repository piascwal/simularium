import { rand } from '../rng';
import { CELL } from '../constants';

// Grille de Conway : fond animé purement cosmétique (voir render()), sans
// effet sur le comportement des agents au-delà de disturbGridAt (perturbation
// visuelle au passage d'un agent).
export let gcols = 0;
export let grows = 0;
export let grid: Uint8Array | null = null;
export let gage: Float32Array | null = null;

export function initGrid(worldW: number, worldH: number): void {
  if (worldW <= 0 || worldH <= 0) return;
  gcols = Math.max(1, Math.ceil(worldW / CELL));
  grows = Math.max(1, Math.ceil(worldH / CELL));
  grid = new Uint8Array(gcols * grows);
  gage = new Float32Array(gcols * grows);
  for (let i = 0; i < grid.length; i++) grid[i] = rand() < 0.16 ? 1 : 0;
}

export function gidx(x: number, y: number): number {
  return y * gcols + x;
}

export function stepConway(): void {
  if (!grid || !gage) return;
  const next = new Uint8Array(gcols * grows);
  for (let y = 0; y < grows; y++) {
    for (let x = 0; x < gcols; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + gcols) % gcols, ny = (y + dy + grows) % grows;
          n += grid[gidx(nx, ny)];
        }
      }
      const alive = grid[gidx(x, y)];
      next[gidx(x, y)] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
    }
  }
  for (let i = 0; i < next.length; i++) {
    gage[i] = next[i] ? Math.min(1, gage[i] + 0.18) : 0;
  }
  grid = next;
}

export function disturbGridAt(px: number, py: number, r: number): void {
  if (!grid) return;
  const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
  const cr = Math.ceil(r / CELL);
  for (let dy = -cr; dy <= cr; dy++) {
    for (let dx = -cr; dx <= cr; dx++) {
      const x = (cx + dx + gcols) % gcols, y = (cy + dy + grows) % grows;
      if (Math.hypot(dx, dy) * CELL < r && rand() < 0.4) grid[gidx(x, y)] = 0;
    }
  }
}
