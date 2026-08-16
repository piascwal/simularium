import { rand } from './rng';
import { evaporatePheromone, depositPheromone, samplePheromone, pherReturn, pherSearch } from './grid/pheromone';
import { disturbGridAt } from './grid/conway';
import { sampleNestDistance } from './grid/nestDistance';
import { sampleExitDistance } from './grid/exitDistance';
import { closestPointOnWall } from './grid/geometry';
import { buildAgentGrid, forEachNearby, nearestBy } from './grid/agentSpatialHash';
import { createAgent, ageCorpses as ageCorpsesCore, getMidden as getMiddenCore } from './agent';
import { MENU_BAR_H, DIST_CELL } from './constants';
import type { Agent, FoodSource, Exit, Alarm, Corpse } from './agent';
import type { AgentTypeDef, Obstacle, Point, ScenarioId } from './types';

// forEachNearby/nearestBy (agentSpatialHash.ts) sont génériques sur T extends
// SpatialAgent ; sans indice de type explicite à chaque site d'appel, TypeScript
// infère T=SpatialAgent (la contrainte) plutôt que Agent, faute de mieux. Ces deux
// wrappers fixent T=Agent une bonne fois pour tout ce fichier, plutôt que d'annoter
// chaque callback individuellement dans le corps verbatim ci-dessous.
function forEachNearbyAgents(x: number, y: number, radius: number, cb: (other: Agent) => void): void {
  forEachNearby<Agent>(x, y, radius, cb);
}
function nearestAgentBy(agent: Agent, match: (other: Agent) => boolean, maxRadius?: number) {
  return nearestBy<Agent>(agent, match, maxRadius);
}
// Un seul des deux champs de distance est jamais actif à la fois (chacun n'existe que pour
// son propre scénario) : pas besoin de distinguer par agent.type, l'autre renvoie toujours -1.
function sampleGoalDistance(x: number, y: number): number {
  const ed = sampleExitDistance(x, y);
  if(ed >= 0) return ed;
  return sampleNestDistance(x, y);
}

// Direction lissée vers l'objectif du scénario (nid pour les fourmis, sortie pour la foule —
// via sampleGoalDistance, qui bascule automatiquement sur le bon champ selon le scénario actif),
// en tenant compte des murs. Partagée entre les deux comportements : le rééchantillonnage brut
// à 5 angles autour du cap courant est identique dans les deux cas, tout comme le risque de
// bruit qui va avec (le cap courant varie beaucoup en foule dense ou en essaim compact). La
// moyenne mobile porte sur le VECTEUR (pas l'angle brut, qui aurait une discontinuité à ±180°) ;
// sa norme peut descendre sous 1 quand la direction visée change souvent d'une frame à l'autre —
// un amortissement naturel, pas un bug, donc les appelants utilisent dx/dy tels quels plutôt que
// de renormaliser via l'angle. Retourne null si le champ est indisponible (scénario sans champ
// concerné, ou juste après un changement de scénario avant le premier calcul) — l'appelant se
// replie alors sur la ligne droite vers l'objectif.
function computeSmoothedGoalDirection(agent: Agent): { dx: number; dy: number } | null {
  const myDist = sampleGoalDistance(agent.x, agent.y);
  if(myDist < 0) return null;
  const sampleD = DIST_CELL*1.4;
  const angles = [agent.angle, agent.angle-0.5, agent.angle+0.5, agent.angle-1.1, agent.angle+1.1];
  let bestA = agent.angle, bestV = myDist;
  for(const ang of angles){
    const v = sampleGoalDistance(agent.x+Math.cos(ang)*sampleD, agent.y+Math.sin(ang)*sampleD);
    if(v>=0 && v<bestV){ bestV=v; bestA=ang; }
  }
  const rawDx = Math.cos(bestA), rawDy = Math.sin(bestA);
  const smDx = (agent._smoothGoalDx ?? rawDx) * 0.8 + rawDx * 0.2;
  const smDy = (agent._smoothGoalDy ?? rawDy) * 0.8 + rawDy * 0.2;
  agent._smoothGoalDx = smDx; agent._smoothGoalDy = smDy;
  return { dx: smDx, dy: smDy };
}

// updateAgents() déplacé en bloc depuis le monolithe (tranche 9 du plan de migration),
// structure interne intouchée. La fonction ne touche jamais le DOM — c'est justement
// cette propriété qui permettra plus tard de la réutiliser telle quelle dans un
// wrapper Capacitor (mobile) sans changement.
//
// Comme plusieurs endroits du corps réassignent (pas seulement mutent) `agents`,
// `corpses` et quelques compteurs — un simple import ne peut pas être réassigné par
// qui l'importe — l'état partagé transite par un objet `SimulationState` explicite :
// on le déstructure en variables locales en entrée (le corps ci-dessous n'a donc besoin
// d'aucune modification), puis on réécrit dedans les champs réassignés en sortie.
export interface SimulationState {
  // Entités (lecture-écriture : agents/corpses sont réassignés via .filter() à l'intérieur)
  agents: Agent[];
  corpses: Corpse[];
  // Entités (lecture seule ici — mutées en place mais jamais réassignées)
  obstacles: Obstacle[];
  food: FoodSource[];
  exits: Exit[];
  alarms: Alarm[];
  refuge: (Point & { r: number }) | null;
  // Contexte de scénario
  scenario: ScenarioId;
  TYPES: Record<string, AgentTypeDef>;
  // Monde
  worldW: number;
  worldH: number;
  zoneScale: number;
  // Horloge (lecture-écriture)
  t: number;
  // Bords / évitement
  boundaryMode: 'bounce' | 'perceive' | 'wrap';
  avoidanceSensitivity: number;
  // Bascules de comportement
  loomingMode: boolean;
  predationMode: boolean;
  popDynamicsMode: boolean;
  // Écologie proie-prédateur (poisson)
  starvationTime: number;
  birthRate: number;
  birthAccumulator: number; // lecture-écriture
  totalBirths: number; // lecture-écriture
  carryingCapacity: number;
  noCapacityLimit: boolean;
  confusionStrength: number;
  edgeCaptures: number; // lecture-écriture
  interiorCaptures: number; // lecture-écriture
  // Boids (poisson)
  cohesionWeight: number;
  alignmentWeight: number;
  separationWeight: number;
  // Colonie de fourmis
  pheromoneRange: number;
  antCarryingCapacity: number;
  antNoCapacityLimit: boolean;
  // Foule humaine
  congestionStrength: number;
  exitRemovesAgents: boolean;
  totalEvacuated: number; // lecture-écriture
  // Sélection / inspecteur (selectedTrail muté en place, jamais réassigné ici)
  selectedAgentId: string | null;
  selectedTrail: Point[];
}

