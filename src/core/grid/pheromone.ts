import { PCELL } from '../constants';

// Deux pistes distinctes (colonie de fourmis) : "retour" (recrutement établi,
// Deneubourg et al. 1990) et "recherche" (marquage d'exploration, extrapolation
// — voir primitive marquageExploration).
export let pcols = 0;
export let prows = 0;
export let pherReturn: Float32Array | null = null;
export let pherSearch: Float32Array | null = null;

export function pidx(x: number, y: number): number {
  return y * pcols + x;
}

export function initPheromoneGrid(worldW: number, worldH: number): void {
  if (worldW <= 0 || worldH <= 0) return;
  pcols = Math.max(1, Math.ceil(worldW / PCELL));
  prows = Math.max(1, Math.ceil(worldH / PCELL));
  pherReturn = new Float32Array(pcols * prows);
  pherSearch = new Float32Array(pcols * prows);
}

export function depositPheromone(field: Float32Array | null, x: number, y: number, amount: number): void {
  if (!field) return;
  const gx = Math.floor(x / PCELL), gy = Math.floor(y / PCELL);
  if (gx < 0 || gy < 0 || gx >= pcols || gy >= prows) return;
  const i = pidx(gx, gy);
  field[i] = Math.min(1, field[i] + amount);
}

export function samplePheromone(field: Float32Array | null, x: number, y: number): number {
  if (!field) return 0;
  const gx = Math.floor(x / PCELL), gy = Math.floor(y / PCELL);
  if (gx < 0 || gy < 0 || gx >= pcols || gy >= prows) return 0;
  return field[pidx(gx, gy)];
}

function evaporatePheromoneField(field: Float32Array | null, dt: number, rate: number): void {
  if (!field) return;
  const f = Math.max(0, 1 - rate * dt);
  for (let i = 0; i < field.length; i++) {
    field[i] *= f;
    if (field[i] < 0.003) field[i] = 0;
  }
}

export function evaporatePheromone(dt: number): void {
  // La piste de retour (recrutement) s'efface vite — elle n'a de sens que peu de temps.
  // La piste de recherche dure plus longtemps : c'est le marqueur qui doit encore exister
  // quand la fourmi revient d'un trajet long (Jackson & Ratnieks 2006 — systèmes de pistes
  // à durées de vie différentes selon leur rôle).
  evaporatePheromoneField(pherReturn, dt, 0.15);
  evaporatePheromoneField(pherSearch, dt, 0.05);
}
