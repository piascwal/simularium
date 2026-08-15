// @ts-nocheck
// Corps du moteur historique (monofichier), déplacé verbatim ici en Phase 0.
// Sera découpé en modules typés core/render/ui dans la Phase 1 (voir le plan de migration).
import { rand } from './core/rng';
import { MENU_BAR_H, CELL, PCELL, DIST_CELL, AGENT_CELL, OBSTACLE_DRAW_SPACING } from './core/constants';
import { closestPointOnSegment, closestPointOnWall } from './core/grid/geometry';
import { gcols, grows, grid, gage, initGrid, gidx, stepConway, disturbGridAt } from './core/grid/conway';
import { pcols, prows, pidx, pherReturn, pherSearch, initPheromoneGrid, depositPheromone, samplePheromone, evaporatePheromone } from './core/grid/pheromone';
import { sampleNestDistance, maybeRecomputeNestField } from './core/grid/nestDistance';
import { buildAgentGrid, forEachNearby, nearestBy } from './core/grid/agentSpatialHash';
import { SCENARIO_TYPES, SCENARIO_SLIDER_DEFAULTS } from './core/scenarios';
import { PRIMITIVES, statusMeta } from './core/primitives';
(function(){
  const canvas = document.getElementById('cv');
  const ctx = canvas.getContext('2d');
  let W=0, H=0, DPR=1;
  let zoneScale = 1, worldW=0, worldH=0;

  function updateWorldSize(){
    worldW = W*zoneScale;
    worldH = H*zoneScale;
    initGrid(worldW, worldH);
    initPheromoneGrid(worldW, worldH);
    recomputeNestFieldForCurrentState();
  }
  function resize(){
    DPR = Math.min(window.devicePixelRatio||1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W*DPR; canvas.height = H*DPR;
    ctx.setTransform(DPR,0,0,DPR,0,0);
    updateWorldSize();
  }
  window.addEventListener('resize', resize);

  // ---------- Grille de Conway ----------
  // initGrid / gidx / stepConway / disturbGridAt : voir core/grid/conway.ts

  // ---------- Obstacles en polyligne (tracé libre + épaisseur réglable) ----------
  // closestPointOnSegment / closestPointOnWall : voir core/grid/geometry.ts

  // ---------- Champ de distances au nid (colonie de fourmis) ----------
  // computeNestDistanceField / sampleNestDistance / maybeRecomputeNestField :
  // voir core/grid/nestDistance.ts
  function recomputeNestFieldForCurrentState(){
    maybeRecomputeNestField(scenario==='ants', agents.find(a=>a.type==='reine'), worldW, worldH, obstacles);
  }

  // ---------- Phéromones (colonie de fourmis) ----------
  // initPheromoneGrid / pidx / depositPheromone / samplePheromone / evaporatePheromone :
  // voir core/grid/pheromone.ts
  // ---------- Grille spatiale des agents (accélère les requêtes de voisinage) ----------
  // buildAgentGrid / forEachNearby / nearestBy : voir core/grid/agentSpatialHash.ts
  function rebuildAgentGrid(){ buildAgentGrid(agents, worldW, worldH); }

  // ---------- Agents ----------
  // SCENARIO_TYPES : voir core/scenarios/*.ts
  let scenario = 'heider';
  let TYPES = SCENARIO_TYPES[scenario];
  let agents = [];
  let refuge = null;
  let obstacles = [];
  let food = [];       // colonie de fourmis : {x,y,r,qty}
  let exits = [];      // foule humaine : {x,y,r} — sorties recherchées par les piétons
  let alarms = [];     // foule humaine : {x,y,r} — déclenche la panique à proximité
  let antCarryingCapacity = 26;
  let antNoCapacityLimit = false;
  let corpses = []; // {x,y,age} — cadavres en attente d'évacuation (nécrophorèse)
  function getMidden(){ return { x: worldW*0.92, y: worldH*0.92 }; }
  function ageCorpses(dt){
    for(const c of corpses) c.age += dt;
    corpses = corpses.filter(c => c.age < 20); // décomposition naturelle après 20s sans évacuation
  }

  function addAgent(type,x,y){
    agents.push({
      type, x, y,
      angle: rand()*Math.PI*2,
      wander: rand()*1000,
      id: rand().toString(36).slice(2),
      isPanicking: false,
      _stuckTimer: 0,
      _lastCheckX: x,
      _lastCheckY: y,
      _carryingFood: false,
      _carryingCorpse: false,
      _spawnCooldown: 0
    });
  }

  function reset(){
    agents = [];
    refuge = null;
    obstacles = [];
    food = [];
    exits = [];
    alarms = [];
    corpses = [];
    edgeCaptures = 0;
    interiorCaptures = 0;
    totalBirths = 0;
    totalEvacuated = 0;
    deselectAgent();
    statsHistory = [];
    renderStatsChart();
  }

  function relation(self, other){
    if(scenario==='heider'){
      if(self==='fugitif' && other==='chasseur') return -1;
      if(self==='fugitif' && other==='gardien') return -0.3;
      if(self==='fugitif' && other==='neutre') return -0.2;
      if(self==='chasseur' && other==='fugitif') return 1;
      if(self==='chasseur' && other==='gardien') return -1.4;
      if(self==='gardien' && other==='chasseur') return 0;
      if(self==='gardien' && other==='fugitif') return 0;
      if(self==='neutre') return other==='neutre' ? 0 : -0.15;
      return 0;
    }
    if(scenario==='poisson'){
      // Même mécanisme générique que chasseur/fugitif, seul l'habillage change —
      // exactement la validation d'architecture recherchée.
      if(self==='poisson' && other==='predateur') return -1;
      if(self==='predateur' && other==='poisson') return 1;
      return 0;
    }
    return 0;
  }

  function nearest(agent, type){
    return nearestBy(agent, o=>o.type===type);
  }

  // Catalogue de primitives comportementales (PRIMITIVES) et statusMeta : voir core/primitives.ts

  function getActivePrimitiveIds(){
    const boundaryId = boundaryMode==='wrap' ? 'topologieTorique' : boundaryMode==='perceive' ? 'perceptionBord' : 'rebondBord';
    if(scenario==='ants'){
      return ['suivreGradient','explorationScout','deposerTrace','marquageExploration','grilleDistanceNid','integrationTrajet','roleStatique','soinCouvain','necrophorese','poursuivre','fuir','errance','evitementObstacle','separationCorps','antiBlocage', boundaryId];
    }
    if(scenario==='poisson'){
      const ids = ['poursuivre','fuir','cohesionBanc','errance','evitementObstacle','separationCorps','antiBlocage','sursautAttaque', boundaryId];
      if(loomingMode) ids.push('looming');
      if(predationMode){ ids.push('predationContact'); ids.push('confusionPredateur'); ids.push('predationBordure'); }
      if(popDynamicsMode){ ids.push('mortParFamine'); ids.push('naissanceProie'); ids.push('motivationSatiete'); }
      return ids;
    }
    if(scenario==='foule'){
      const ids = ['rechercheSortie','harde','congestionRalentissement','evitementObstacle','separationCorps','antiBlocage', boundaryId];
      if(loomingMode){ ids.push('looming'); ids.push('fuir'); }
      return ids;
    }
    const ids = ['poursuivre','fuir','interposition','errance','evitementObstacle','separationCorps','antiBlocage', boundaryId];
    if(loomingMode) ids.push('looming');
    return ids;
  }


  function renderPrimitiveBadges(){
    const el = document.getElementById('primitiveBadges');
    if(!el) return;
    const ids = getActivePrimitiveIds();
    el.innerHTML = ids.map(id=>{
      const p = PRIMITIVES[id];
      const sm = statusMeta(p.status);
      const refLine = p.ref ? `<div class="prim-ref">${p.ref}</div>` : `<div class="prim-ref prim-ref-none">Aucune référence \u2014 artefact d\u2019ingénierie assumé</div>`;
      return `<div class="prim-badge">
        <div class="prim-head"><span class="prim-dot" style="background:${sm.dot}"></span><span class="prim-label">${p.label}</span><span class="prim-status">${sm.word}</span></div>
        <div class="prim-desc">${p.desc}</div>
        ${refLine}
      </div>`;
    }).join('');
  }

  let t=0;
  function updateAgents(dt, perception, forceMag, speed, panicRadius){
    t += dt;
    evaporatePheromone(dt);
    ageCorpses(dt);
    rebuildAgentGrid();
    // Reine mise en cache une fois par frame : appeler agents.find() depuis chaque fourmi
    // (comme avant) redevient O(n) par fourmi, donc O(n²) au global sur une grosse colonie.
    const queenRef = scenario==='ants' ? agents.find(a=>a.type==='reine') : null;

    // --- pré-passe : chasseurs ---
    for(const a of agents){
      if(a.type!=='chasseur') continue;
      const fu = nearest(a,'fugitif');
      const ga = nearest(a,'gardien');
      a._fleeing = !!(ga && ga.d < perception);
      a._hunting = !a._fleeing && !!(fu && fu.d < perception);
      a._target = fu;
    }

    const toStarve = [];
    const toEvacuate = [];
    for(const agent of agents){
      let desiredX = Math.cos(agent.angle), desiredY = Math.sin(agent.angle);
      let hasDesire = false;
      agent.isPanicking = false;

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
          forEachNearby(agent.x, agent.y, boidRadius, other=>{
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
        if(nearestExit){
          if(exitRemovesAgents && bdE < nearestExit.r){
            toEvacuate.push(agent);
          }
          const dx=nearestExit.x-agent.x, dy=nearestExit.y-agent.y;
          const d=Math.hypot(dx,dy)||1;
          desiredX += (dx/d)*1.2; desiredY += (dy/d)*1.2; hasDesire=true;
        }

        // Primitive "harde" (established, Couzin et al. 2002 ; Moussaïd et al. 2011) : tendance
        // à s'aligner sur la direction moyenne des piétons proches, surtout utile quand la vue
        // dégagée sur la sortie manque — un comportement de suivi de foule, pas d'imitation volontaire.
        let ax=0, ay=0, nH=0;
        const herdRadius = perception*0.4;
        forEachNearby(agent.x, agent.y, herdRadius, other=>{
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
            agent.isPanicking = true;
            const dx = agent.x-nearestAlarm.x, dy = agent.y-nearestAlarm.y;
            const d = Math.hypot(dx,dy)||1;
            desiredX += (dx/d)*12.0; desiredY += (dy/d)*12.0; hasDesire=true;
          }
        }
      }

      if(agent.type==='gardien'){
        // Primitive "interposition" (adapted) : se place entre le chasseur en chasse et sa cible.
        let bestCh=null, bestD=Infinity;
        forEachNearby(agent.x, agent.y, perception, other=>{
          if(other.type==='chasseur' && other._hunting){
            const d=Math.hypot(other.x-agent.x, other.y-agent.y);
            if(d<perception && d<bestD){ bestD=d; bestCh=other; }
          }
        });
        if(bestCh && bestCh._target){
          const fu = bestCh._target.a;
          const mx=(bestCh.x+fu.x)/2, my=(bestCh.y+fu.y)/2;
          const dx=mx-agent.x, dy=my-agent.y;
          const d=Math.hypot(dx,dy)||1;
          desiredX += (dx/d)*1.2; desiredY += (dy/d)*1.2; hasDesire=true;
        }
      }

      if(agent.type==='neutre'){
        // Primitive "errance" (adapted) : marche aléatoire simplifiée, sans but.
        const n = Math.sin(agent.wander+t*0.6)*0.6;
        agent.angle += n*dt;
      }

      if(agent.type==='chasseur' && !agent._hunting && !agent._fleeing){
        // Primitive "errance" (adapted) : sans cible en vue, recherche active plutôt que ligne
        // droite indéfinie — sinon le chasseur peut ne jamais retomber sur un fugitif hors de vue.
        const n = Math.sin(agent.wander+t*0.6)*0.6;
        agent.angle += n*dt;
      }

      // ================= COLONIE DE FOURMIS =================
      if(agent.type==='ouvriere' || agent.type==='eclaireuse'){
        const isScout = agent.type==='eclaireuse';
        const queen = queenRef;
        agent._followingTrail = false;

        // Primitive "fuir" (established, Dawkins & Krebs 1979) réutilisée telle quelle :
        // un intrus détecté à proximité prend le pas sur le butinage, sans exception.
        const intrusHit = nearestBy(agent, o=>o.type==='intrus', perception*0.6);
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
            const myDist = sampleNestDistance(agent.x, agent.y);
            if(myDist >= 0){
              const sampleD = DIST_CELL*1.4;
              const angles = [agent.angle, agent.angle-0.5, agent.angle+0.5, agent.angle-1.1, agent.angle+1.1];
              let bestA = agent.angle, bestV = myDist;
              for(const ang of angles){
                const v = sampleNestDistance(agent.x+Math.cos(ang)*sampleD, agent.y+Math.sin(ang)*sampleD);
                if(v>=0 && v<bestV){ bestV=v; bestA=ang; }
              }
              desiredX += Math.cos(bestA)*1.8; desiredY += Math.sin(bestA)*1.8; hasDesire=true;
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
        const intrusHit = nearestBy(agent, o=>o.type==='intrus', perception);
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
        const targetHit = nearestBy(agent, o=>o.type==='ouvriere' || o.type==='eclaireuse' || o.type==='nourrice' || o.type==='fossoyeuse', perception);
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
        const nourriceIntrusHit = nearestBy(agent, o=>o.type==='intrus', perception*0.6);
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
        forEachNearby(agent.x, agent.y, perception, other=>{
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
          const escapedDist = Math.hypot(agent.x-agent._escapeStartX, agent.y-agent._escapeStartY);
          if(escapedDist > 45) agent._escapeUntil = 0;
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
        agent.angle += Math.max(-turnRate, Math.min(turnRate, diff));
      }

      let currentSpeed = speed * (agent.type==='chasseur'?1.08 : agent.type==='fugitif'?1.15 : agent.type==='predateur'?1.08 : agent.type==='poisson'?1.15 : agent.type==='ouvriere'?0.85 : agent.type==='eclaireuse'?1.05 : agent.type==='soldat'?0.95 : agent.type==='reine'?0 : 1.0);
      if(agent.isPanicking) {
        currentSpeed *= 1.8;
      }
      if(agent.type==='predateur' && agent._preyDist < 45){
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
        forEachNearby(agent.x, agent.y, 18, other=>{
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
        const moved = Math.hypot(agent.x-agent._lastCheckX, agent.y-agent._lastCheckY);
        if(hasDesire && moved < 3 && !(agent._escapeUntil && t < agent._escapeUntil)){
          // Déclenche un échappement soutenu (suivi de contour), pas juste un coup de volant :
          // sinon la recherche d'objectif, recalculée dès la frame suivante, annule le correctif.
          // Principe Bug2 (Lumelsky & Stepanov 1987) : on ne sort du suivi de contour que sur un
          // vrai progrès mesuré, pas sur un minuteur arbitraire qui peut couper court en plein
          // virage d'un couloir complexe — le délai ci-dessous n'est qu'un filet de sécurité.
          agent._escapeUntil = t + 6;
          agent._escapeStartX = agent.x; agent._escapeStartY = agent.y;
          agent._escapeSign = rand()<0.5 ? -1 : 1;
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
        forEachNearby(a.x, a.y, COLLISION_SEARCH_RADIUS, other=>{
          if(other._gidx <= a._gidx) return; // ordre stable de la grille : chaque paire traitée une fois
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
                forEachNearby(prey.x, prey.y, 45, other2=>{
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
              const isVulnerable = t => ['ouvriere','eclaireuse','nourrice','fossoyeuse'].includes(t);
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
  }

  // ---------- Rendu ----------
  function drawShape(agent){
    let c = TYPES[agent.type].color;
    if(agent.isPanicking) c = '#ff3366';

    ctx.save();
    ctx.translate(agent.x, agent.y);

    // Anneau d'alerte pulsant : signale clairement l'activation du Looming sans dessiner
    // une forme qui pourrait se lire comme un agent supplémentaire.
    if(agent.isPanicking){
      const cycle = ((t*2.4 + agent.wander*0.002) % 1);
      const ringR = 9 + cycle*13;
      const ringAlpha = (1-cycle) * 0.9;
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(255,51,102,${ringAlpha})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }

    // Anneau fixe et discret : cette fourmi a détecté et suit la piste de retour d'une autre.
    if(agent._followingTrail){
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, TYPES[agent.type].radius+4, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(95,196,232,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // Traînées de vitesse courtes : signalent le sursaut d'attaque (fast-start) sans dessiner de
    // forme pleine derrière l'agent — même principe que l'anneau Looming, jamais une silhouette
    // qui pourrait se lire comme un second agent.
    if(agent.type==='predateur' && agent._preyDist!==undefined && agent._preyDist < 45){
      const back = agent.angle + Math.PI;
      const pulse = 0.6 + Math.sin(t*22)*0.4;
      ctx.save();
      ctx.strokeStyle = `rgba(255,140,90,${0.55*pulse})`;
      ctx.lineWidth = 1.5;
      [-6, 0, 6].forEach(off=>{
        const a2 = back + off*0.06;
        const len = 9 + pulse*7;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a2)*7, Math.sin(a2)*7);
        ctx.lineTo(Math.cos(a2)*(7+len), Math.sin(a2)*(7+len));
        ctx.stroke();
      });
      ctx.restore();
    }

    ctx.rotate(agent.angle);
    ctx.fillStyle = c;
    ctx.shadowColor = c;
    ctx.shadowBlur = agent.isPanicking ? 16 : 10;

    ctx.fillStyle = c;
    switch(TYPES[agent.type].shape){
      case 'triangleBig':
        ctx.beginPath();
        ctx.moveTo(11,0); ctx.lineTo(-7,6.5); ctx.lineTo(-7,-6.5);
        ctx.closePath(); ctx.fill();
        break;
      case 'triangleSmall':
        ctx.beginPath();
        ctx.moveTo(7,0); ctx.lineTo(-4.5,4); ctx.lineTo(-4.5,-4);
        ctx.closePath(); ctx.fill();
        break;
      case 'circle':
        ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fill();
        break;
      case 'square':
        ctx.fillRect(-5,-5,10,10);
        break;
    }
    ctx.restore();
  }

  function render(){
    ctx.clearRect(0,0,W,H);
    ctx.save();
    ctx.scale(1/zoneScale, 1/zoneScale);
    
    if(grid){
      for(let y=0;y<grows;y++){
        for(let x=0;x<gcols;x++){
          const a = gage[gidx(x,y)];
          if(a>0){
            ctx.fillStyle = `rgba(90,120,110,${0.05+a*0.16})`;
            ctx.fillRect(x*CELL+1, y*CELL+1, CELL-2, CELL-2);
          }
        }
      }
    }

    if(scenario==='ants' && pherReturn){
      for(let y=0;y<prows;y++){
        for(let x=0;x<pcols;x++){
          if(showPherSearch){
            const vs = pherSearch[pidx(x,y)];
            if(vs>0.01){
              ctx.fillStyle = `rgba(232,150,60,${Math.min(0.4,vs*0.45)})`;
              ctx.fillRect(x*PCELL, y*PCELL, PCELL, PCELL);
            }
          }
          if(showPherReturn){
            const vr = pherReturn[pidx(x,y)];
            if(vr>0.01){
              ctx.fillStyle = `rgba(120,196,110,${Math.min(0.55,vr*0.6)})`;
              ctx.fillRect(x*PCELL, y*PCELL, PCELL, PCELL);
            }
          }
        }
      }
      for(const f of food){
        ctx.save();
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(232,184,75,${0.12+0.5*Math.min(1,f.qty/f.maxQty)})`;
        ctx.fill();
        ctx.strokeStyle = '#e8b84b'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
      if(corpses.length>0){
        const midden = getMidden();
        ctx.save();
        ctx.strokeStyle = 'rgba(122,116,96,0.5)'; ctx.setLineDash([3,3]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(midden.x, midden.y, 16, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
        for(const c of corpses){
          ctx.save();
          ctx.globalAlpha = Math.max(0.25, 1 - c.age/20);
          ctx.strokeStyle = '#7a7460'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(c.x-4,c.y-4); ctx.lineTo(c.x+4,c.y+4);
          ctx.moveTo(c.x+4,c.y-4); ctx.lineTo(c.x-4,c.y+4); ctx.stroke();
          ctx.restore();
        }
      }
    }

    for(const o of obstacles){
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if(o.points.length===1){
        const p = o.points[0];
        ctx.beginPath(); ctx.arc(p.x, p.y, o.thickness, 0, Math.PI*2);
        ctx.fillStyle = '#23272b'; ctx.fill();
        ctx.strokeStyle = '#585f66'; ctx.lineWidth = 2; ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(o.points[0].x, o.points[0].y);
        for(let i=1;i<o.points.length;i++) ctx.lineTo(o.points[i].x, o.points[i].y);
        ctx.strokeStyle = '#23272b'; ctx.lineWidth = o.thickness*2; ctx.stroke();
        ctx.strokeStyle = '#585f66'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
    }
    
    if(refuge){
      ctx.save(); ctx.strokeStyle = 'rgba(89,196,140,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([6,5]);
      ctx.beginPath(); ctx.arc(refuge.x, refuge.y, refuge.r, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = 'rgba(89,196,140,0.06)'; ctx.fill(); ctx.restore();
    }

    if(scenario==='foule'){
      for(const ex of exits){
        ctx.save(); ctx.strokeStyle = 'rgba(89,196,140,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([6,5]);
        ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI*2); ctx.stroke();
        ctx.fillStyle = 'rgba(89,196,140,0.1)'; ctx.fill(); ctx.restore();
      }
      for(const al of alarms){
        const pulse = 6 + Math.sin(t*5)*3;
        ctx.save(); ctx.strokeStyle = 'rgba(255,51,102,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(al.x, al.y, 10+pulse, 0, Math.PI*2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,51,102,0.85)';
        ctx.beginPath(); ctx.arc(al.x, al.y, 5, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }
    }

    // --- Traînée persistante de l'agent sélectionné ---
    if(selectedTrail.length>1){
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(selectedTrail[0].x, selectedTrail[0].y);
      for(let i=1;i<selectedTrail.length;i++) ctx.lineTo(selectedTrail[i].x, selectedTrail[i].y);
      ctx.strokeStyle = 'rgba(255,214,90,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    for(const a of agents) drawShape(a);

    // --- Vecteurs de l'agent sélectionné : vitesse réelle (jaune) vs direction désirée (cyan) ---
    const selAgent = agents.find(a=>a.id===selectedAgentId);
    if(selAgent){
      ctx.save();
      ctx.beginPath(); ctx.arc(selAgent.x, selAgent.y, TYPES[selAgent.type].radius+7, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,214,90,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();

      const drawArrow = (x,y,angle,len,color)=>{
        const ex = x+Math.cos(angle)*len, ey = y+Math.sin(angle)*len;
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(ex,ey);
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        const ah = 6;
        ctx.beginPath();
        ctx.moveTo(ex,ey);
        ctx.lineTo(ex-Math.cos(angle-0.4)*ah, ey-Math.sin(angle-0.4)*ah);
        ctx.moveTo(ex,ey);
        ctx.lineTo(ex-Math.cos(angle+0.4)*ah, ey-Math.sin(angle+0.4)*ah);
        ctx.stroke();
      };
      // vecteur vitesse réelle (jaune) : direction effective de déplacement
      drawArrow(selAgent.x, selAgent.y, selAgent.angle, 26, 'rgba(255,214,90,0.95)');
      // vecteur désiré (cyan) : ce que la somme des comportements "voudrait" comme direction
      if(selAgent._lastHasDesire && (selAgent._lastDesiredX||selAgent._lastDesiredY)){
        const da = Math.atan2(selAgent._lastDesiredY, selAgent._lastDesiredX);
        drawArrow(selAgent.x, selAgent.y, da, 22, 'rgba(95,196,232,0.9)');
      }
      ctx.restore();
    }

    ctx.restore();
  }

  // ---------- Boucle ----------
  let running = false, lastTime = 0, accTick = 0;
  let simSpeedMultiplier = 1;
  let statsAccum = 0;
  function loop(now){
    requestAnimationFrame(loop);
    if(!lastTime) lastTime = now;
    const dt = Math.min(0.05, (now-lastTime)/1000);
    lastTime = now;
    if(running){
      const perception = +document.getElementById('perception').value;
      const forceMag = +document.getElementById('force').value;
      const speed = +document.getElementById('speed').value;
      const panicRadius = +document.getElementById('panicRadius').value;
      for(let s=0; s<simSpeedMultiplier; s++){
        updateAgents(dt, perception, forceMag, speed, panicRadius);
        accTick += dt;
        if(accTick > 0.18){ stepConway(); accTick = 0; }
        statsAccum += dt;
        if(statsAccum > 1){ sampleStatsHistory(); statsAccum = 0; }
      }
    }
    render();
    updateInspector();
    updatePopCounter();
  }

  // ---------- UI ----------
  let selectedType = 'chasseur';
  let placeCount = 1;
  let mode = 'place';
  let loomingMode = true;
  let predationMode = false;
  let popDynamicsMode = false;
  let starvationTime = 20;   // secondes sans repas avant la mort du chasseur
  let birthRate = 0.15;      // probabilité de naissance par seconde écoulée (voir birthAccumulator)
  let birthAccumulator = 0;
  let cohesionWeight = 0.5;
  let alignmentWeight = 0.7;
  let separationWeight = 1.1;
  let confusionStrength = 0.15;
  let pheromoneRange = 26;

  // Valeurs par défaut pensées pour rapprocher chaque scénario du comportement de la population
  // étudiée, plutôt qu'un seul jeu de curseurs générique partagé sans rapport avec le sujet :
  // - Heider-Simmel : rayon élargi pour que chasseur/fugitif se détectent vite au démarrage,
  //   l'enjeu étant la lisibilité de la démonstration, pas une contrainte biologique.
  // - Fourmis : portée sensorielle courte (contact/antennes), sans pénaliser la détection
  //   d'intrus par les soldats au point de les rendre inefficaces.
  // - Poisson : rayon resserré + alignement dominant sur la cohésion, pour un banc polarisé et
  //   lisible par défaut (Couzin et al. 2002), plutôt qu'un nuage lâche.
  // - Foule : rayon de déclenchement du Looming élargi, une panique se percevant/se propageant
  //   au-delà de la seule proximité géographique immédiate (Helbing et al. 2000).
  // SCENARIO_SLIDER_DEFAULTS : voir core/scenarios/*.ts
  function applyScenarioSliderDefaults(){
    const d = SCENARIO_SLIDER_DEFAULTS[scenario];
    if(!d) return;
    for(const id in d){
      const el = document.getElementById(id);
      if(el){ el.value = d[id]; el.dispatchEvent(new Event('input', {bubbles:true})); }
    }
  }
  let congestionStrength = 0.12;
  let exitRemovesAgents = true; // true = sortie (évacuation), false = point de rassemblement
  let totalEvacuated = 0;
  let edgeCaptures = 0;
  let interiorCaptures = 0;
  let totalBirths = 0;
  let carryingCapacity = 24; // capacité de charge K (Verhulst 1838), réglable via slider
  let noCapacityLimit = false;
  let showPherReturn = true;
  let showPherSearch = true;
  let boundaryMode = 'bounce'; // 'bounce' | 'perceive' | 'wrap'
  let avoidanceSensitivity = 1.0; // 0.3 (permet de se faufiler) à 2.0 (évitement très large)
  let selectedAgentId = null;
  let selectedTrail = [];

  document.getElementById('loomingMode').addEventListener('change', function(){ loomingMode = this.checked; renderPrimitiveBadges(); updateConditionalRows(); });
  document.getElementById('predationMode').addEventListener('change', function(){ predationMode = this.checked; renderPrimitiveBadges(); updateConditionalRows(); });
  document.getElementById('popDynamicsMode').addEventListener('change', function(){
    popDynamicsMode = this.checked;
    renderPrimitiveBadges();
    updateConditionalRows();
  });
  document.getElementById('starvation').addEventListener('input', function(){
    starvationTime = +this.value;
    document.getElementById('vStarvation').textContent = this.value + 's';
  });
  document.getElementById('birthRateSlider').addEventListener('input', function(){
    birthRate = (+this.value)/100;
    document.getElementById('vBirthRate').textContent = this.value + '%';
  });
  document.getElementById('capacitySlider').addEventListener('input', function(){
    carryingCapacity = +this.value;
    document.getElementById('vCapacity').textContent = this.value;
  });
  document.getElementById('noCapacityLimit').addEventListener('change', function(){
    noCapacityLimit = this.checked;
    document.getElementById('rowCapacity').classList.toggle('hidden', noCapacityLimit || scenario==='ants' || !popDynamicsMode);
  });
  document.getElementById('cohesion').addEventListener('input', function(){
    cohesionWeight = (+this.value)/10;
    document.getElementById('vCohesion').textContent = cohesionWeight.toFixed(1);
  });
  document.getElementById('alignment').addEventListener('input', function(){
    alignmentWeight = (+this.value)/10;
    document.getElementById('vAlignment').textContent = alignmentWeight.toFixed(1);
  });
  document.getElementById('separation').addEventListener('input', function(){
    separationWeight = (+this.value)/10;
    document.getElementById('vSeparation').textContent = separationWeight.toFixed(1);
  });
  document.getElementById('confusion').addEventListener('input', function(){
    confusionStrength = (+this.value)/100;
    document.getElementById('vConfusion').textContent = this.value + '%';
  });
  document.getElementById('congestion').addEventListener('input', function(){
    congestionStrength = (+this.value)/100;
    document.getElementById('vCongestion').textContent = this.value + '%';
  });
  renderPrimitiveBadges();

  document.getElementById('showPherReturn').addEventListener('change', function(){ showPherReturn = this.checked; });
  document.getElementById('showPherSearch').addEventListener('change', function(){ showPherSearch = this.checked; });

  document.getElementById('antCapacitySlider').addEventListener('input', function(){
    antCarryingCapacity = +this.value;
    document.getElementById('vAntCapacity').textContent = this.value;
  });
  document.getElementById('pheromoneRangeSlider').addEventListener('input', function(){
    pheromoneRange = +this.value;
    document.getElementById('vPheromoneRange').textContent = this.value;
  });
  document.getElementById('antNoCapacityLimit').addEventListener('change', function(){
    antNoCapacityLimit = this.checked;
    document.getElementById('rowAntCapacity').classList.toggle('hidden', scenario!=='ants' || antNoCapacityLimit);
  });
  document.getElementById('exitRemovesAgents').addEventListener('change', function(){
    exitRemovesAgents = this.checked;
  });

  const SPEED_STEPS = [1,2,4];
  document.getElementById('speedCycleBtn').addEventListener('click', function(){
    const i = SPEED_STEPS.indexOf(simSpeedMultiplier);
    simSpeedMultiplier = SPEED_STEPS[(i+1) % SPEED_STEPS.length];
    const arrows = '⏩'.repeat(SPEED_STEPS.indexOf(simSpeedMultiplier)+1);
    this.textContent = `${arrows} Vitesse ×${simSpeedMultiplier}`;
  });
  document.getElementById('showPopCounter').addEventListener('change', function(){
    document.getElementById('popCounter').classList.toggle('hidden', !this.checked);
  });

  const HINT_TEXTS = {
    place: 'Touche la scène pour placer le type sélectionné, ou touche un agent pour l\u2019inspecter.',
    inspect: 'Touche un agent pour l\u2019inspecter, touche le vide pour désélectionner.',
    obstacle: 'Touche ou glisse pour tracer un obstacle.',
    refuge: 'Touche pour placer un refuge.',
    food: 'Touche pour placer une source de nourriture.',
    exit: 'Touche pour placer une sortie.',
    alarm: 'Touche pour placer une alarme.',
    erase: 'Touche ou glisse pour effacer un agent, un obstacle ou de la nourriture.'
  };
  function updateHintText(){
    document.getElementById('hint').textContent = HINT_TEXTS[mode] || HINT_TEXTS.place;
  }

  function clearToolButtons(){
    document.getElementById('inspectBtn').classList.remove('active');
    document.getElementById('refugeBtn').classList.remove('active');
    document.getElementById('foodBtn').classList.remove('active');
    document.getElementById('exitBtn').classList.remove('active');
    document.getElementById('alarmBtn').classList.remove('active');
    document.getElementById('obstacleBtn').classList.remove('active');
    document.getElementById('eraseBtn').classList.remove('active');
    document.getElementById('rowThickness').classList.add('hidden');
  }

  document.getElementById('inspectBtn').addEventListener('click', function(){
    mode = (mode==='inspect') ? 'place' : 'inspect'; clearToolButtons(); this.classList.toggle('active', mode==='inspect'); updateHintText();
  });

  function renderTypeButtons(){
    const container = document.getElementById('typesContainer');
    const keys = Object.keys(TYPES);
    container.innerHTML = keys.map((k,i)=>
      `<button class="type-btn${i===0?' active':''}" data-type="${k}"><span class="dot" style="background:${TYPES[k].color}"></span><span class="type-btn-label">${TYPES[k].label}</span><span class="type-btn-count"></span></button>`
    ).join('');
    selectedType = keys[0];
    placeCount = 1;
    container.querySelectorAll('.type-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(selectedType===btn.dataset.type){
          // Reclic sur le même type déjà sélectionné : fait cycler le nombre placé par clic.
          const steps=[1,5,10];
          placeCount = steps[(steps.indexOf(placeCount)+1) % steps.length];
        } else {
          // Changement de type : on repart toujours de ×1, pour éviter d'en placer trop par erreur.
          placeCount = 1;
        }
        container.querySelectorAll('.type-btn').forEach(b=>{
          b.classList.remove('active');
          b.querySelector('.type-btn-count').textContent = '';
        });
        btn.classList.add('active');
        btn.querySelector('.type-btn-count').textContent = placeCount>1 ? `×${placeCount}` : '';
        selectedType = btn.dataset.type;
        mode = 'place'; clearToolButtons(); updateHintText();
      });
    });
  }

  function setupDefaultPopulation(){
    if(scenario==='heider'){
      addAgent('chasseur', worldW*0.25, worldH*0.3);
      addAgent('fugitif', worldW*0.65, worldH*0.65);
      addAgent('gardien', worldW*0.5, worldH*0.5);
      refuge = {x: worldW*0.85, y: worldH*0.15, r:55};
    } else if(scenario==='poisson'){
      for(let i=0;i<14;i++){
        addAgent('poisson', worldW*0.5+(rand()-0.5)*220, worldH*0.5+(rand()-0.5)*220);
      }
      addAgent('predateur', worldW*0.15, worldH*0.15);
    } else if(scenario==='foule'){
      exits.push({x: worldW*0.92, y: worldH*0.5, r:22});
      for(let i=0;i<18;i++){
        addAgent('pieton', worldW*0.15+rand()*worldW*0.5, worldH*0.15+rand()*worldH*0.7);
      }
    } else {
      addAgent('reine', worldW*0.5, worldH*0.5);
      for(let i=0;i<6;i++){
        const ang = rand()*Math.PI*2;
        addAgent('ouvriere', worldW*0.5+Math.cos(ang)*30, worldH*0.5+Math.sin(ang)*30);
      }
      for(let i=0;i<2;i++){
        const ang = rand()*Math.PI*2;
        addAgent('eclaireuse', worldW*0.5+Math.cos(ang)*30, worldH*0.5+Math.sin(ang)*30);
      }
      addAgent('soldat', worldW*0.5+40, worldH*0.5);
      food.push({x: worldW*0.15, y: worldH*0.2, r:26, qty:60, maxQty:60});
      food.push({x: worldW*0.85, y: worldH*0.8, r:26, qty:60, maxQty:60});
      addAgent('intrus', worldW*0.1, worldH*0.85);
      addAgent('nourrice', worldW*0.5-40, worldH*0.5);
      addAgent('fossoyeuse', worldW*0.5, worldH*0.5-40);
    }
  }

  function applyScenarioVisibility(){
    document.getElementById('refugeBtn').classList.toggle('hidden', scenario!=='heider');
    document.getElementById('foodBtn').classList.toggle('hidden', scenario!=='ants');
    document.getElementById('exitBtn').classList.toggle('hidden', scenario!=='foule');
    document.getElementById('alarmBtn').classList.toggle('hidden', scenario!=='foule');
    // "behaviorGroupHeider" ne contient plus que le Looming, partagé entre Heider-Simmel et
    // Poisson (réponse perceptive à une menace qui approche). Toute l'écologie proie-prédateur
    // (prédation, faim, natalité) est désormais exclusive au scénario Poisson, pour que
    // Heider-Simmel reste une démonstration minimale et lisible de l'expérience de 1944.
    document.getElementById('behaviorGroupHeider').classList.toggle('hidden', scenario==='ants');
    document.getElementById('ecologyGroupPoisson').classList.toggle('hidden', scenario!=='poisson');
    document.getElementById('behaviorGroupAnts').classList.toggle('hidden', scenario!=='ants');
    document.getElementById('antGrowthGroup').classList.toggle('hidden', scenario!=='ants');
    document.getElementById('crowdGroup').classList.toggle('hidden', scenario!=='foule');
    document.getElementById('behaviorGroupPoisson').classList.toggle('hidden', scenario!=='poisson');
    document.getElementById('rowAntCapacity').classList.toggle('hidden', scenario!=='ants' || antNoCapacityLimit);
    document.getElementById('rowPheromoneRange').classList.toggle('hidden', scenario!=='ants');
    document.getElementById('legendHeider').classList.toggle('hidden', scenario!=='heider');
    document.getElementById('legendHeiderTypes').classList.toggle('hidden', scenario!=='heider');
    document.getElementById('legendAnts').classList.toggle('hidden', scenario!=='ants');
    document.getElementById('legendPoisson').classList.toggle('hidden', scenario!=='poisson');
    document.getElementById('legendFoule').classList.toggle('hidden', scenario!=='foule');
  }

  function switchScenario(name){
    scenario = name;
    TYPES = SCENARIO_TYPES[scenario];
    reset();
    initPheromoneGrid(worldW, worldH);
    renderTypeButtons();
    applyScenarioVisibility();
    mode = 'place'; clearToolButtons(); updateHintText();
    setupDefaultPopulation();
    recomputeNestFieldForCurrentState();
    applyScenarioSliderDefaults();
    if(scenario!=='poisson'){
      // Ces options n'ont plus de case à cocher visible en dehors du Poisson : on les remet à
      // zéro pour éviter un état actif invisible et incohérent (ex. prédation qui "reste allumée").
      predationMode = false;
      popDynamicsMode = false;
      document.getElementById('predationMode').checked = false;
      document.getElementById('popDynamicsMode').checked = false;
    }
    renderPrimitiveBadges();
    updateConditionalRows();

    const scenarioLabels = {heider:'Heider-Simmel', ants:'Colonie de fourmis', poisson:'Banc de poissons', foule:'Foule humaine'};
    document.getElementById('currentScenarioLabel').textContent = scenarioLabels[scenario];
    document.getElementById('scenarioScreen').classList.add('hidden');
    document.getElementById('closeScenarioScreen').classList.remove('hidden');
  }

  document.querySelectorAll('.scenario-card').forEach(btn=>{
    btn.addEventListener('click', ()=> switchScenario(btn.dataset.scenario));
  });
  document.getElementById('openScenarioScreen').addEventListener('click', ()=>{
    document.getElementById('scenarioScreen').classList.remove('hidden');
  });
  document.getElementById('closeScenarioScreen').addEventListener('click', ()=>{
    document.getElementById('scenarioScreen').classList.add('hidden');
  });

  document.querySelectorAll('.boundary-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      boundaryMode = btn.dataset.boundary;
      document.querySelectorAll('.boundary-btn').forEach(b=>b.classList.toggle('active', b===btn));
      renderPrimitiveBadges();
    });
  });

  document.getElementById('refugeBtn').addEventListener('click', function(){
    mode = (mode==='refuge') ? 'place' : 'refuge'; clearToolButtons(); this.classList.toggle('active', mode==='refuge'); updateHintText();
  });
  document.getElementById('exitBtn').addEventListener('click', function(){
    mode = (mode==='exit') ? 'place' : 'exit'; clearToolButtons(); this.classList.toggle('active', mode==='exit'); updateHintText();
  });
  document.getElementById('alarmBtn').addEventListener('click', function(){
    mode = (mode==='alarm') ? 'place' : 'alarm'; clearToolButtons(); this.classList.toggle('active', mode==='alarm'); updateHintText();
  });
  document.getElementById('foodBtn').addEventListener('click', function(){
    mode = (mode==='food') ? 'place' : 'food'; clearToolButtons(); this.classList.toggle('active', mode==='food'); updateHintText();
  });
  document.getElementById('obstacleBtn').addEventListener('click', function(){
    mode = (mode==='obstacle') ? 'place' : 'obstacle'; clearToolButtons(); this.classList.toggle('active', mode==='obstacle'); updateHintText();
    document.getElementById('rowThickness').classList.toggle('hidden', mode!=='obstacle');
  });
  document.getElementById('thickness').addEventListener('input', function(){
    obstacleThickness = +this.value;
    document.getElementById('vThickness').textContent = this.value + 'px';
  });
  document.getElementById('eraseBtn').addEventListener('click', function(){
    mode = (mode==='erase') ? 'place' : 'erase'; clearToolButtons(); this.classList.toggle('active', mode==='erase'); updateHintText();
  });

  let isDrawing = false;
  let lastDrawPoint = null;
  let currentWall = null;
  let obstacleThickness = 20;

  function pointerWorldPos(e){
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX-rect.left) * zoneScale, y: (e.clientY-rect.top) * zoneScale };
  }

  function eraseAt(x,y){
    let bd=Infinity, bi=-1;
    agents.forEach((a,i)=>{ const d=Math.hypot(a.x-x,a.y-y); if(d<bd){bd=d;bi=i;} });
    if(bi>-1 && bd<30*zoneScale){ agents.splice(bi,1); return; }
    if(refuge && Math.hypot(refuge.x-x,refuge.y-y)<refuge.r){ refuge=null; return; }
    for(let i=0;i<obstacles.length;i++){
      const cp = closestPointOnWall(x, y, obstacles[i].points);
      if(Math.hypot(cp.x-x, cp.y-y)<obstacles[i].thickness){ obstacles.splice(i,1); return; }
    }
    for(let i=0;i<food.length;i++){
      if(Math.hypot(food[i].x-x,food[i].y-y)<food[i].r){ food.splice(i,1); return; }
    }
    for(let i=0;i<exits.length;i++){
      if(Math.hypot(exits[i].x-x,exits[i].y-y)<exits[i].r){ exits.splice(i,1); return; }
    }
    for(let i=0;i<alarms.length;i++){
      if(Math.hypot(alarms[i].x-x,alarms[i].y-y)<Math.max(alarms[i].r,16)){ alarms.splice(i,1); return; }
    }
  }

  function selectAgent(id){
    selectedAgentId = id;
    selectedTrail = [];
    document.getElementById('inspector').classList.remove('hidden');
  }
  function deselectAgent(){
    selectedAgentId = null;
    selectedTrail = [];
    document.getElementById('inspector').classList.add('hidden');
  }
  document.getElementById('inspClose').addEventListener('click', deselectAgent);

  function updateInspector(){
    if(!selectedAgentId) return;
    const a = agents.find(x=>x.id===selectedAgentId);
    if(!a){ deselectAgent(); return; } // l'agent a été mangé/retiré entre-temps
    const meta = TYPES[a.type];
    document.getElementById('inspTitle').textContent = meta.label;
    const deg = Math.round(((a.angle*180/Math.PI)%360+360)%360);
    const lines = [
      `<div>Position <b>${Math.round(a.x)}, ${Math.round(a.y)}</b></div>`,
      `<div>Cap <b>${deg}°</b></div>`,
      `<div>Vitesse <b>${(a._lastSpeed||0).toFixed(1)}</b> u/s</div>`,
      `<div>Comportement actif <b>${a._lastHasDesire ? 'oui' : 'non'}</b></div>`
    ];
    if(a.type==='fugitif' || a.type==='poisson') lines.push(`<div>Panique (Looming) <b>${a.isPanicking?'oui':'non'}</b></div>`);
    if(a.type==='chasseur'){
      lines.push(`<div>État <b>${a._fleeing?'fuit le gardien':a._hunting?'chasse':'errance'}</b></div>`);
      if(popDynamicsMode) lines.push(`<div>Faim <b>${(a._hunger||0).toFixed(1)}s</b> / ${starvationTime}s</div>`);
    }
    if(a.type==='predateur'){
      lines.push(`<div>État <b>${a._hunting?'chasse':'errance'}</b></div>`);
      if(popDynamicsMode){
        lines.push(`<div>Faim <b>${(a._hunger||0).toFixed(1)}s</b> / ${starvationTime}s</div>`);
        const mot = a._huntMotivation ?? 1;
        lines.push(`<div>Motivation de chasse <b>${mot<0.15?'rassasié, peu motivé':mot<0.6?'modérée':'affamé, forte'}</b></div>`);
      }
    }
    if(a.type==='ouvriere' || a.type==='eclaireuse') lines.push(`<div>Charge nourriture <b>${a._carryingFood?'oui':'non'}</b></div>`);
    lines.push(`<div style="margin-top:4px; color:var(--dim);">🟡 vitesse réelle · 🔵 direction désirée</div>`);
    document.getElementById('inspBody').innerHTML = lines.join('');
  }

  function updatePopCounter(){
    const counts = {};
    for(const a of agents) counts[a.type] = (counts[a.type]||0) + 1;
    const rows = Object.keys(TYPES).map(type=>{
      const n = counts[type]||0;
      return `<div class="pc-row"><span class="pc-dot" style="background:${TYPES[type].color}"></span>${TYPES[type].label} <b>${n}</b></div>`;
    });
    document.getElementById('popCounter').innerHTML = rows.join('');
    if(popDynamicsMode && scenario==='poisson'){
      const preyCount = counts['poisson']||0;
      document.getElementById('popCounter').innerHTML += `<div class="pc-row" style="margin-top:4px;border-top:1px solid rgba(255,255,255,.1);padding-top:4px;">Naissances cumulées <b>${totalBirths}</b> (plafond ${preyCount}/${noCapacityLimit?'∞':carryingCapacity})</div>`;
    }

    if(scenario==='foule' && exitRemovesAgents){
      document.getElementById('popCounter').innerHTML += `<div class="pc-row" style="margin-top:4px;border-top:1px solid rgba(255,255,255,.1);padding-top:4px;">Évacués <b>${totalEvacuated}</b></div>`;
    }

    if(scenario==='poisson' && predationMode){
      const total = edgeCaptures+interiorCaptures;
      const pct = total>0 ? Math.round(edgeCaptures/total*100) : 0;
      document.getElementById('confusionStats').innerHTML =
        `Captures en bordure : <b>${edgeCaptures}</b> · au centre : <b>${interiorCaptures}</b>${total>0?` (${pct}% en bordure)`:''}`;
    }
  }

  // ---------- Statistiques : historique des effectifs dans le temps ----------
  let statsHistory = [];
  const STATS_MAX_POINTS = 90; // ~90s de fenêtre glissante

  function sampleStatsHistory(){
    const counts = {};
    for(const a of agents) counts[a.type] = (counts[a.type]||0) + 1;
    statsHistory.push(counts);
    if(statsHistory.length > STATS_MAX_POINTS) statsHistory.shift();
    renderStatsChart();
  }

  function renderStatsChart(){
    const el = document.getElementById('statsChart');
    if(!el) return;
    const types = Object.keys(TYPES);
    if(statsHistory.length < 2){
      el.innerHTML = '<div style="font-size:10.5px;color:var(--dim);padding:4px 2px;">Lance la simulation pour commencer à voir l\u2019évolution des effectifs.</div>';
      return;
    }
    const w = 240, h = 90, pad = 4;
    let maxV = 1;
    for(const snap of statsHistory){ for(const ty of types){ if((snap[ty]||0) > maxV) maxV = snap[ty]||0; } }
    const stepX = (w-pad*2) / (statsHistory.length-1);
    const paths = types.map(ty=>{
      const d = statsHistory.map((snap,i)=>{
        const x = pad + i*stepX;
        const y = pad + (h-pad*2) * (1 - (snap[ty]||0)/maxV);
        return `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      return `<path d="${d}" fill="none" stroke="${TYPES[ty].color}" stroke-width="1.6"/>`;
    }).join('');
    const legend = types.map(ty=>
      `<span class="sl-item"><span class="sl-dot" style="background:${TYPES[ty].color}"></span>${TYPES[ty].label}</span>`
    ).join('');
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${paths}</svg><div class="stats-legend">${legend}</div>`;
  }

  function findAgentNear(x,y){
    let bd=Infinity, bi=-1;
    agents.forEach((a,i)=>{ const d=Math.hypot(a.x-x,a.y-y); if(d<bd){bd=d;bi=i;} });
    if(bi>-1 && bd < TYPES[agents[bi].type].radius + 12) return agents[bi];
    return null;
  }

  canvas.addEventListener('pointerdown', (e)=>{
    const {x,y} = pointerWorldPos(e);
    if(mode==='erase'){ eraseAt(x,y); isDrawing=true; lastDrawPoint={x,y}; canvas.setPointerCapture(e.pointerId); return; }
    if(mode==='refuge'){ refuge = {x,y,r:55}; return; }
    if(mode==='food'){ food.push({x,y,r:26,qty:60,maxQty:60}); return; }
    if(mode==='exit'){ exits.push({x,y,r:22}); return; }
    if(mode==='alarm'){ alarms.push({x,y,r:10}); return; }
    if(mode==='obstacle'){
      // Outil de dessin (aucun statut scientifique) : un tracé continu forme une seule
      // polyligne à épaisseur réglable, un clic simple n'y ajoute qu'un point.
      currentWall = { points:[{x,y}], thickness: obstacleThickness };
      obstacles.push(currentWall);
      isDrawing = true; lastDrawPoint = {x,y};
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if(mode==='inspect'){
      const found = findAgentNear(x,y);
      if(found) selectAgent(found.id); else deselectAgent();
      return;
    }
    const found = findAgentNear(x,y);
    if(found){ selectAgent(found.id); return; }
    for(let i=0;i<placeCount;i++){
      const ox = placeCount>1 ? (rand()-0.5)*50 : 0;
      const oy = placeCount>1 ? (rand()-0.5)*50 : 0;
      addAgent(selectedType, x+ox, y+oy);
    }
  });

  canvas.addEventListener('pointermove', (e)=>{
    if(!isDrawing || !lastDrawPoint) return;
    const {x,y} = pointerWorldPos(e);
    const d = Math.hypot(x-lastDrawPoint.x, y-lastDrawPoint.y);
    if(mode==='obstacle' && currentWall && d>=OBSTACLE_DRAW_SPACING){
      currentWall.points.push({x,y});
      lastDrawPoint = {x,y};
    } else if(mode==='erase' && d>=10){
      eraseAt(x,y);
      lastDrawPoint = {x,y};
    }
  });

  function stopDrawing(){ isDrawing = false; lastDrawPoint = null; currentWall = null; recomputeNestFieldForCurrentState(); }
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);
  canvas.addEventListener('pointerleave', stopDrawing);

  const panelEl = document.getElementById('panel');
  document.getElementById('dragHandle').addEventListener('click', ()=>{ panelEl.classList.toggle('open'); });
  document.getElementById('burgerBtn').addEventListener('click', ()=>{ panelEl.classList.toggle('open'); });

  // Cale le header sticky des collapses exactement sous la poignée "Menu", quelle que soit sa
  // hauteur réelle (police, densité d'écran...) — évite tout interstice où le contenu défilerait.
  function updateStickyOffset(){
    const el = document.getElementById('dragHandle');
    const marginBottom = parseFloat(getComputedStyle(el).marginBottom) || 0;
    document.documentElement.style.setProperty('--drag-handle-h', (el.offsetHeight + marginBottom)+'px');
  }
  updateStickyOffset();
  window.addEventListener('resize', updateStickyOffset);

  // Geste mobile : une fois remonté tout en haut du menu, un glissement supplémentaire vers le
  // bas (l'overscroll classique en haut d'une liste) referme le menu entier, sans avoir à viser
  // la poignée. On ne l'arme que si le panneau était déjà au sommet au moment du contact.
  {
    let dragStartY = null;
    panelEl.addEventListener('touchstart', (e)=>{
      dragStartY = panelEl.scrollTop <= 0 ? e.touches[0].clientY : null;
    }, {passive:true});
    panelEl.addEventListener('touchmove', (e)=>{
      if(dragStartY===null) return;
      const dy = e.touches[0].clientY - dragStartY;
      if(panelEl.scrollTop<=0 && dy > 60){
        panelEl.classList.remove('open');
        dragStartY = null;
      }
    }, {passive:true});
    panelEl.addEventListener('touchend', ()=>{ dragStartY = null; });
  }

  document.getElementById('playBtn').addEventListener('click', function(){
    running = !running;
    this.textContent = running ? '⏸ Pause' : '▶ Lancer';
    this.classList.toggle('running', running);
  });
  document.getElementById('clearBtn').addEventListener('click', function(){
    if(this.dataset.armed==='1'){
      clearTimeout(this._armTimer);
      this.dataset.armed='0';
      this.textContent='Vider la scène';
      this.classList.remove('running');
      reset();
      return;
    }
    this.dataset.armed='1';
    this.textContent='Confirmer ?';
    this.classList.add('running');
    this._armTimer = setTimeout(()=>{
      this.dataset.armed='0';
      this.textContent='Vider la scène';
      this.classList.remove('running');
    }, 3000);
  });

  // Réinitialisations ciblées : ne touchent qu'à leur propre collapse, jamais aux agents en scène.
  document.getElementById('resetConfigBtn').addEventListener('click', function(){
    loomingMode = true; predationMode = false; popDynamicsMode = false; noCapacityLimit = false;
    showPherReturn = true; showPherSearch = true; antNoCapacityLimit = false;
    boundaryMode = 'bounce'; simSpeedMultiplier = 1;
    document.getElementById('loomingMode').checked = true;
    document.getElementById('predationMode').checked = false;
    document.getElementById('popDynamicsMode').checked = false;
    document.getElementById('noCapacityLimit').checked = false;
    document.getElementById('showPherReturn').checked = true;
    document.getElementById('showPherSearch').checked = true;
    document.getElementById('antNoCapacityLimit').checked = false;
    document.querySelectorAll('.boundary-btn').forEach(b=>b.classList.toggle('active', b.dataset.boundary==='bounce'));
    document.getElementById('speedCycleBtn').textContent = '⏩ Vitesse ×1';
    renderPrimitiveBadges();
    updateConditionalRows();
  });

  document.getElementById('resetSlidersBtn').addEventListener('click', function(){
    const defaults = {
      starvation:20, birthRateSlider:15, capacitySlider:24,
      cohesion:5, alignment:7, separation:11, confusion:15,
      antCapacitySlider:26, pheromoneRangeSlider:26,
      ...SCENARIO_SLIDER_DEFAULTS[scenario]
    };
    for(const id in defaults){
      const el = document.getElementById(id);
      el.value = defaults[id];
      el.dispatchEvent(new Event('input', {bubbles:true}));
    }
  });

  function syncLabels(){
    document.getElementById('vPerc').textContent = document.getElementById('perception').value;
    document.getElementById('vForce').textContent = document.getElementById('force').value;
    document.getElementById('vSpeed').textContent = document.getElementById('speed').value;
    document.getElementById('vPanic').textContent = document.getElementById('panicRadius').value + 'px';
    document.getElementById('vAvoid').textContent = document.getElementById('avoidance').value + '%';
    document.getElementById('vThickness').textContent = document.getElementById('thickness').value + 'px';
    document.getElementById('vStarvation').textContent = document.getElementById('starvation').value + 's';
    document.getElementById('vBirthRate').textContent = document.getElementById('birthRateSlider').value + '%';
    document.getElementById('vCapacity').textContent = document.getElementById('capacitySlider').value;
    document.getElementById('vAntCapacity').textContent = document.getElementById('antCapacitySlider').value;
    document.getElementById('vPheromoneRange').textContent = document.getElementById('pheromoneRangeSlider').value;
    document.getElementById('vCohesion').textContent = cohesionWeight.toFixed(1);
    document.getElementById('vAlignment').textContent = alignmentWeight.toFixed(1);
    document.getElementById('vSeparation').textContent = separationWeight.toFixed(1);
    document.getElementById('vConfusion').textContent = document.getElementById('confusion').value + '%';
    document.getElementById('vCongestion').textContent = document.getElementById('congestion').value + '%';
    document.getElementById('vZone').textContent = document.getElementById('zone').value + '%';
  }
  ['perception','force','speed','panicRadius'].forEach(id=>{
    document.getElementById(id).addEventListener('input', syncLabels);
  });
  document.getElementById('avoidance').addEventListener('input', function(){
    avoidanceSensitivity = (+this.value)/100; syncLabels();
  });
  document.getElementById('zone').addEventListener('input', function(){
    zoneScale = (+this.value)/100; updateWorldSize(); syncLabels();
  });

  // Optimisation d'interface : un slider qui n'a de sens que si son option est active
  // (ici, la zone de déclenchement du Looming) ne s'affiche que dans ce cas précis.
  function updateConditionalRows(){
    document.getElementById('rowPanic').classList.toggle('hidden', scenario==='ants' || !loomingMode);
    document.getElementById('rowStarvation').classList.toggle('hidden', scenario!=='poisson' || !popDynamicsMode);
    document.getElementById('rowBirthRate').classList.toggle('hidden', scenario!=='poisson' || !popDynamicsMode);
    document.getElementById('rowCapacity').classList.toggle('hidden', scenario!=='poisson' || !popDynamicsMode || noCapacityLimit);
    document.getElementById('rowNoLimit').classList.toggle('hidden', scenario!=='poisson' || !popDynamicsMode);
    const showConfusion = scenario==='poisson' && predationMode;
    document.getElementById('rowConfusion').classList.toggle('hidden', !showConfusion);
    document.getElementById('confusionStats').classList.toggle('hidden', !showConfusion);
    document.getElementById('rowCongestion').classList.toggle('hidden', scenario!=='foule');
  }
  
  // Garde anti-scroll-accidentel : le CSS touch-action:pan-y aide pour la direction du geste,
  // mais un <input type="range"> natif "saute" à la position touchée dès le contact, avant même
  // que la direction du geste soit connue. On corrige donc activement : si le geste s'avère être
  // un scroll (mouvement surtout vertical), on remet le curseur à sa valeur d'avant, en continu,
  // tant que le geste reste vertical — la valeur ne se fige que si l'utilisateur fait un geste
  // clairement horizontal sur le slider, qui est alors laissé libre de répondre normalement.
  function guardRangeFromScroll(input){
    let startX=0, startY=0, startValue=null, mode=null; // mode: null | 'scroll' | 'slide'
    const THRESH = 6;

    function point(e){ return e.touches ? e.touches[0] : e; }

    function onDown(e){
      const p = point(e);
      startX = p.clientX; startY = p.clientY;
      startValue = input.value;
      mode = null;
    }
    function onMove(e){
      const p = point(e);
      const dx = p.clientX-startX, dy = p.clientY-startY;
      if(mode===null){
        if(Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return;
        mode = Math.abs(dy) > Math.abs(dx) ? 'scroll' : 'slide';
      }
      if(mode==='scroll' && input.value !== startValue){
        input.value = startValue;
        input.dispatchEvent(new Event('input', {bubbles:true}));
      }
    }
    function onUp(){
      if(mode==='scroll' && input.value !== startValue){
        input.value = startValue;
        input.dispatchEvent(new Event('input', {bubbles:true}));
      }
      mode = null;
    }

    input.addEventListener('touchstart', onDown, {passive:true});
    input.addEventListener('touchmove', onMove, {passive:true});
    input.addEventListener('touchend', onUp, {passive:true});
    input.addEventListener('touchcancel', onUp, {passive:true});
  }
  document.querySelectorAll('.collapse-header').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.getElementById(btn.dataset.collapse).classList.toggle('collapsed');
    });
  });

  document.querySelectorAll('#panel input[type="range"]').forEach(guardRangeFromScroll);

  syncLabels();
  updateConditionalRows();
  applyScenarioVisibility();
  resize();
  renderTypeButtons();
  setupDefaultPopulation();
  recomputeNestFieldForCurrentState();
  applyScenarioSliderDefaults();
  updateHintText();
  updatePopCounter();
  renderStatsChart();
  requestAnimationFrame(loop);
})();