export function updateAgents(
  state: SimulationState,
  dt: number,
  perception: number,
  forceMag: number,
  speed: number,
  panicRadius: number,
): void {
  let {
    agents, corpses, obstacles, food, exits, alarms, refuge,
    scenario, TYPES, worldW, worldH, zoneScale, t,
    boundaryMode, avoidanceSensitivity,
    loomingMode, predationMode, popDynamicsMode,
    starvationTime, birthRate, birthAccumulator, totalBirths,
    carryingCapacity, noCapacityLimit, confusionStrength,
    edgeCaptures, interiorCaptures,
    cohesionWeight, alignmentWeight, separationWeight,
    pheromoneRange, antCarryingCapacity, antNoCapacityLimit,
    congestionStrength, exitRemovesAgents, totalEvacuated,
    selectedAgentId, selectedTrail,
  } = state;

  // Wrappers locaux recréant les helpers historiquement définis comme fonctions
  // main.ts (nearest/addAgent/getMidden/rebuildAgentGrid/ageCorpses/relation) —
  // même nom, même comportement, pour que le corps ci-dessous (verbatim) n'ait
  // besoin d'aucune modification.
  function nearest(agent: Agent, type: string) {
    return nearestAgentBy(agent, (o: Agent) => o.type === type);
  }
  function addAgent(type: string, x: number, y: number): void {
    agents.push(createAgent(type, x, y, rand));
  }
  function getMidden(): Point {
    return getMiddenCore(worldW, worldH);
  }
  function rebuildAgentGrid(): void {
    buildAgentGrid(agents, worldW, worldH);
  }
  function ageCorpses(dt: number): void {
    corpses = ageCorpsesCore(corpses, dt);
  }
  // relation() : logique de scénario (chasseur/fugitif, prédateur/proie) — voir
  // core/scenarios/*.ts pour la donnée, pas encore table-drivée ici (tranche 7
  // fusionnée avec celle-ci, cf. plan de migration : setupDefaultPopulation()
  // dépendait déjà des entités, donc la logique de scénario ne pouvait de toute
  // façon pas être finalisée avant que ce fichier existe).
  function relation(self: string, other: string): number {
    if (scenario === 'heider') {
      if (self === 'fugitif' && other === 'chasseur') return -1;
      if (self === 'fugitif' && other === 'gardien') return -0.3;
      if (self === 'fugitif' && other === 'neutre') return -0.2;
      // chasseur → fugitif : 0 ici, géré par un bloc dédié plus bas (poursuite sans limite de
      // distance) plutôt que par ce mécanisme générique, capé à perception.
      if (self === 'chasseur' && other === 'fugitif') return 0;
      if (self === 'chasseur' && other === 'gardien') return -1.4;
      if (self === 'gardien' && other === 'chasseur') return 0;
      if (self === 'gardien' && other === 'fugitif') return 0;
      if (self === 'neutre') return other === 'neutre' ? 0 : -0.15;
      return 0;
    }
    if (scenario === 'poisson') {
      // Même mécanisme générique que chasseur/fugitif, seul l'habillage change —
      // exactement la validation d'architecture recherchée.
      if (self === 'poisson' && other === 'predateur') return -1;
      if (self === 'predateur' && other === 'poisson') return 1;
      return 0;
    }
    return 0;
  }

  // ---- corps historique de updateAgents(), déplacé verbatim ----
    t += dt;
    evaporatePheromone(dt);
    ageCorpses(dt);
    rebuildAgentGrid();
    // Reine mise en cache une fois par frame : appeler agents.find() depuis chaque fourmi
    // (comme avant) redevient O(n) par fourmi, donc O(n²) au global sur une grosse colonie.
    const queenRef = scenario==='ants' ? agents.find(a=>a.type==='reine') : null;

    // --- pré-passe : chasseurs (Heider-Simmel) ---
    // Chasse sans limite de distance (nearest() couvre déjà toute la grille) : l'agresseur ne
    // perd jamais la piste d'un fugitif repéré, aussi loin soit-il — cohérent avec la figure de
    // l'agresseur acharné perçue dans l'expérience originale (Heider & Simmel 1944), plutôt
    // qu'une portée de détection arbitraire. _fleeing affiné par la pré-passe des gardiens
    // ci-dessous (fuite seulement si un gardien défend activement CE chasseur, pas juste "un
    // gardien est dans les parages").
    for(const a of agents){
      if(a.type!=='chasseur') continue;
      a._target = nearest(a,'fugitif');
      a._hunting = !!a._target;
      a._fleeing = false;
    }

    // --- pré-passe : gardiens (Heider-Simmel) ---
    // Doit s'exécuter après la pré-passe des chasseurs (a besoin de _hunting/_target) et avant la
    // boucle principale, pour que le chasseur visé sache dès sa propre itération qu'il doit fuir.
    // Le gardien lui-même n'a pas de limite de distance (il peut réagir depuis n'importe où sur
    // la scène), mais ne se déclenche que si le chasseur est réellement proche du fugitif qu'il
    // poursuit (< perception) — sans ce filtre, un chasseur qui vient tout juste de choisir un
    // fugitif à l'autre bout de la scène déclenche déjà l'interposition, et le gardien arrive
    // systématiquement en position avant que le chasseur n'ait la moindre chance de s'approcher :
    // plus aucune tension, la menace de l'expérience originale disparaît. Choix du fugitif à
    // défendre fondé sur la proximité au fugitif attaqué (pas au chasseur), pour rester cohérent
    // quand plusieurs fugitifs sont menacés à la fois.
    for(const a of agents){
      if(a.type!=='gardien') continue;
      let bestCh: Agent | null = null, bestD = Infinity;
      for(const other of agents){
        if(other.type!=='chasseur' || !other._hunting || !other._target) continue;
        if(other._target.d > perception) continue;
        const d = Math.hypot(other._target.a.x-a.x, other._target.a.y-a.y);
        if(d<bestD){ bestD=d; bestCh=other; }
      }
      a._defendTarget = bestCh;
      if(bestCh) bestCh._fleeing = true;
    }

    const toStarve: Agent[] = [];
    const toEvacuate: Agent[] = [];
    for(const agent of agents){
      let desiredX = Math.cos(agent.angle), desiredY = Math.sin(agent.angle);
      let hasDesire = false;
      // L'intensité de panique retombe progressivement (~1.5s) plutôt que de s'arrêter net dès la
      // sortie du rayon de danger — sans quoi la vitesse revient instantanément à la normale et
      // aucune pression ne se propage dans la foule qui suit (Helbing, Farkas & Vicsek 2000 :
      // l'agitation d'un groupe qui vient de fuir persiste un moment, c'est ce qui crée un
      // embouteillage plus loin, pas seulement la zone de panique elle-même).
      agent._panicIntensity = Math.max(0, (agent._panicIntensity ?? 0) - dt/1.5);
      agent.isPanicking = agent._panicIntensity > 0.05;

      // Primitive "mortParFamine" (established, Lotka 1925 ; Volterra 1926) : un prédateur
      // qui ne mange pas meurt. Activable/paramétrable via le toggle "Dynamique de population".
      if(popDynamicsMode && agent.type==='predateur'){
        agent._hunger = (agent._hunger||0) + dt;
        if(agent._hunger > starvationTime) toStarve.push(agent);
      }

      // Vérification de la présence d'un prédateur dans le champ de perception pour la proie
      // (fugitif face au chasseur, poisson face au prédateur — même mécanisme, autre habillage).
      const isPreyType = agent.type==='fugitif' || agent.type==='poisson';
      const predatorTypeFor = agent.type==='poisson' ? 'predateur' : 'chasseur';
      let nearestHunter = null;
      if(isPreyType){
        nearestHunter = nearest(agent, predatorTypeFor);
      }

      // --- 1. PRIORITÉ ABSOLUE : EFFET LOOMING / FUITE DU PRÉDATEUR ---
      // Primitives : "looming" (established) déclenche "fuir" (established).
      if(loomingMode && isPreyType && nearestHunter && nearestHunter.d < panicRadius){
        agent._panicIntensity = 1;
        agent.isPanicking = true;
        const dx = agent.x - nearestHunter.a.x;
        const dy = agent.y - nearestHunter.a.y;
        const d = Math.hypot(dx,dy) || 1;
        desiredX += (dx/d) * 12.0; 
        desiredY += (dy/d) * 12.0;
        hasDesire = true;
      }

      // --- 2. COMPORTEMENTS SECONDAIRES (Uniquement si non paniqué ou pas de menace immédiate) ---
      // Recherche de refuge : extrapolation (adapted), pas une primitive isolée de la littérature.
      if(!agent.isPanicking){
        // Le refuge n'est cherché QUE si aucun chasseur n'est proche ou détecté à portée de perception
        const dangerPresent = nearestHunter && nearestHunter.d < perception;
        
        if(agent.type==='fugitif' && refuge && !dangerPresent){
          const dx=refuge.x-agent.x, dy=refuge.y-agent.y;
          const d=Math.hypot(dx,dy)||1;
          desiredX += (dx/d)*1.4; desiredY += (dy/d)*1.4; hasDesire=true;
        }

      }

      // --- GESTION DU BORD D'ÉCRAN : 3 modes explicites, voir toggle "Bords de l'écran" ---
      if(boundaryMode==='bounce'){
        // Primitive "rebondBord" (artifact). Patch de coin nécessaire car le rebond seul
        // provoque un empilement dans les angles (aucune anticipation, réflexion instantanée).
        const corners = [[0,0],[worldW,0],[0,worldH],[worldW,worldH]];
        const cornerInfluence = 150*avoidanceSensitivity;
        for(const [cx,cy] of corners){
          const dx=agent.x-cx, dy=agent.y-cy;
          const d=Math.hypot(dx,dy);
          if(d<cornerInfluence){
            const w=(1-d/cornerInfluence)*1.6*avoidanceSensitivity;
            desiredX += (dx/(d||1))*w; desiredY += (dy/(d||1))*w; hasDesire=true;
          }
        }
      } else if(boundaryMode==='perceive'){
        // Primitive "perceptionBord" (adapted) : le bord est senti et évité en amont, comme une
        // paroi (analogue simplifié de la thigmotaxie), pas de réflexion brutale au contact.
        const edgeInfluence = 130*avoidanceSensitivity;
        const edx0 = agent.x, edx1 = worldW-agent.x, edy0 = agent.y, edy1 = worldH-agent.y;
        if(edx0<edgeInfluence){ const w=(1-edx0/edgeInfluence)*1.8*avoidanceSensitivity; desiredX += w; hasDesire=true; }
        if(edx1<edgeInfluence){ const w=(1-edx1/edgeInfluence)*1.8*avoidanceSensitivity; desiredX -= w; hasDesire=true; }
        if(edy0<edgeInfluence){ const w=(1-edy0/edgeInfluence)*1.8*avoidanceSensitivity; desiredY += w; hasDesire=true; }
        if(edy1<edgeInfluence){ const w=(1-edy1/edgeInfluence)*1.8*avoidanceSensitivity; desiredY -= w; hasDesire=true; }
      }
      // en mode "wrap" (topologieTorique) : aucune anticipation nécessaire, il n'y a pas de bord.

      // ================= BANC DE POISSONS =================
      if(agent.type==='poisson'){
        // Primitive "cohesionBanc" (established, Reynolds 1987 ; Couzin et al. 2002) : trois
        // règles locales indépendamment pondérées, sans lien avec l'attribution d'intention
        // de Heider-Simmel — un paradigme d'auto-organisation à part entière.
        if(!agent.isPanicking){
          const boidRadius = perception*0.55;
          let ax=0, ay=0, cx=0, cy=0, sx=0, sy=0, n=0;
          forEachNearbyAgents(agent.x, agent.y, boidRadius, other=>{
            if(other===agent || other.type!=='poisson') return;
            const dx=other.x-agent.x, dy=other.y-agent.y;
            const d=Math.hypot(dx,dy);
            if(d>boidRadius || d<0.001) return;
            n++;
            ax += Math.cos(other.angle); ay += Math.sin(other.angle);
            cx += other.x; cy += other.y;
            if(d<28){ sx -= dx/d; sy -= dy/d; }
          });
          if(n>0){
            desiredX += (ax/n)*alignmentWeight; desiredY += (ay/n)*alignmentWeight;
            const mx=cx/n, my=cy/n;
            const cdx=mx-agent.x, cdy=my-agent.y;
            const cd=Math.hypot(cdx,cdy)||1;
            desiredX += (cdx/cd)*cohesionWeight; desiredY += (cdy/cd)*cohesionWeight;
            desiredX += sx*separationWeight; desiredY += sy*separationWeight;
            hasDesire = true;
          } else {
            // Primitive "errance" (adapted) : aucun voisin détecté, dérive aléatoire.
            const wn = Math.sin(agent.wander+t*0.6)*0.6;
            agent.angle += wn*dt;
          }
        }
      }

      if(agent.type==='predateur'){
        const py = nearest(agent,'poisson');
        agent._hunting = !!(py && py.d < perception);
        agent._preyDist = py ? py.d : Infinity;
        // Primitive "motivationSatiete" (established, Beukema 1968 — épinoche) : un prédateur
        // rassasié chasse beaucoup moins activement. Sans dynamique de population (donc sans
        // notion de faim), motivation maximale par défaut — comportement inchangé pour qui
        // n'active pas cette option.
        agent._huntMotivation = popDynamicsMode ? Math.min(1, (agent._hunger||0) / Math.max(1, starvationTime*0.4)) : 1;
        if(!agent._hunting){
          // Primitive "errance" (adapted) : même correctif que le chasseur — recherche active.
          const n = Math.sin(agent.wander+t*0.6)*0.6;
          agent.angle += n*dt;
        }
      }

      // ================= FOULE HUMAINE =================
      if(agent.type==='pieton'){
        // Primitive "rechercheSortie" (adapted) : même patron que la recherche de refuge du
        // fugitif — toujours active, y compris en panique (on continue de viser une sortie
        // même en fuyant, cohérent avec les observations de Helbing et al. 2000).
        let nearestExit=null, bdE=Infinity;
        for(const ex of exits){
          const d = Math.hypot(ex.x-agent.x, ex.y-agent.y);
          if(d<bdE){ bdE=d; nearestExit=ex; }
        }
        // Direction vers la sortie, consciente des murs — calculée une fois ici, réutilisée par
        // la panique ci-dessous (au lieu d'une fuite en ligne droite qui, elle, les ignore).
        let exitAngle: number | null = null;
        if(nearestExit){
          if(exitRemovesAgents && bdE < nearestExit.r){
            toEvacuate.push(agent);
          }
          // Primitive "grilleDistanceSortie" (adapted) : descend le gradient de distance à la
          // sortie la plus proche calculé par BFS en tenant compte des murs (core/grid/exitDistance.ts)
          // — un piéton ne fonce plus tout droit dans un obstacle qui coupe la ligne directe vers
          // la sortie. Repli sur la ligne droite seulement si le champ est indisponible (ex. juste
          // après un changement de scénario, avant le premier recalcul).
          const smoothed = computeSmoothedGoalDirection(agent);
          if(smoothed){
            exitAngle = Math.atan2(smoothed.dy, smoothed.dx);
            desiredX += smoothed.dx*1.2; desiredY += smoothed.dy*1.2; hasDesire=true;
          } else {
            const dx=nearestExit.x-agent.x, dy=nearestExit.y-agent.y;
            const d=Math.hypot(dx,dy)||1;
            exitAngle = Math.atan2(dy,dx);
            desiredX += (dx/d)*1.2; desiredY += (dy/d)*1.2; hasDesire=true;
          }
        }

        // Primitive "harde" (established, Couzin et al. 2002 ; Moussaïd et al. 2011) : tendance
        // à s'aligner sur la direction moyenne des piétons proches, surtout utile quand la vue
        // dégagée sur la sortie manque — un comportement de suivi de foule, pas d'imitation volontaire.
        let ax=0, ay=0, nH=0;
        const herdRadius = perception*0.4;
        forEachNearbyAgents(agent.x, agent.y, herdRadius, other=>{
          if(other===agent || other.type!=='pieton') return;
          const d = Math.hypot(other.x-agent.x, other.y-agent.y);
          if(d < herdRadius){ ax+=Math.cos(other.angle); ay+=Math.sin(other.angle); nH++; }
        });
        if(nH>0){ desiredX += (ax/nH)*0.4; desiredY += (ay/nH)*0.4; hasDesire=true; }

        // Primitive "looming"/"fuir" (established) réutilisées telles quelles : une alarme
        // proche déclenche la même panique que le looming prédateur, source statique en plus.
        if(loomingMode){
          let bdA=Infinity, nearestAlarm=null;
          for(const al of alarms){
            const d = Math.hypot(al.x-agent.x, al.y-agent.y);
            if(d<bdA){ bdA=d; nearestAlarm=al; }
          }
          if(nearestAlarm && bdA < panicRadius){
            agent._panicIntensity = 1;
            agent.isPanicking = true;
            if(exitAngle !== null){
              // La panique amplifie l'urgence vers la sortie (déjà consciente des murs) plutôt que
              // d'ajouter une fuite en ligne droite depuis l'alarme qui les ignorerait — sinon un
              // piéton pris entre l'alarme et un mur reste bloqué au lieu de continuer vers la
              // sortie. Cohérent avec Helbing, Farkas & Vicsek 2000 : la panique amplifie la
              // vitesse désirée vers la sortie, ce n'est pas un nouveau vecteur de fuite aveugle.
              // Poids modéré (pas 10x comme la fuite en ligne droite) : même lissée, la direction
              // peut encore changer d'une frame à l'autre en foule dense — l'amplifier trop fort
              // transforme le moindre ajustement de cap en embardée visible.
              desiredX += Math.cos(exitAngle)*4.0; desiredY += Math.sin(exitAngle)*4.0; hasDesire=true;
            } else {
              // Aucune sortie sur la scène pour guider la fuite : repli sur la ligne droite
              // depuis l'alarme, seule information disponible.
              const dx = agent.x-nearestAlarm.x, dy = agent.y-nearestAlarm.y;
              const d = Math.hypot(dx,dy)||1;
              desiredX += (dx/d)*12.0; desiredY += (dy/d)*12.0; hasDesire=true;
            }
          }
        }
      }

      if(agent.type==='gardien'){
        // Primitive "interposition" (adapted) : se place entre le chasseur en chasse et sa cible
        // (cible du chasseur choisie en pré-passe plus haut, sans limite de distance).
        const bc = agent._defendTarget;
        if(bc && bc._target){
          const fu = bc._target.a;
          const mx=(bc.x+fu.x)/2, my=(bc.y+fu.y)/2;
          const dx=mx-agent.x, dy=my-agent.y;
          const d=Math.hypot(dx,dy)||1;
          desiredX += (dx/d)*1.2; desiredY += (dy/d)*1.2; hasDesire=true;
        } else {
          // Primitive "errance" (adapted) : au repos (aucun fugitif attaqué à défendre), dérive
          // aléatoire comme les autres rôles inactifs — sans jamais trop s'éloigner du fugitif le
          // plus proche, le gardien "montant la garde" plutôt que de dériver indéfiniment.
          const n = Math.sin(agent.wander+t*0.6)*0.6;
          agent.angle += n*dt;
          const fu = nearest(agent,'fugitif');
          const leashRadius = perception*0.8;
          if(fu && fu.d > leashRadius){
            const dx=fu.a.x-agent.x, dy=fu.a.y-agent.y;
            const d=Math.hypot(dx,dy)||1;
            desiredX += (dx/d)*1.0; desiredY += (dy/d)*1.0; hasDesire=true;
          }
        }
      }

      if(agent.type==='neutre'){
        // Primitive "errance" (adapted) : marche aléatoire simplifiée, sans but.
        const n = Math.sin(agent.wander+t*0.6)*0.6;
        agent.angle += n*dt;
      }

      if(agent.type==='chasseur'){
        if(agent._hunting && agent._target && !agent._fleeing){
          // Primitive "poursuivre" (established) sans limite de distance : contrairement au
          // mécanisme générique de relation (capé à perception), le chasseur ne perd jamais la
          // piste d'un fugitif repéré — cohérent avec la figure de l'agresseur acharné perçue
          // dans l'expérience originale (Heider & Simmel 1944), plutôt qu'une portée de
          // détection arbitraire.
          const fu = agent._target.a;
          const dx = fu.x-agent.x, dy = fu.y-agent.y;
          const d = Math.hypot(dx,dy)||1;
          desiredX += (dx/d)*1.2; desiredY += (dy/d)*1.2; hasDesire=true;
        } else {
          // Primitive "errance" (adapted) : sans poursuite active (aucun fugitif en scène, ou un
          // gardien défend contre lui — priorité à la survie), recherche/dérive plutôt que ligne
          // droite indéfinie.
          const n = Math.sin(agent.wander+t*0.6)*0.6;
          agent.angle += n*dt;
        }
      }

      // ================= COLONIE DE FOURMIS =================
      if(agent.type==='ouvriere' || agent.type==='eclaireuse'){
        const isScout = agent.type==='eclaireuse';
        const queen = queenRef;
        agent._followingTrail = false;

        // Primitive "fuir" (established, Dawkins & Krebs 1979) réutilisée telle quelle :
        // un intrus détecté à proximité prend le pas sur le butinage, sans exception.
        const intrusHit = nearestAgentBy(agent, o=>o.type==='intrus', perception*0.6);
        const nearestIntrus = intrusHit ? intrusHit.a : null;
        if(nearestIntrus){
          const dx=agent.x-nearestIntrus.x, dy=agent.y-nearestIntrus.y;
          const d=Math.hypot(dx,dy)||1;
          desiredX += (dx/d)*2.2; desiredY += (dy/d)*2.2; hasDesire=true;
        } else
        if(agent._carryingFood){
          // Primitive "grilleDistanceNid" (adapted) : descend le gradient de distance au nid
          // calculé par BFS en tenant compte des murs — remplace la ligne droite comme boussole
          // principale, capable de négocier un vrai labyrinthe à boucles. Repli sur l'intégration
          // de trajet classique (Wehner & Srinivasan 1981) seulement si le champ est indisponible.
          if(queen){
            const smoothed = computeSmoothedGoalDirection(agent);
            if(smoothed){
              // Même lissage que la foule pour la sortie (voir computeSmoothedGoalDirection) :
              // sans lui, le retour au nid rééchantillonnait un cap frais à chaque frame autour
              // du cap courant, lui-même bruité par les évitements/contournements en chemin.
              desiredX += smoothed.dx*1.8; desiredY += smoothed.dy*1.8; hasDesire=true;
            } else {
              const dx=queen.x-agent.x, dy=queen.y-agent.y;
              const d=Math.hypot(dx,dy)||1;
              desiredX += (dx/d)*0.6; desiredY += (dy/d)*0.6; hasDesire=true;
            }
            const dq = Math.hypot(queen.x-agent.x, queen.y-agent.y);
            if(dq < TYPES.reine.radius + 14){
              agent._carryingFood = false; // dépose la nourriture au nid
            }
          }
          // Suivi de piste au retour : la fourmi chargée suit sa propre piste (déposée à l'aller
          // en cherchant, ou celle du retour laissée par une autre) — c'est ce guide, pas la seule
          // boussole interne, qui trace le chemin réellement praticable à travers un labyrinthe.
          {
            const sampleDist = pheromoneRange;
            const angles = [agent.angle, agent.angle-0.7, agent.angle+0.7];
            let bestA=agent.angle, bestV = Math.max(samplePheromone(pherSearch, agent.x, agent.y), samplePheromone(pherReturn, agent.x, agent.y));
            for(const ang of angles){
              const px = agent.x+Math.cos(ang)*sampleDist, py = agent.y+Math.sin(ang)*sampleDist;
              const v = Math.max(samplePheromone(pherSearch,px,py), samplePheromone(pherReturn,px,py));
              if(v>bestV){ bestV=v; bestA=ang; }
            }
            if(bestV > 0.02){
              desiredX += Math.cos(bestA)*1.6; desiredY += Math.sin(bestA)*1.6; hasDesire=true;
            }
          }
          // Primitive "deposerTrace" (established, Deneubourg et al. 1990) : renforce le chemin du retour.
          // Une éclaireuse marque plus fort pour recruter les ouvrières vers sa découverte
          // (signal de recrutement, cf. Beckers, Deneubourg & Goss 1992). On ne dépose pas trop
          // près du nid : ce point de convergence de tous les retours saturerait artificiellement,
          // créant un pic de concentration qui n'indique aucune direction utile vers une nourriture.
          if(!queen || Math.hypot(agent.x-queen.x, agent.y-queen.y) > 40){
            depositPheromone(pherReturn, agent.x, agent.y, (isScout?1.6:0.9)*dt);
          }
        } else {
          // Ramassage si une source de nourriture est à portée
          for(const f of food){
            const d = Math.hypot(agent.x-f.x, agent.y-f.y);
            if(d < f.r && f.qty > 0){
              f.qty -= 1;
              agent._carryingFood = true;
              agent.angle += Math.PI; // demi-tour immédiat vers le nid
              hasDesire = true;
              break;
            }
          }
          if(!agent._carryingFood){
            // Primitive "marquageExploration" (adapted, visualisation) : marque son passage en
            // recherche, distinct de la piste de retour. N'influence pas encore le comportement
            // des autres fourmis — pour l'instant purement informatif à l'écran.
            depositPheromone(pherSearch, agent.x, agent.y, 0.5*dt);

            if(isScout){
              // Primitive "explorationScout" (adapted, Beckers, Deneubourg & Goss 1992 ;
              // Franks & Richardson 2006) : ignore délibérément la piste de phéromone,
              // explore le terrain de façon indépendante pour découvrir de nouvelles sources.
              const n = Math.sin(agent.wander+t*1.1)*1.1;
              agent.angle += n*dt;
            } else {
              // Primitive "suivreGradient" (established, Deneubourg et al. 1990) : échantillonne 3 directions
              // sur la piste de retour (celle qui mène effectivement à une source connue).
              const sampleDist = pheromoneRange;
              const angles = [agent.angle, agent.angle-0.7, agent.angle+0.7];
              let bestA = agent.angle, bestV = samplePheromone(pherReturn, agent.x, agent.y);
              for(const ang of angles){
                // Léger biais "s'éloigner du nid" : sans lui, le point de convergence de tous les
                // retours près de la reine attire à tort les fourmis recrutées vers elle plutôt
                // que vers la nourriture — la piste doit guider vers l'extérieur, pas vers le nid.
                const px = agent.x+Math.cos(ang)*sampleDist, py = agent.y+Math.sin(ang)*sampleDist;
                let v = samplePheromone(pherReturn, px, py);
                if(queen && Math.hypot(px-queen.x,py-queen.y) > Math.hypot(agent.x-queen.x,agent.y-queen.y)) v *= 1.3;
                if(v>bestV){ bestV=v; bestA=ang; }
              }
              if(bestV > 0.02){
                desiredX += Math.cos(bestA)*1.6; desiredY += Math.sin(bestA)*1.6; hasDesire=true;
                agent._followingTrail = true; // signal visuel : cette fourmi suit la piste d'une autre
              } else {
                // Primitive "errance" (adapted) : recherche aléatoire en l'absence de piste.
                const n = Math.sin(agent.wander+t*0.7)*0.7;
                agent.angle += n*dt;
              }
            }
          }
        }
      }

      if(agent.type==='soldat'){
        // Primitive "poursuivre" (adapted, Heider & Simmel 1944 + Reynolds 1987) réutilisée telle
        // quelle : le soldat n'a de rôle réel que s'il y a une menace à intercepter.
        const intrusHit = nearestAgentBy(agent, o=>o.type==='intrus', perception);
        const intrusTarget = intrusHit ? intrusHit.a : null;
        if(intrusTarget){
          const dx=intrusTarget.x-agent.x, dy=intrusTarget.y-agent.y;
          const d=Math.hypot(dx,dy)||1;
          desiredX += (dx/d)*1.6; desiredY += (dy/d)*1.6; hasDesire=true;
        } else {
          // Garde rapprochée du nid en l'absence de menace : extrapolation directe du rôle
          // de garde déjà utilisé pour le gardien, aucune primitive scientifique dédiée.
          const queen = queenRef;
          if(queen){
            const dx=queen.x-agent.x, dy=queen.y-agent.y;
            const d=Math.hypot(dx,dy);
            if(d>140){ desiredX += (dx/(d||1))*1.0; desiredY += (dy/(d||1))*1.0; hasDesire=true; }
            else { const n = Math.sin(agent.wander+t*0.5)*0.5; agent.angle += n*dt; }
          }
        }
      }

      if(agent.type==='intrus'){
        // L'intrus traque les fourmis non-combattantes isolées ; sans cible, il erre (primitive
        // "errance", adapted). C'est ce qui donne au soldat quelque chose à intercepter.
        const targetHit = nearestAgentBy(agent, o=>o.type==='ouvriere' || o.type==='eclaireuse' || o.type==='nourrice' || o.type==='fossoyeuse', perception);
        const target = targetHit ? targetHit.a : null;
        if(target){
          const dx=target.x-agent.x, dy=target.y-agent.y;
          const d=Math.hypot(dx,dy)||1;
          desiredX += (dx/d)*1.3; desiredY += (dy/d)*1.3; hasDesire=true;
        } else {
          const n = Math.sin(agent.wander+t*0.5)*0.5;
          agent.angle += n*dt;
        }
      }

      if(agent.type==='nourrice'){
        // Reste au nid pour s'occuper du couvain ; ne butine jamais.
        const nourriceIntrusHit = nearestAgentBy(agent, o=>o.type==='intrus', perception*0.6);
        const nearestIntrus = nourriceIntrusHit ? nourriceIntrusHit.a : null;
        if(nearestIntrus){
          const dx=agent.x-nearestIntrus.x, dy=agent.y-nearestIntrus.y;
          const d=Math.hypot(dx,dy)||1;
          desiredX += (dx/d)*2.2; desiredY += (dy/d)*2.2; hasDesire=true;
        } else {
          const queen = queenRef;
          if(queen){
            const dx=queen.x-agent.x, dy=queen.y-agent.y;
            const d=Math.hypot(dx,dy);
            if(d>60){ desiredX += (dx/(d||1))*1.0; desiredY += (dy/(d||1))*1.0; hasDesire=true; }
            else { const n = Math.sin(agent.wander+t*0.4)*0.4; agent.angle += n*dt; }
          }
        }
      }

      if(agent.type==='fossoyeuse'){
        // Primitive "necrophorese" (established, Wilson, Durlach & Roth 1958).
        if(agent._carryingCorpse){
          const midden = getMidden();
          const dx=midden.x-agent.x, dy=midden.y-agent.y;
          const d=Math.hypot(dx,dy)||1;
          desiredX += (dx/d)*1.6; desiredY += (dy/d)*1.6; hasDesire=true;
          if(d < 20) agent._carryingCorpse = false; // dépose le corps sur la décharge
        } else {
          let nearestCorpse=null, bdC=Infinity;
          for(const c of corpses){
            const d = Math.hypot(c.x-agent.x, c.y-agent.y);
            if(d<perception && d<bdC){ bdC=d; nearestCorpse=c; }
          }
          if(nearestCorpse){
            const dx=nearestCorpse.x-agent.x, dy=nearestCorpse.y-agent.y;
            const d=Math.hypot(dx,dy)||1;
            desiredX += (dx/d)*1.6; desiredY += (dy/d)*1.6; hasDesire=true;
            if(d < 12){
              corpses = corpses.filter(c=>c!==nearestCorpse);
              agent._carryingCorpse = true;
              agent.angle += Math.PI;
              hasDesire = true;
            }
          } else {
            const n = Math.sin(agent.wander+t*0.7)*0.7;
            agent.angle += n*dt;
          }
        }
      }

      if(agent.type==='reine'){
        // Primitive "roleStatique" (established, Bonabeau et al. 1996) : la reine ne se déplace pas.
        desiredX = 0; desiredY = 0; hasDesire = false;
        // Primitive "soinCouvain" (established, Wilson 1971 ; Robinson 1992) : les nourrices à
        // proximité accélèrent la production de nouvelles ouvrières, jusqu'à ×2.5 avec 3 nourrices.
        const nursesNearby = agents.filter(a=>a.type==='nourrice' && Math.hypot(a.x-agent.x,a.y-agent.y)<80).length;
        const spawnSpeedFactor = 1 + Math.min(nursesNearby,3)*0.5;
        agent._spawnCooldown -= dt*spawnSpeedFactor;
        if(agent._spawnCooldown <= 0){
          const workers = agents.filter(a=>a.type==='ouvriere').length;
          if(antNoCapacityLimit || workers < antCarryingCapacity){
            const ang = rand()*Math.PI*2;
            addAgent('ouvriere', agent.x+Math.cos(ang)*20, agent.y+Math.sin(ang)*20);
          }
          agent._spawnCooldown = 4 + rand()*3;
        }
      }

      // réaction à distance classique — primitives "poursuivre" / "fuir" selon le signe de la relation
      if(!agent.isPanicking){
        forEachNearbyAgents(agent.x, agent.y, perception, other=>{
          if(other===agent) return;
          const dx = other.x-agent.x, dy = other.y-agent.y;
          const d = Math.hypot(dx,dy);
          if(d>perception || d<1) return;
          let rel = relation(agent.type, other.type);
          if(agent.type==='chasseur' && agent._fleeing && other.type==='fugitif') rel = 0;
          if(agent.type==='predateur' && other.type==='poisson') rel *= (agent._huntMotivation ?? 1);
          if(rel===0) return;
          const w = rel * (1 - d/perception) * (forceMag/12);
          desiredX += (dx/d)*w;
          desiredY += (dy/d)*w;
          hasDesire = true;
        });
      }

      // Primitive "evitementObstacle" (adapted)
      for(const o of obstacles){
        const cp = closestPointOnWall(agent.x, agent.y, o.points);
        const dx = agent.x-cp.x, dy = agent.y-cp.y;
        const d = Math.hypot(dx,dy);
        const influence = o.thickness + 90*avoidanceSensitivity;
        if(d<influence){
          const w = (1 - d/influence) * 2.2 * avoidanceSensitivity;
          desiredX += (dx/(d||1))*w;
          desiredY += (dy/(d||1))*w;
          hasDesire = true;
        }
      }

      // --- ÉCHAPPEMENT ANTI-BLOCAGE (adapted, algorithmes "Bug" — Lumelsky & Stepanov 1987) ---
      // Tant qu'un échappement est actif, on ignore la recherche d'objectif habituelle (qui ne
      // "voit" pas les murs) et on suit le contour de l'obstacle le plus proche, comme une main
      // posée sur un mur, jusqu'à ce que la voie soit redevenue libre. Si aucun mur n'est proche,
      // le blocage vient d'un embouteillage de foule (pas de géométrie à contourner) : on amplifie
      // alors simplement la poussée déjà calculée vers l'objectif plutôt que de suivre un mur
      // inexistant — un correctif distinct, la marche à suivre n'étant pas la même.
      if(agent._escapeUntil && t < agent._escapeUntil){
        // Fin anticipée sur vrai progrès (Bug2) : une fois assez éloigné du point de blocage,
        // on considère le contournement réussi et on rend la main à la recherche d'objectif.
        if(agent._escapeStartX!==undefined){
          const escapedDist = Math.hypot(agent.x-agent._escapeStartX, agent.y-agent._escapeStartY!);
          if(escapedDist > 45) agent._escapeUntil = 0;
        }
        // Boucle détectée (rotation cumulée ~ un tour complet) sans avoir progressé : certaines
        // géométries locales (extrémité de mur, angle concave...) peuvent piéger le suivi de
        // tangente malgré la poussée vers l'objectif ajoutée plus bas. Plutôt que d'attendre
        // le délai de sécurité de 6s, on force l'essai dans l'autre sens dès qu'un tour complet
        // est détecté, et on redémarre la fenêtre de progrès depuis la position actuelle.
        if(agent._escapeUntil && Math.abs(agent._escapeAngleAccum||0) > 5.5){
          agent._escapeSign = -(agent._escapeSign||1);
          agent._escapeAngleAccum = 0;
          agent._escapeStartX = agent.x; agent._escapeStartY = agent.y;
        }
      }
      if(agent._escapeUntil && t < agent._escapeUntil){
        let bdO=Infinity, obsCp=null;
        for(const o of obstacles){
          const cp = closestPointOnWall(agent.x, agent.y, o.points);
          const d = Math.hypot(agent.x-cp.x, agent.y-cp.y);
          if(d<bdO){ bdO=d; obsCp=cp; }
        }
        if(obsCp && bdO < 60){
          const nx = agent.x-obsCp.x, ny = agent.y-obsCp.y;
          const nd = Math.hypot(nx,ny)||1;
          const tx = -ny/nd, ty = nx/nd; // tangente au contour
          const sign = agent._escapeSign || 1;
          desiredX = tx*sign*2.0 + (nx/nd)*0.9;
          desiredY = ty*sign*2.0 + (ny/nd)*0.9;
          // Composante modérée vers l'objectif (direction déjà lissée, voir plus haut) en plus du
          // pur suivi de tangente : près de l'EXTRÉMITÉ d'un mur (pas un long segment), le point
          // "le plus proche" reste épinglé au même endroit tout autour, et le suivi de tangente pur
          // peut orbiter indéfiniment autour de ce point plutôt que de finir par s'en écarter —
          // observé en pratique (trajectoire en boucle près du bout d'un mur). Cette composante
          // casse la symétrie circulaire sans dominer le contournement lui-même.
          if(agent._smoothGoalDx !== undefined && agent._smoothGoalDy !== undefined){
            desiredX += agent._smoothGoalDx*0.6; desiredY += agent._smoothGoalDy*0.6;
          }
          hasDesire = true;
        } else if(hasDesire){
          // Pas de mur à portée : embouteillage de foule. On pousse plus fort dans la direction
          // déjà visée (sortie, refuge...) pour l'aider à se frayer un chemin dans la masse.
          desiredX *= 2.2; desiredY *= 2.2;
        } else {
          agent._escapeUntil = 0;
        }
      }

      // --- MOTEUR ET DIRECTION ---
      // Capture pour l'inspecteur (clic sur agent) : vecteur désiré final, tel qu'il existe
      // au moment où il est consommé pour tourner l'agent, avant tout autre traitement.
      agent._lastDesiredX = desiredX;
      agent._lastDesiredY = desiredY;
      agent._lastHasDesire = hasDesire;

      if(hasDesire && (desiredX!==0 || desiredY!==0)){
        const targetAngle = Math.atan2(desiredY, desiredX);
        let diff = targetAngle - agent.angle;
        while(diff>Math.PI) diff-=Math.PI*2;
        while(diff<-Math.PI) diff+=Math.PI*2;
        
        let turnRate = 3.2*dt;
        if(agent.type==='fugitif'){
          const ch = nearest(agent,'chasseur');
          if(ch && ch.d < 60) turnRate = 7.5*dt;
          
          if(agent.isPanicking) turnRate = 18.0 * dt;
        }
        const turnDelta = Math.max(-turnRate, Math.min(turnRate, diff));
        agent.angle += turnDelta;
        // Cumul de rotation NETTE (signée, pas la somme des valeurs absolues) pendant un
        // échappement actif : sert à détecter une boucle complétée plus bas. La valeur absolue
        // confondrait un vrai tour complet avec un simple zigzag/bruit de collision, qui accumule
        // aussi une grosse somme sans jamais vraiment tourner en rond (les virages en sens
        // opposés s'annulent avec la version signée, mais pas avec la valeur absolue).
        if(agent._escapeUntil && t < agent._escapeUntil){
          agent._escapeAngleAccum = (agent._escapeAngleAccum||0) + turnDelta;
        }
      }

      let currentSpeed = speed * (agent.type==='chasseur'?1.08 : agent.type==='fugitif'?1.15 : agent.type==='predateur'?1.08 : agent.type==='poisson'?1.15 : agent.type==='ouvriere'?0.85 : agent.type==='eclaireuse'?1.05 : agent.type==='soldat'?0.95 : agent.type==='reine'?0 : 1.0);
      if(agent._panicIntensity){
        // Proportionnel à l'intensité (qui retombe progressivement, voir plus haut) plutôt qu'un
        // ×1.8 fixe : un agent qui vient de fuir garde un peu d'élan un moment après être sorti
        // du danger, au lieu de retomber instantanément à vitesse normale.
        currentSpeed *= 1 + 0.8*agent._panicIntensity;
      }
      if(agent.type==='predateur' && agent._preyDist! < 45){
        // Primitive "sursautAttaque" (established, Domenici & Blake 1997 — "fast-start"/C-start
        // des poissons prédateurs) : accélération brève réservée à l'attaque finale à courte
        // distance, pas une vitesse de croisière soutenue — pondérée par la motivation de chasse.
        currentSpeed *= 1 + 0.7*(agent._huntMotivation ?? 1);
      }
      if(agent.type==='pieton'){
        // Primitive "congestionRalentissement" (established, Helbing, Farkas & Vicsek 2000 —
        // "faster-is-slower") : plus les piétons sont tassés localement, plus la vitesse
        // effective chute — c'est ce mécanisme, pas la panique elle-même, qui crée l'embouteillage
        // paradoxal à un goulot d'étranglement.
        let crowdCount = 0;
        forEachNearbyAgents(agent.x, agent.y, 18, other=>{
          if(other===agent || other.type!=='pieton') return;
          if(Math.hypot(other.x-agent.x, other.y-agent.y) < 18) crowdCount++;
        });
        // Plancher à 20% de la vitesse normale : sans lui, une masse assez dense ralentit vers
        // zéro sans jamais littéralement s'arrêter, ce qui devient indiscernable d'un vrai blocage.
        currentSpeed *= Math.max(0.2, 1 / (1 + crowdCount*congestionStrength));
      }
      agent._lastSpeed = currentSpeed;

      agent.x += Math.cos(agent.angle)*currentSpeed*dt;
      agent.y += Math.sin(agent.angle)*currentSpeed*dt;

      if(agent.id===selectedAgentId){
        selectedTrail.push({x:agent.x, y:agent.y});
        if(selectedTrail.length>500) selectedTrail.shift();
      }

      // --- ANTI-BLOCAGE : si l'agent veut avancer mais ne progresse pas (interblocage), on le débloque ---
      // Primitive "antiBlocage" (adapted, Lumelsky & Stepanov 1987 — algorithmes "Bug") : détecte
      // le blocage et déclenche le suivi de contour défini plus haut, tant qu'il n'est pas déjà actif.
      agent._stuckTimer = (agent._stuckTimer||0) + dt;
      if(agent._stuckTimer > 0.5){
        const inEscape = !!(agent._escapeUntil && t < agent._escapeUntil);
        // Progrès réel vers l'objectif (champ de distance) quand disponible, pas seulement le
        // déplacement brut — dans une foule dense, un agent bousculé par ses voisins se déplace
        // de plusieurs unités sans jamais avancer vers la sortie ; le déplacement brut seul
        // masquait ce blocage et empêchait le contournement (ci-dessous) de jamais s'activer.
        // Seuil relatif à la vitesse courante (déjà réduite par la congestion légitime), pas un
        // chiffre fixe : sans ça, une foule dense mais qui avance normalement (juste ralentie)
        // se fait passer pour bloquée en permanence, dès que la congestion réduit sa vitesse.
        const expectedProgress = Math.max(1, (agent._lastSpeed ?? 0) * 0.5 * 0.15);
        const goalDist = sampleGoalDistance(agent.x, agent.y);
        let stuck: boolean;
        if(goalDist >= 0){
          const lastGoalDist = agent._lastCheckGoalDist ?? goalDist;
          stuck = (lastGoalDist - goalDist) < expectedProgress;
        } else {
          stuck = Math.hypot(agent.x-agent._lastCheckX, agent.y-agent._lastCheckY) < expectedProgress;
        }
        agent._lastCheckGoalDist = goalDist >= 0 ? goalDist : undefined;
        // Blocage persistant (plusieurs vérifications de suite), pas une seule fenêtre isolée :
        // dans une foule dense, le progrès sur 0.5s oscille beaucoup à cause de la bousculade
        // (collisions entre voisins), même quand la tendance de fond avance bien — une fenêtre
        // isolée sous le seuil ne veut rien dire, un agent réellement bloqué l'est sur plusieurs
        // vérifications d'affilée. Remis à zéro pendant un échappement déjà actif (qui ne
        // progresse pas vers l'objectif par nature, suivant le contour du mur) pour ne pas
        // ré-enchaîner un nouvel échappement dès la fin du précédent.
        agent._stuckStreak = (!inEscape && stuck) ? (agent._stuckStreak||0) + 1 : 0;
        if(hasDesire && agent._stuckStreak >= 4 && !inEscape){
          // Déclenche un échappement soutenu (suivi de contour), pas juste un coup de volant :
          // sinon la recherche d'objectif, recalculée dès la frame suivante, annule le correctif.
          // Principe Bug2 (Lumelsky & Stepanov 1987) : on ne sort du suivi de contour que sur un
          // vrai progrès mesuré, pas sur un minuteur arbitraire qui peut couper court en plein
          // virage d'un couloir complexe — le délai ci-dessous n'est qu'un filet de sécurité.
          agent._escapeUntil = t + 6;
          agent._escapeStartX = agent.x; agent._escapeStartY = agent.y;
          agent._escapeAngleAccum = 0;
          // Sens de contournement : suit la tangente qui rapproche le plus de l'objectif (champ de
          // distance) plutôt qu'un tirage à pile ou face — sinon un contournement sur deux part
          // brièvement dans le mauvais sens avant de se corriger. Repli sur le tirage aléatoire si
          // aucun mur à portée ou aucun champ de distance disponible pour ce scénario.
          agent._escapeSign = rand()<0.5 ? -1 : 1;
          let bdSign=Infinity, obsCpSign=null as Point | null;
          for(const o of obstacles){
            const cp = closestPointOnWall(agent.x, agent.y, o.points);
            const d = Math.hypot(agent.x-cp.x, agent.y-cp.y);
            if(d<bdSign){ bdSign=d; obsCpSign=cp; }
          }
          if(obsCpSign){
            const nx = agent.x-obsCpSign.x, ny = agent.y-obsCpSign.y;
            const nd = Math.hypot(nx,ny)||1;
            const tx = -ny/nd, ty = nx/nd;
            const dPlus = sampleGoalDistance(agent.x+tx*30, agent.y+ty*30);
            const dMinus = sampleGoalDistance(agent.x-tx*30, agent.y-ty*30);
            if(dPlus>=0 && dMinus>=0 && dPlus!==dMinus){
              agent._escapeSign = dPlus < dMinus ? 1 : -1;
            }
          }
        }
        agent._lastCheckX = agent.x; agent._lastCheckY = agent.y;
        agent._stuckTimer = 0;
      }

      // bords
      const pad=16;
      const menuMargin = MENU_BAR_H*zoneScale;
      if(boundaryMode==='wrap'){
        // Primitive "topologieTorique" (established) : sort d'un côté, réapparaît de l'autre.
        if(agent.x<0) agent.x += worldW;
        if(agent.x>worldW) agent.x -= worldW;
        if(agent.y<0) agent.y += worldH-menuMargin;
        if(agent.y>worldH-menuMargin) agent.y -= (worldH-menuMargin);
      } else if(boundaryMode==='perceive'){
        // Filet de sécurité de position uniquement : la direction n'est jamais inversée ici,
        // la perception anticipée (ci-dessus) est censée avoir déjà évité le contact.
        if(agent.x<pad) agent.x=pad;
        if(agent.x>worldW-pad) agent.x=worldW-pad;
        if(agent.y<pad) agent.y=pad;
        if(agent.y>worldH-pad-menuMargin) agent.y=worldH-pad-menuMargin;
      } else {
        // Primitive "rebondBord" (artifact) : réflexion physique instantanée au contact.
        if(agent.x<pad){agent.x=pad; agent.angle = Math.PI-agent.angle;}
        if(agent.x>worldW-pad){agent.x=worldW-pad; agent.angle = Math.PI-agent.angle;}
        if(agent.y<pad){agent.y=pad; agent.angle = -agent.angle;}
        if(agent.y>worldH-pad-menuMargin){agent.y=worldH-pad-menuMargin; agent.angle = -agent.angle;}
      }

      disturbGridAt(agent.x, agent.y, agent.isPanicking ? 28 : 22);
    }

    if(toStarve.length>0){
      agents = agents.filter(a=>!toStarve.includes(a));
    }
    if(toEvacuate.length>0){
      agents = agents.filter(a=>!toEvacuate.includes(a));
      totalEvacuated += toEvacuate.length;
    }

    // Primitive "naissanceProie" (established, Verhulst 1838 croissance logistique ; terme de
    // reproduction des proies dans Lotka 1925 / Volterra 1926) : natalité activable/paramétrable.
    // Exclusive au scénario Poisson — Heider-Simmel reste une démonstration minimale, sans écologie.
    if(popDynamicsMode && scenario==='poisson'){
      const preyType = 'poisson';
      birthAccumulator += dt;
      if(birthAccumulator > 1){
        birthAccumulator = 0;
        const preyCount = agents.filter(a=>a.type===preyType).length;
        if((noCapacityLimit || preyCount < carryingCapacity) && preyCount > 0 && rand() < birthRate){
          const parent = agents.filter(a=>a.type===preyType)[Math.floor(rand()*preyCount)];
          addAgent(preyType, parent.x + (rand()-0.5)*30, parent.y + (rand()-0.5)*30);
          totalBirths++;
        }
      }
    }

    // --- Empêche la superposition ---
    // Primitive "separationCorps" (adapted) : contrainte d'exclusion de volume, pas un comportement social en soi.
    const toEat = new Set();
    const iterations = 3;
    // Grille reconstruite une seule fois pour les 3 itérations de relaxation : chaque correction
    // ne déplace un agent que de quelques pixels, bien moins que la taille de cellule — rester sur
    // la même grille pour les 3 passes reste donc correct et évite de la reconstruire à chaque fois.
    rebuildAgentGrid();
    const COLLISION_SEARCH_RADIUS = 30; // > (rayon max d'un agent × 2 + marge de fusion de 2)
    for(let iter=0; iter<iterations; iter++){
      for(let i=0;i<agents.length;i++){
        const a = agents[i];
        forEachNearbyAgents(a.x, a.y, COLLISION_SEARCH_RADIUS, other=>{
          if(other._gidx! <= a._gidx!) return; // ordre stable de la grille : chaque paire traitée une fois
          const b = other;
          const dx=b.x-a.x, dy=b.y-a.y;
          let d=Math.hypot(dx,dy);
          const minD = TYPES[a.type].radius + TYPES[b.type].radius + 2;
          if(d<minD){
            // Primitive "predationContact" (adapted) : un chasseur au contact d'un fugitif l'élimine.
            // Primitives "confusionPredateur" (established, Landeau & Terborgh 1986) et
            // "predationBordure" (established, Hamilton 1971 — théorie du "troupeau égoïste") :
            // la capture n'est plus automatique, sa probabilité chute avec la densité locale de
            // poissons autour de la cible. La prédation de bordure en découle naturellement, sans
            // code séparé : un poisson en périphérie a moins de voisins, donc moins de confusion,
            // donc plus de risque — exactement le mécanisme décrit dans la littérature.
            if(predationMode && scenario==='poisson'){
              let predator=null, prey=null;
              if(a.type==='predateur' && b.type==='poisson'){ predator=a; prey=b; }
              else if(b.type==='predateur' && a.type==='poisson'){ predator=b; prey=a; }
              if(predator && prey){
                let neighborCount = 0;
                forEachNearbyAgents(prey.x, prey.y, 45, other2=>{
                  if(other2===prey || other2.type!=='poisson') return;
                  if(Math.hypot(other2.x-prey.x, other2.y-prey.y) < 45) neighborCount++;
                });
                const captureProb = 1 / (1 + neighborCount*confusionStrength);
                if(rand() < captureProb){
                  toEat.add(prey);
                  predator._hunger = 0;
                  if(neighborCount < 3) edgeCaptures++; else interiorCaptures++;
                }
              }
            }
            // Même primitive réutilisée côté colonie : le soldat neutralise l'intrus au contact ;
            // à défaut d'interception, l'intrus élimine la fourmi non-combattante qu'il rattrape,
            // qui laisse un cadavre au sol (voir primitive "necrophorese").
            if(scenario==='ants'){
              const isVulnerable = (t: string) => ['ouvriere','eclaireuse','nourrice','fossoyeuse'].includes(t);
              if(a.type==='soldat' && b.type==='intrus') toEat.add(b);
              else if(b.type==='soldat' && a.type==='intrus') toEat.add(a);
              else if(a.type==='intrus' && isVulnerable(b.type)){ toEat.add(b); corpses.push({x:b.x,y:b.y,age:0}); }
              else if(b.type==='intrus' && isVulnerable(a.type)){ toEat.add(a); corpses.push({x:a.x,y:a.y,age:0}); }
            }
            if(d<0.0001){ d=0.0001; }
            const nx=dx/d, ny=dy/d;
            // léger angle de glissement aléatoire : évite que deux agents restent bloqués nez-à-nez
            const jitter=(rand()-0.5)*0.6;
            const cs=Math.cos(jitter), sn=Math.sin(jitter);
            const jnx=nx*cs-ny*sn, jny=nx*sn+ny*cs;
            // La reine a une masse effectivement infinie : jamais déplacée, même percutée.
            const aFixed = a.type==='reine', bFixed = b.type==='reine';
            if(aFixed && !bFixed){
              b.x += jnx*(minD-d); b.y += jny*(minD-d);
            } else if(bFixed && !aFixed){
              a.x -= jnx*(minD-d); a.y -= jny*(minD-d);
            } else if(!aFixed && !bFixed){
              const overlap=(minD-d)/2;
              a.x -= jnx*overlap; a.y -= jny*overlap;
              b.x += jnx*overlap; b.y += jny*overlap;
            }
          }
        });
      }
      for(const a of agents){
        for(const o of obstacles){
          const cp = closestPointOnWall(a.x, a.y, o.points);
          const dx=a.x-cp.x, dy=a.y-cp.y;
          let d=Math.hypot(dx,dy);
          const minD = o.thickness + TYPES[a.type].radius + 1;
          if(d<minD){
            if(d<0.0001){ d=0.0001; }
            const nx=dx/d, ny=dy/d;
            const push = minD-d;
            a.x += nx*push; a.y += ny*push;
          }
        }
      }
    }

    if(toEat.size>0){
      agents = agents.filter(a=>!toEat.has(a));
    }

  // ---- fin du corps historique ----

  // Réécriture des champs réassignés dans le corps ci-dessus (agents/corpses via
  // .filter(), compteurs et horloge) : un import ne peut pas être réassigné par le
  // module qui l'importe, donc l'écriture doit repasser explicitement par `state`.
  state.t = t;
  state.agents = agents;
  state.corpses = corpses;
  state.birthAccumulator = birthAccumulator;
  state.totalBirths = totalBirths;
  state.totalEvacuated = totalEvacuated;
  state.edgeCaptures = edgeCaptures;
  state.interiorCaptures = interiorCaptures;
}
