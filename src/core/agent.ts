import type { Point } from './types';

// Champs posés à la création (addAgent) ci-dessous ; le reste (préfixé `_`) est
// ajouté au fil du comportement dans core/simulate.ts et lu par
// render/draw.ts + ui/inspector.ts — tous optionnels puisqu'un agent ne porte
// que les champs pertinents pour son type/scénario.
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
  _gidx?: number;
  // Chasseur/prédateur : chasse, fuite, faim, cible verrouillée
  _fleeing?: boolean;
  _hunting?: boolean;
  _hunger?: number;
  _huntMotivation?: number;
  _target?: { a: Agent; d: number } | null;
  _preyDist?: number;
  // Rendu / inspecteur : dernière vitesse et direction désirée effectivement utilisées
  _lastSpeed?: number;
  _lastHasDesire?: boolean;
  _lastDesiredX?: number;
  _lastDesiredY?: number;
  // Anti-blocage (suivi de contour type "Bug2")
  _escapeUntil?: number;
  _escapeStartX?: number;
  _escapeStartY?: number;
  _escapeSign?: number;
  // Colonie de fourmis : suit une piste de phéromone détectée
  _followingTrail?: boolean;
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
