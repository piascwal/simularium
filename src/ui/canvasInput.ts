import { closestPointOnWall } from '../core/grid/geometry';
import type { Agent, FoodSource, Exit, Alarm } from '../core/agent';
import type { AgentTypeDef, Obstacle, Point } from '../core/types';

// pointerWorldPos()/findAgentNear()/eraseAt() déplacées depuis le monolithe
// (tranche 11 du plan de migration) — fonctions de coordonnées et de test de
// collision, réutilisées telles quelles par les gestionnaires pointerdown/move/up
// restés dans main.ts (ceux-ci enregistrent les écouteurs et lisent `mode`, ce qui
// reste dans main.ts pour l'instant).
export function pointerWorldPos(e: PointerEvent, canvas: HTMLCanvasElement, zoneScale: number): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * zoneScale, y: (e.clientY - rect.top) * zoneScale };
}

export function findAgentNear(agents: Agent[], TYPES: Record<string, AgentTypeDef>, x: number, y: number): Agent | null {
  let bd = Infinity, bi = -1;
  agents.forEach((a, i) => {
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < bd) { bd = d; bi = i; }
  });
  if (bi > -1 && bd < TYPES[agents[bi].type].radius + 12) return agents[bi];
  return null;
}

export interface EraseState {
  agents: Agent[];
  refuge: (Point & { r: number }) | null;
  obstacles: Obstacle[];
  food: FoodSource[];
  exits: Exit[];
  alarms: Alarm[];
}

// Teste dans l'ordre agent -> refuge -> obstacle -> nourriture -> sortie -> alarme,
// et retire le premier élément touché (une seule suppression par appel).
export function eraseAt(state: EraseState, zoneScale: number, x: number, y: number): void {
  const { agents, obstacles, food, exits, alarms } = state;
  let bd = Infinity, bi = -1;
  agents.forEach((a, i) => {
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < bd) { bd = d; bi = i; }
  });
  if (bi > -1 && bd < 30 * zoneScale) { agents.splice(bi, 1); return; }
  if (state.refuge && Math.hypot(state.refuge.x - x, state.refuge.y - y) < state.refuge.r) {
    state.refuge = null;
    return;
  }
  for (let i = 0; i < obstacles.length; i++) {
    const cp = closestPointOnWall(x, y, obstacles[i].points);
    if (Math.hypot(cp.x - x, cp.y - y) < obstacles[i].thickness) { obstacles.splice(i, 1); return; }
  }
  for (let i = 0; i < food.length; i++) {
    if (Math.hypot(food[i].x - x, food[i].y - y) < food[i].r) { food.splice(i, 1); return; }
  }
  for (let i = 0; i < exits.length; i++) {
    if (Math.hypot(exits[i].x - x, exits[i].y - y) < exits[i].r) { exits.splice(i, 1); return; }
  }
  for (let i = 0; i < alarms.length; i++) {
    if (Math.hypot(alarms[i].x - x, alarms[i].y - y) < Math.max(alarms[i].r, 16)) { alarms.splice(i, 1); return; }
  }
}
