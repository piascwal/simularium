import { AGENT_CELL } from '../constants';

// Grille spatiale des agents (accélère les requêtes de voisinage). Sans elle,
// "plus proche de type X" et "voisins dans un rayon" scannent tout le tableau
// `agents` à chaque appel — ça devient O(n²) par frame et c'est ça qui lague
// dès quelques centaines d'agents, pas le rendu. Reconstruite à la demande
// (une fois par phase de calcul), elle limite chaque requête aux cellules
// proches du point interrogé.

interface SpatialAgent {
  x: number;
  y: number;
  _gidx?: number;
}

interface AgentGridState<T extends SpatialAgent> {
  cols: number;
  rows: number;
  buckets: Map<number, T[]>;
}

let agentGridState: AgentGridState<SpatialAgent> | null = null;

export function buildAgentGrid<T extends SpatialAgent>(agents: T[], worldW: number, worldH: number): void {
  const cols = Math.max(1, Math.ceil(worldW / AGENT_CELL));
  const rows = Math.max(1, Math.ceil(worldH / AGENT_CELL));
  const buckets = new Map<number, T[]>();
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    a._gidx = i; // ordre stable, sert à ne traiter chaque paire qu'une seule fois (collisions)
    const gx = Math.min(cols - 1, Math.max(0, Math.floor(a.x / AGENT_CELL)));
    const gy = Math.min(rows - 1, Math.max(0, Math.floor(a.y / AGENT_CELL)));
    const key = gy * cols + gx;
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(a);
  }
  agentGridState = { cols, rows, buckets } as AgentGridState<SpatialAgent>;
}

// Appelle cb(other) pour chaque agent dont la cellule chevauche le carré [x±radius,y±radius].
// Rectangle englobant, pas un vrai disque : à l'appelant de refaire le test de distance exact.
export function forEachNearby<T extends SpatialAgent>(x: number, y: number, radius: number, cb: (other: T) => void): void {
  if (!agentGridState) return;
  const { cols, rows, buckets } = agentGridState as AgentGridState<T>;
  const minGx = Math.max(0, Math.floor((x - radius) / AGENT_CELL));
  const maxGx = Math.min(cols - 1, Math.floor((x + radius) / AGENT_CELL));
  const minGy = Math.max(0, Math.floor((y - radius) / AGENT_CELL));
  const maxGy = Math.min(rows - 1, Math.floor((y + radius) / AGENT_CELL));
  for (let gy = minGy; gy <= maxGy; gy++) {
    for (let gx = minGx; gx <= maxGx; gx++) {
      const arr = buckets.get(gy * cols + gx);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k++) cb(arr[k]);
    }
  }
}

// Voisin le plus proche satisfaisant `match`, par anneaux de cellules croissants autour de
// l'agent — s'arrête un anneau après le premier candidat trouvé (marge suffisante tant que
// les rayons de recherche restent du même ordre de grandeur qu'AGENT_CELL, ce qui est le cas
// ici). maxRadius optionnel : au-delà, renvoie null comme si aucun candidat n'existait ; sans
// lui, la recherche couvre toute la grille (cols+rows anneaux suffisent à tout atteindre).
export function nearestBy<T extends SpatialAgent>(
  agent: T,
  match: (other: T) => boolean,
  maxRadius?: number,
): { a: T; d: number } | null {
  if (!agentGridState) return null;
  const { cols, rows, buckets } = agentGridState as AgentGridState<T>;
  const cx = Math.min(cols - 1, Math.max(0, Math.floor(agent.x / AGENT_CELL)));
  const cy = Math.min(rows - 1, Math.max(0, Math.floor(agent.y / AGENT_CELL)));
  const maxRing = maxRadius ? Math.ceil(maxRadius / AGENT_CELL) + 1 : cols + rows;
  let best: T | null = null;
  let bd = Infinity;
  let foundRing = -1;
  for (let ring = 0; ring <= maxRing; ring++) {
    if (foundRing >= 0 && ring > foundRing + 1) break;
    const gxMin = cx - ring, gxMax = cx + ring, gyMin = cy - ring, gyMax = cy + ring;
    for (let gy = Math.max(0, gyMin); gy <= Math.min(rows - 1, gyMax); gy++) {
      for (let gx = Math.max(0, gxMin); gx <= Math.min(cols - 1, gxMax); gx++) {
        if (ring > 0 && gx > gxMin && gx < gxMax && gy > gyMin && gy < gyMax) continue; // intérieur déjà vu
        const arr = buckets.get(gy * cols + gx);
        if (!arr) continue;
        for (const other of arr) {
          if (other === agent || !match(other)) continue;
          const d = Math.hypot(other.x - agent.x, other.y - agent.y);
          if (d < bd) {
            bd = d;
            best = other;
          }
        }
      }
    }
    if (best && foundRing < 0) foundRing = ring;
  }
  if (maxRadius && best && bd > maxRadius) return null;
  return best ? { a: best, d: bd } : null;
}
