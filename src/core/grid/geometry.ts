import type { Obstacle, Point } from '../types';

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

// Fusionne un tracé qui vient de se terminer (newWall) avec tout obstacle existant dont une
// extrémité LIBRE touche l'une des siennes, à snapDist près. Sans ça, deux murs dessinés bout à
// bout restent deux polylignes distinctes portant chacune sa propre extrémité "libre" au même
// endroit visuel — le suivi de tangente anti-blocage (Bug2, voir simulate.ts) peut alors orbiter
// indéfiniment sur ce point, s'y croyant toujours au bout d'un mur, même si le passage semble
// continu à l'écran. En boucle pour absorber le cas d'un tracé qui touche deux obstacles distincts
// à ses deux bouts (utile pour insérer une porte entre deux pans de mur déjà en place), pas
// seulement un côté. Ne gère que la chaîne bout à bout : un croisement en T (un tracé qui touche
// le MILIEU d'un autre, pas son extrémité) reste un cas à part, volontairement laissé de côté —
// plus rare en dessin à main levée, et une vraie fusion en graphe serait disproportionnée ici.
export function mergeTouchingObstacles(obstacles: Obstacle[], newWall: Obstacle, snapDist: number): Obstacle[] {
  // newWall exclu explicitement du reste, qu'il soit déjà présent dans `obstacles` (cas réel —
  // main.ts l'y a poussé dès le début du tracé) ou non (cas d'un appel isolé, ex. tests) : le
  // résultat final le réintègre toujours une fois, fusionné ou tel quel.
  let rest = obstacles.filter(o => o !== newWall);
  let active = newWall;
  let mergedThisPass = true;
  while (mergedThisPass) {
    mergedThisPass = false;
    for (const other of rest) {
      const a0 = active.points[0], a1 = active.points[active.points.length - 1];
      const o0 = other.points[0], o1 = other.points[other.points.length - 1];
      let newPoints: Point[] | null = null;
      if (Math.hypot(a1.x - o0.x, a1.y - o0.y) < snapDist) newPoints = [...active.points, ...other.points];
      else if (Math.hypot(a0.x - o1.x, a0.y - o1.y) < snapDist) newPoints = [...other.points, ...active.points];
      else if (Math.hypot(a0.x - o0.x, a0.y - o0.y) < snapDist) newPoints = [...[...active.points].reverse(), ...other.points];
      else if (Math.hypot(a1.x - o1.x, a1.y - o1.y) < snapDist) newPoints = [...other.points, ...[...active.points].reverse()];
      if (newPoints) {
        active = { points: newPoints, thickness: other.thickness };
        rest = rest.filter(o => o !== other);
        mergedThisPass = true;
        break;
      }
    }
  }
  return [...rest, active];
}
