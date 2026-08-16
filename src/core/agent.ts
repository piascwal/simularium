import type { Point } from './types';

// Champs posés à la création (addAgent) ; beaucoup d'autres champs `_xxx` sont
// ajoutés ensuite au fil du comportement (updateAgents, pas encore extrait —
// voir la tranche 9 du plan de migration), d'où l'index signature en attendant.
export interface Agent {
  type: string;
  x: number;
  y: number;
  angle: number;
  wander: number;
  id: string;
  isPanicking: boolean;
  _stuckTimer: number;
  _lastCheckX: number;
  _lastCheckY: number;
  _carryingFood: boolean;
  _carryingCorpse: boolean;
  _spawnCooldown: number;
  [key: string]: unknown;
}

export interface FoodSource extends Point {
  r: number;
  qty: number;
  maxQty: number;
}

export interface Exit extends Point {
  r: number;
}

export interface Alarm extends Point {
  r: number;
}

export interface Corpse extends Point {
  age: number;
}

export function createAgent(type: string, x: number, y: number, rand: () => number): Agent {
  return {
    type, x, y,
    angle: rand() * Math.PI * 2,
    wander: rand() * 1000,
    id: rand().toString(36).slice(2),
    isPanicking: false,
    _stuckTimer: 0,
    _lastCheckX: x,
    _lastCheckY: y,
    _carryingFood: false,
    _carryingCorpse: false,
    _spawnCooldown: 0,
  };
}

// Décomposition naturelle après 20s sans évacuation (nécrophorèse, colonie de fourmis).
export function ageCorpses(corpses: Corpse[], dt: number): Corpse[] {
  for (const c of corpses) c.age += dt;
  return corpses.filter((c) => c.age < 20);
}

export function getMidden(worldW: number, worldH: number): Point {
  return { x: worldW * 0.92, y: worldH * 0.92 };
}
