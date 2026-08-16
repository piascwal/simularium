import { initGrid } from '../core/grid/conway';
import { initPheromoneGrid } from '../core/grid/pheromone';

// resize()/updateWorldSize() déplacées depuis le monolithe (tranche 11 du plan de
// migration). Même schéma que core/simulate.ts : ces fonctions réassignent
// (W/H/DPR/worldW/worldH) plutôt que de simplement lire, donc un petit objet d'état
// explicite avec réécriture en sortie — pas d'objet d'état partagé géant, ce n'est
// pas nécessaire ici : main.ts appelle ces fonctions à des moments ponctuels
// (redimensionnement, changement de zoom), pas depuis des gestionnaires
// indépendants qui doivent voir les mises à jour des autres en continu.
export interface SizeState {
  W: number;
  H: number;
  DPR: number;
  zoneScale: number;
  worldW: number;
  worldH: number;
}

export function updateWorldSize(state: SizeState, recomputeNestField: () => void): void {
  state.worldW = state.W * state.zoneScale;
  state.worldH = state.H * state.zoneScale;
  initGrid(state.worldW, state.worldH);
  initPheromoneGrid(state.worldW, state.worldH);
  recomputeNestField();
}

export function resize(
  state: SizeState,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  recomputeNestField: () => void,
): void {
  state.DPR = Math.min(window.devicePixelRatio || 1, 2);
  state.W = canvas.clientWidth;
  state.H = canvas.clientHeight;
  canvas.width = state.W * state.DPR;
  canvas.height = state.H * state.DPR;
  ctx.setTransform(state.DPR, 0, 0, state.DPR, 0, 0);
  updateWorldSize(state, recomputeNestField);
}
