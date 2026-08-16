
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
import { createAgent, ageCorpses as ageCorpsesCore, getMidden as getMiddenCore } from './core/agent';
import { updateAgents as updateAgentsCore } from './core/simulate';
import { drawShape as drawShapeCore, render as renderCore } from './render/draw';
import { updateWorldSize as updateWorldSizeCore, resize as resizeCore } from './ui/resize';
import { pointerWorldPos as pointerWorldPosCore, findAgentNear as findAgentNearCore, eraseAt as eraseAtCore } from './ui/canvasInput';
import { buildInspectorContent as buildInspectorContentCore } from './ui/inspector';
import { buildPopCounterContent as buildPopCounterContentCore, sampleStatsHistory as sampleStatsHistoryCore, renderStatsChartHtml as renderStatsChartHtmlCore } from './ui/stats';
import { applyScenarioVisibility as applyScenarioVisibilityCore, guardRangeFromScroll, setupCollapsibles } from './ui/panel';
import { buildTypeButtonsHtml as buildTypeButtonsHtmlCore } from './ui/toolbar';
import { applyScenarioSliderDefaults as applyScenarioSliderDefaultsCore } from './ui/sliders';
import { createLoopState as createLoopStateCore, createLoop as createLoopCore } from './ui/loop';
import { resolveShortcut } from './ui/shortcuts';
import { computeQuickMenuPosition } from './ui/quickMenu';
import type { Agent, FoodSource, Exit, Alarm, Corpse } from './core/agent';
import type { ScenarioId, AgentTypeDef, Obstacle, Point } from './core/types';

// Raccourci typé pour document.getElementById : tous les ids référencés ici sont
// connus (fixés dans index.html), donc l'assertion est sans risque runtime — évite
// de re-vérifier `!== null` à chaque site d'appel dans tout ce fichier de câblage DOM.
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

(function(){
  const canvas = byId<HTMLCanvasElement>('cv');
  const ctx = canvas.getContext('2d')!;
  let W=0, H=0, DPR=1;
  let zoneScale = 1, worldW=0, worldH=0;

  // resize() / updateWorldSize() vivent maintenant dans ui/resize.ts (tranche 11
  // du plan de migration) : wrapper au même schéma que updateAgents/render (petit
  // état explicite, réécrit ici après l'appel).
  function updateWorldSize(){
    const size = { W, H, DPR, zoneScale, worldW, worldH };
    updateWorldSizeCore(size, recomputeNestFieldForCurrentState);
    worldW = size.worldW; worldH = size.worldH;
  }
  function resize(){
    const size = { W, H, DPR, zoneScale, worldW, worldH };
    resizeCore(size, canvas, ctx, recomputeNestFieldForCurrentState);
    W = size.W; H = size.H; DPR = size.DPR; worldW = size.worldW; worldH = size.worldH;
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
  let scenario: ScenarioId = 'heider';
  let TYPES: Record<string, AgentTypeDef> = SCENARIO_TYPES[scenario];
  let agents: Agent[] = [];
  let refuge: (Point & { r: number }) | null = null;
  let obstacles: Obstacle[] = [];
  let food: FoodSource[] = [];       // colonie de fourmis : {x,y,r,qty}
  let exits: Exit[] = [];      // foule humaine : {x,y,r} — sorties recherchées par les piétons
  let alarms: Alarm[] = [];     // foule humaine : {x,y,r} — déclenche la panique à proximité
  let antCarryingCapacity = 26;
  let antNoCapacityLimit = false;
  let corpses: Corpse[] = []; // {x,y,age} — cadavres en attente d'évacuation (nécrophorèse)
  function getMidden(){ return getMiddenCore(worldW, worldH); }
  function ageCorpses(dt: number){
    corpses = ageCorpsesCore(corpses, dt);
  }

  function addAgent(type: string, x: number, y: number){
    agents.push(createAgent(type, x, y, rand));
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

  // relation() / nearest() : voir core/simulate.ts (utilisées uniquement par
  // updateAgents, déplacée en bloc avec elles)
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
    const el = byId('primitiveBadges');
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

  // updateAgents() vit maintenant dans core/simulate.ts (tranche 9 du plan de
  // migration) : on lui passe un instantané des variables locales concernées dans
  // un objet SimulationState, puis on réécrit ici celles qu'elle a réassignées
  // (un import ne peut pas être réassigné par le module qui l'importe).
  function updateAgents(dt: number, perception: number, forceMag: number, speed: number, panicRadius: number){
    const state = {
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
    };
    updateAgentsCore(state, dt, perception, forceMag, speed, panicRadius);
    t = state.t;
    agents = state.agents;
    corpses = state.corpses;
    birthAccumulator = state.birthAccumulator;
    totalBirths = state.totalBirths;
    totalEvacuated = state.totalEvacuated;
    edgeCaptures = state.edgeCaptures;
    interiorCaptures = state.interiorCaptures;
  }

  // ---------- Rendu ----------
  // drawShape() / render() vivent maintenant dans render/draw.ts (tranche 10 du
  // plan de migration) : lecture seule vis-à-vis de l'état, donc pas de réécriture
  // nécessaire en sortie, juste un objet de paramètres en entrée.
  function render(){
    renderCore(ctx, {
      W, H, zoneScale, worldW, worldH, t, scenario, TYPES, agents,
      obstacles, food, exits, alarms, corpses, refuge,
      showPherSearch, showPherReturn, selectedTrail, selectedAgentId,
    });
  }

  // ---------- Boucle ----------
  // Fabrique de la boucle d'animation : voir ui/loop.ts. loopState est partagé avec
  // les boutons lecture/pause et cycle de vitesse plus bas (même objet, propriétés
  // réassignées directement).
  const loopState = createLoopStateCore();
  const loop = createLoopCore(loopState, {
    getSliderValue: (id: string) => +byId<HTMLInputElement>(id).value,
    updateAgents, stepConway, sampleStatsHistory, render, updateInspector, updatePopCounter,
  });

  // ---------- UI ----------
  let selectedType = 'chasseur';
  let placeCount = 1;
  let mode: 'place' | 'inspect' | 'refuge' | 'food' | 'exit' | 'alarm' | 'obstacle' | 'erase' = 'place';
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
  // voir ui/sliders.ts
  function applyScenarioSliderDefaults(){
    applyScenarioSliderDefaultsCore(scenario);
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
  let boundaryMode: 'bounce' | 'perceive' | 'wrap' = 'bounce';
  let avoidanceSensitivity = 1.0; // 0.3 (permet de se faufiler) à 2.0 (évitement très large)
  let selectedAgentId: string | null = null;
  let selectedTrail: Point[] = [];

  byId<HTMLInputElement>('loomingMode').addEventListener('change', function(){ loomingMode = this.checked; renderPrimitiveBadges(); updateConditionalRows(); });
  byId<HTMLInputElement>('predationMode').addEventListener('change', function(){ predationMode = this.checked; renderPrimitiveBadges(); updateConditionalRows(); });
  byId<HTMLInputElement>('popDynamicsMode').addEventListener('change', function(){
    popDynamicsMode = this.checked;
    renderPrimitiveBadges();
    updateConditionalRows();
  });
  byId<HTMLInputElement>('starvation').addEventListener('input', function(){
    starvationTime = +this.value;
    byId('vStarvation').textContent = this.value + 's';
  });
  byId<HTMLInputElement>('birthRateSlider').addEventListener('input', function(){
    birthRate = (+this.value)/100;
    byId('vBirthRate').textContent = this.value + '%';
  });
  byId<HTMLInputElement>('capacitySlider').addEventListener('input', function(){
    carryingCapacity = +this.value;
    byId('vCapacity').textContent = this.value;
  });
  byId<HTMLInputElement>('noCapacityLimit').addEventListener('change', function(){
    noCapacityLimit = this.checked;
    byId('rowCapacity').classList.toggle('hidden', noCapacityLimit || scenario==='ants' || !popDynamicsMode);
  });
  byId<HTMLInputElement>('cohesion').addEventListener('input', function(){
    cohesionWeight = (+this.value)/10;
    byId('vCohesion').textContent = cohesionWeight.toFixed(1);
  });
  byId<HTMLInputElement>('alignment').addEventListener('input', function(){
    alignmentWeight = (+this.value)/10;
    byId('vAlignment').textContent = alignmentWeight.toFixed(1);
  });
  byId<HTMLInputElement>('separation').addEventListener('input', function(){
    separationWeight = (+this.value)/10;
    byId('vSeparation').textContent = separationWeight.toFixed(1);
  });
  byId<HTMLInputElement>('confusion').addEventListener('input', function(){
    confusionStrength = (+this.value)/100;
    byId('vConfusion').textContent = this.value + '%';
  });
  byId<HTMLInputElement>('congestion').addEventListener('input', function(){
    congestionStrength = (+this.value)/100;
    byId('vCongestion').textContent = this.value + '%';
  });
  renderPrimitiveBadges();

  byId<HTMLInputElement>('showPherReturn').addEventListener('change', function(){ showPherReturn = this.checked; });
  byId<HTMLInputElement>('showPherSearch').addEventListener('change', function(){ showPherSearch = this.checked; });

  byId<HTMLInputElement>('antCapacitySlider').addEventListener('input', function(){
    antCarryingCapacity = +this.value;
    byId('vAntCapacity').textContent = this.value;
  });
  byId<HTMLInputElement>('pheromoneRangeSlider').addEventListener('input', function(){
    pheromoneRange = +this.value;
    byId('vPheromoneRange').textContent = this.value;
  });
  byId<HTMLInputElement>('antNoCapacityLimit').addEventListener('change', function(){
    antNoCapacityLimit = this.checked;
    byId('rowAntCapacity').classList.toggle('hidden', scenario!=='ants' || antNoCapacityLimit);
  });
  byId<HTMLInputElement>('exitRemovesAgents').addEventListener('change', function(){
    exitRemovesAgents = this.checked;
  });

  const SPEED_STEPS = [1,2,3,4];
  // Synchronise les deux affichages de la vitesse (bouton du panneau + menu rapide mobile).
  function updateSpeedBtnText(){
    const i = SPEED_STEPS.indexOf(loopState.simSpeedMultiplier);
    const arrows = '⏩'.repeat(i+1);
    byId('speedCycleBtn').textContent = `${arrows} Vitesse ×${loopState.simSpeedMultiplier}`;
    byId('qmSpeed').textContent = `×${loopState.simSpeedMultiplier}`;
  }
  // direction=1 : bouton dans le panneau (cycle) et menu rapide ; aussi réutilisé par les
  // raccourcis +/- (desktop).
  function cycleSpeed(direction: 1 | -1){
    const i = SPEED_STEPS.indexOf(loopState.simSpeedMultiplier);
    const next = (i + direction + SPEED_STEPS.length) % SPEED_STEPS.length;
    loopState.simSpeedMultiplier = SPEED_STEPS[next];
    updateSpeedBtnText();
  }
  byId('speedCycleBtn').addEventListener('click', ()=> cycleSpeed(1));
  byId<HTMLInputElement>('showPopCounter').addEventListener('change', function(){
    byId('popCounter').classList.toggle('hidden', !this.checked);
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
    byId('hint').textContent = HINT_TEXTS[mode] || HINT_TEXTS.place;
  }

  function clearToolButtons(){
    byId('inspectBtn').classList.remove('active');
    byId('refugeBtn').classList.remove('active');
    byId('foodBtn').classList.remove('active');
    byId('exitBtn').classList.remove('active');
    byId('alarmBtn').classList.remove('active');
    byId('obstacleBtn').classList.remove('active');
    byId('eraseBtn').classList.remove('active');
    byId('rowThickness').classList.add('hidden');
  }

  function toggleInspectMode(){
    mode = (mode==='inspect') ? 'place' : 'inspect';
    clearToolButtons();
    byId('inspectBtn').classList.toggle('active', mode==='inspect');
    updateHintText();
  }
  byId('inspectBtn').addEventListener('click', toggleInspectMode);

  function backToPlaceMode(){
    mode = 'place'; clearToolButtons(); updateHintText();
  }

  // Construction du HTML des boutons : voir ui/toolbar.ts
  function renderTypeButtons(){
    const container = byId('typesContainer');
    container.innerHTML = buildTypeButtonsHtmlCore(TYPES);
    selectedType = Object.keys(TYPES)[0];
    placeCount = 1;
    container.querySelectorAll('.type-btn').forEach((btnEl)=>{
      const btn = btnEl as HTMLElement;
      btn.addEventListener('click', ()=>{
        if(selectedType===btn.dataset.type){
          // Reclic sur le même type déjà sélectionné : fait cycler le nombre placé par clic.
          const steps=[1,5,10];
          placeCount = steps[(steps.indexOf(placeCount)+1) % steps.length];
        } else {
          // Changement de type : on repart toujours de ×1, pour éviter d'en placer trop par erreur.
          placeCount = 1;
        }
        container.querySelectorAll('.type-btn').forEach((bEl)=>{
          const b = bEl as HTMLElement;
          b.classList.remove('active');
          (b.querySelector('.type-btn-count') as HTMLElement).textContent = '';
        });
        btn.classList.add('active');
        (btn.querySelector('.type-btn-count') as HTMLElement).textContent = placeCount>1 ? `×${placeCount}` : '';
        selectedType = btn.dataset.type as string;
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

  // Table id->caché et application au DOM : voir ui/panel.ts
  function applyScenarioVisibility(){
    applyScenarioVisibilityCore(scenario, antNoCapacityLimit);
  }

  function switchScenario(name: ScenarioId){
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
      byId<HTMLInputElement>('predationMode').checked = false;
      byId<HTMLInputElement>('popDynamicsMode').checked = false;
    }
    renderPrimitiveBadges();
    updateConditionalRows();

    const scenarioLabels = {heider:'Heider-Simmel', ants:'Colonie de fourmis', poisson:'Banc de poissons', foule:'Foule humaine'};
    byId('currentScenarioLabel').textContent = scenarioLabels[scenario];
    byId('scenarioScreen').classList.add('hidden');
    byId('closeScenarioScreen').classList.remove('hidden');
  }

  document.querySelectorAll('.scenario-card').forEach((btnEl)=>{
    const btn = btnEl as HTMLElement;
    btn.addEventListener('click', ()=> switchScenario(btn.dataset.scenario as ScenarioId));
  });
  byId('openScenarioScreen').addEventListener('click', ()=>{
    byId('scenarioScreen').classList.remove('hidden');
  });
  byId('closeScenarioScreen').addEventListener('click', ()=>{
    byId('scenarioScreen').classList.add('hidden');
  });

  document.querySelectorAll('.boundary-btn').forEach((btnEl)=>{
    const btn = btnEl as HTMLElement;
    btn.addEventListener('click', ()=>{
      boundaryMode = btn.dataset.boundary as 'bounce' | 'perceive' | 'wrap';
      document.querySelectorAll('.boundary-btn').forEach(b=>b.classList.toggle('active', b===btn));
      renderPrimitiveBadges();
    });
  });

  byId('refugeBtn').addEventListener('click', function(){
    mode = (mode==='refuge') ? 'place' : 'refuge'; clearToolButtons(); this.classList.toggle('active', mode==='refuge'); updateHintText();
  });
  byId('exitBtn').addEventListener('click', function(){
    mode = (mode==='exit') ? 'place' : 'exit'; clearToolButtons(); this.classList.toggle('active', mode==='exit'); updateHintText();
  });
  byId('alarmBtn').addEventListener('click', function(){
    mode = (mode==='alarm') ? 'place' : 'alarm'; clearToolButtons(); this.classList.toggle('active', mode==='alarm'); updateHintText();
  });
  byId('foodBtn').addEventListener('click', function(){
    mode = (mode==='food') ? 'place' : 'food'; clearToolButtons(); this.classList.toggle('active', mode==='food'); updateHintText();
  });
  byId('obstacleBtn').addEventListener('click', function(){
    mode = (mode==='obstacle') ? 'place' : 'obstacle'; clearToolButtons(); this.classList.toggle('active', mode==='obstacle'); updateHintText();
    byId('rowThickness').classList.toggle('hidden', mode!=='obstacle');
  });
  byId<HTMLInputElement>('thickness').addEventListener('input', function(){
    obstacleThickness = +this.value;
    byId('vThickness').textContent = this.value + 'px';
  });
  byId('eraseBtn').addEventListener('click', function(){
    mode = (mode==='erase') ? 'place' : 'erase'; clearToolButtons(); this.classList.toggle('active', mode==='erase'); updateHintText();
  });

  let isDrawing = false;
  let lastDrawPoint: Point | null = null;
  let currentWall: Obstacle | null = null;
  let obstacleThickness = 20;

  // pointerWorldPos / eraseAt / findAgentNear : voir ui/canvasInput.ts
  function pointerWorldPos(e: PointerEvent){
    return pointerWorldPosCore(e, canvas, zoneScale);
  }
  function eraseAt(x: number, y: number){
    const state = { agents, refuge, obstacles, food, exits, alarms };
    eraseAtCore(state, zoneScale, x, y);
    refuge = state.refuge;
  }

  function selectAgent(id: string){
    selectedAgentId = id;
    selectedTrail = [];
    byId('inspector').classList.remove('hidden');
  }
  function deselectAgent(){
    selectedAgentId = null;
    selectedTrail = [];
    byId('inspector').classList.add('hidden');
  }
  byId('inspClose').addEventListener('click', deselectAgent);

  // Logique de construction du contenu (quelles lignes selon le type/l'état) : voir
  // ui/inspector.ts. Ne reste ici que la mise à jour DOM.
  function updateInspector(){
    if(!selectedAgentId) return;
    const a = agents.find(x=>x.id===selectedAgentId);
    if(!a){ deselectAgent(); return; } // l'agent a été mangé/retiré entre-temps
    const content = buildInspectorContentCore(a, TYPES, popDynamicsMode, starvationTime);
    byId('inspTitle').textContent = content.title;
    byId('inspBody').innerHTML = content.bodyHtml;
  }

  // Logique de comptage/mise en forme : voir ui/stats.ts. Ne reste ici que la mise
  // à jour DOM.
  function updatePopCounter(){
    const content = buildPopCounterContentCore({
      agents, TYPES, popDynamicsMode, scenario, totalBirths,
      noCapacityLimit, carryingCapacity, exitRemovesAgents, totalEvacuated,
      predationMode, edgeCaptures, interiorCaptures,
    });
    byId('popCounter').innerHTML = content.popCounterHtml;
    if(content.confusionStatsHtml!==null){
      byId('confusionStats').innerHTML = content.confusionStatsHtml;
    }
  }

  // ---------- Statistiques : historique des effectifs dans le temps ----------
  let statsHistory: Record<string, number>[] = [];

  function sampleStatsHistory(){
    sampleStatsHistoryCore(statsHistory, agents);
    renderStatsChart();
  }

  function renderStatsChart(){
    const el = byId("statsChart");
    if(!el) return;
    el.innerHTML = renderStatsChartHtmlCore(statsHistory, TYPES);
  }

  function findAgentNear(x: number, y: number){
    return findAgentNearCore(agents, TYPES, x, y);
  }

  // Menu rapide (appui long) : voir ui/quickMenu.ts pour le calcul de position.
  const quickMenuEl = byId('quickMenu');
  function openQuickMenu(clientX: number, clientY: number){
    quickMenuEl.classList.remove('hidden');
    const rect = quickMenuEl.getBoundingClientRect();
    const pos = computeQuickMenuPosition(clientX, clientY, rect.width, rect.height, window.innerWidth, window.innerHeight);
    quickMenuEl.style.left = `${pos.left}px`;
    quickMenuEl.style.top = `${pos.top}px`;
  }
  function closeQuickMenu(){
    quickMenuEl.classList.add('hidden');
  }

  // Détection d'appui long, uniquement pour les modes "un tap = une action" (place, inspect,
  // refuge, food, exit, alarm) — erase/obstacle gardent leur geste de glissement intact,
  // le maintien y sert déjà à dessiner/effacer en continu.
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_THRESHOLD = 10;
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressPending: { x: number; y: number; clientX: number; clientY: number } | null = null;
  let longPressTriggered = false;

  function commitTapAction(x: number, y: number){
    if(mode==='refuge'){ refuge = {x,y,r:55}; return; }
    if(mode==='food'){ food.push({x,y,r:26,qty:60,maxQty:60}); return; }
    if(mode==='exit'){ exits.push({x,y,r:22}); return; }
    if(mode==='alarm'){ alarms.push({x,y,r:10}); return; }
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
  }

  function cancelLongPress(){
    if(longPressTimer !== undefined){ clearTimeout(longPressTimer); longPressTimer = undefined; }
    longPressPending = null;
  }

  canvas.addEventListener('pointerdown', (e)=>{
    const {x,y} = pointerWorldPos(e);
    if(mode==='erase'){ eraseAt(x,y); isDrawing=true; lastDrawPoint={x,y}; canvas.setPointerCapture(e.pointerId); return; }
    if(mode==='obstacle'){
      // Outil de dessin (aucun statut scientifique) : un tracé continu forme une seule
      // polyligne à épaisseur réglable, un clic simple n'y ajoute qu'un point.
      currentWall = { points:[{x,y}], thickness: obstacleThickness };
      obstacles.push(currentWall);
      isDrawing = true; lastDrawPoint = {x,y};
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    longPressTriggered = false;
    longPressPending = { x, y, clientX: e.clientX, clientY: e.clientY };
    longPressTimer = setTimeout(()=>{
      longPressTriggered = true;
      longPressTimer = undefined;
      if(longPressPending) openQuickMenu(longPressPending.clientX, longPressPending.clientY);
    }, LONG_PRESS_MS);
  });

  canvas.addEventListener('pointermove', (e)=>{
    if(longPressPending){
      const dLp = Math.hypot(e.clientX-longPressPending.clientX, e.clientY-longPressPending.clientY);
      if(dLp >= LONG_PRESS_MOVE_THRESHOLD) cancelLongPress();
    }
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
  canvas.addEventListener('pointerup', ()=>{
    if(longPressPending){
      const pending = longPressPending;
      const triggered = longPressTriggered;
      cancelLongPress();
      if(!triggered) commitTapAction(pending.x, pending.y);
    }
    stopDrawing();
  });
  canvas.addEventListener('pointercancel', ()=>{ cancelLongPress(); stopDrawing(); });
  canvas.addEventListener('pointerleave', ()=>{ cancelLongPress(); stopDrawing(); });

  byId('qmRun').addEventListener('click', ()=>{ toggleRun(); closeQuickMenu(); });
  // Reste ouvert après le clic : on veut pouvoir cycler ×1→×4 sans réarmer un appui long à chaque cran.
  byId('qmSpeed').addEventListener('click', ()=> cycleSpeed(1));
  byId('qmInspect').addEventListener('click', ()=>{ toggleInspectMode(); closeQuickMenu(); });
  byId('qmPlace').addEventListener('click', ()=>{ backToPlaceMode(); closeQuickMenu(); });
  document.addEventListener('pointerdown', (e)=>{
    if(quickMenuEl.classList.contains('hidden')) return;
    if(e.target instanceof Node && quickMenuEl.contains(e.target)) return;
    closeQuickMenu();
  });

  window.addEventListener('keydown', (e)=>{
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    const action = resolveShortcut(e.key, activeTag);
    if(!action) return;
    switch(action){
      case 'toggleRun': toggleRun(); break;
      case 'speedUp': cycleSpeed(1); break;
      case 'speedDown': cycleSpeed(-1); break;
      case 'toggleInspect': toggleInspectMode(); break;
      case 'backToPlace': backToPlaceMode(); closeQuickMenu(); break;
      case 'toggleMenu': panelEl.classList.toggle('open'); break;
    }
    e.preventDefault();
  });

  const panelEl = byId('panel');
  byId('dragHandle').addEventListener('click', ()=>{ panelEl.classList.toggle('open'); });
  byId('burgerBtn').addEventListener('click', ()=>{ panelEl.classList.toggle('open'); });

  // Cale le header sticky des collapses exactement sous la poignée "Menu", quelle que soit sa
  // hauteur réelle (police, densité d'écran...) — évite tout interstice où le contenu défilerait.
  function updateStickyOffset(){
    const el = byId('dragHandle');
    const marginBottom = parseFloat(getComputedStyle(el).marginBottom) || 0;
    document.documentElement.style.setProperty('--drag-handle-h', (el.offsetHeight + marginBottom)+'px');
  }
  updateStickyOffset();
  window.addEventListener('resize', updateStickyOffset);

  // Geste mobile : une fois remonté tout en haut du menu, un glissement supplémentaire vers le
  // bas (l'overscroll classique en haut d'une liste) referme le menu entier, sans avoir à viser
  // la poignée. On ne l'arme que si le panneau était déjà au sommet au moment du contact.
  {
    let dragStartY: number | null = null;
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

  function toggleRun(){
    loopState.running = !loopState.running;
    const btn = byId('playBtn');
    btn.textContent = loopState.running ? '⏸ Pause' : '▶ Lancer';
    btn.classList.toggle('running', loopState.running);
  }
  byId('playBtn').addEventListener('click', toggleRun);
  let clearBtnArmTimer: ReturnType<typeof setTimeout> | undefined;
  byId('clearBtn').addEventListener('click', function(){
    if(this.dataset.armed==='1'){
      clearTimeout(clearBtnArmTimer);
      this.dataset.armed='0';
      this.textContent='Vider la scène';
      this.classList.remove('running');
      reset();
      return;
    }
    this.dataset.armed='1';
    this.textContent='Confirmer ?';
    this.classList.add('running');
    clearBtnArmTimer = setTimeout(()=>{
      this.dataset.armed='0';
      this.textContent='Vider la scène';
      this.classList.remove('running');
    }, 3000);
  });

  // Réinitialisations ciblées : ne touchent qu'à leur propre collapse, jamais aux agents en scène.
  byId<HTMLInputElement>('resetConfigBtn').addEventListener('click', function(){
    loomingMode = true; predationMode = false; popDynamicsMode = false; noCapacityLimit = false;
    showPherReturn = true; showPherSearch = true; antNoCapacityLimit = false;
    boundaryMode = 'bounce'; loopState.simSpeedMultiplier = 1;
    byId<HTMLInputElement>('loomingMode').checked = true;
    byId<HTMLInputElement>('predationMode').checked = false;
    byId<HTMLInputElement>('popDynamicsMode').checked = false;
    byId<HTMLInputElement>('noCapacityLimit').checked = false;
    byId<HTMLInputElement>('showPherReturn').checked = true;
    byId<HTMLInputElement>('showPherSearch').checked = true;
    byId<HTMLInputElement>('antNoCapacityLimit').checked = false;
    document.querySelectorAll('.boundary-btn').forEach(b=>b.classList.toggle('active', (b as HTMLElement).dataset.boundary==='bounce'));
    updateSpeedBtnText();
    renderPrimitiveBadges();
    updateConditionalRows();
  });

  byId<HTMLInputElement>('resetSlidersBtn').addEventListener('click', function(){
    const defaults: Record<string, number> = {
      starvation:20, birthRateSlider:15, capacitySlider:24,
      cohesion:5, alignment:7, separation:11, confusion:15,
      antCapacitySlider:26, pheromoneRangeSlider:26,
      ...SCENARIO_SLIDER_DEFAULTS[scenario]
    };
    for(const id in defaults){
      const el = byId<HTMLInputElement>(id);
      el.value = String(defaults[id]);
      el.dispatchEvent(new Event('input', {bubbles:true}));
    }
  });

  function syncLabels(){
    byId('vPerc').textContent = byId<HTMLInputElement>('perception').value;
    byId('vForce').textContent = byId<HTMLInputElement>('force').value;
    byId('vSpeed').textContent = byId<HTMLInputElement>('speed').value;
    byId('vPanic').textContent = byId<HTMLInputElement>('panicRadius').value + 'px';
    byId('vAvoid').textContent = byId<HTMLInputElement>('avoidance').value + '%';
    byId('vThickness').textContent = byId<HTMLInputElement>('thickness').value + 'px';
    byId('vStarvation').textContent = byId<HTMLInputElement>('starvation').value + 's';
    byId('vBirthRate').textContent = byId<HTMLInputElement>('birthRateSlider').value + '%';
    byId('vCapacity').textContent = byId<HTMLInputElement>('capacitySlider').value;
    byId('vAntCapacity').textContent = byId<HTMLInputElement>('antCapacitySlider').value;
    byId('vPheromoneRange').textContent = byId<HTMLInputElement>('pheromoneRangeSlider').value;
    byId('vCohesion').textContent = cohesionWeight.toFixed(1);
    byId('vAlignment').textContent = alignmentWeight.toFixed(1);
    byId('vSeparation').textContent = separationWeight.toFixed(1);
    byId('vConfusion').textContent = byId<HTMLInputElement>('confusion').value + '%';
    byId('vCongestion').textContent = byId<HTMLInputElement>('congestion').value + '%';
    byId('vZone').textContent = byId<HTMLInputElement>('zone').value + '%';
  }
  ['perception','force','speed','panicRadius'].forEach(id=>{
    byId(id).addEventListener('input', syncLabels);
  });
  byId<HTMLInputElement>('avoidance').addEventListener('input', function(){
    avoidanceSensitivity = (+this.value)/100; syncLabels();
  });
  byId<HTMLInputElement>('zone').addEventListener('input', function(){
    zoneScale = (+this.value)/100; updateWorldSize(); syncLabels();
  });

  // Optimisation d'interface : un slider qui n'a de sens que si son option est active
  // (ici, la zone de déclenchement du Looming) ne s'affiche que dans ce cas précis.
  function updateConditionalRows(){
    byId('rowPanic').classList.toggle('hidden', scenario==='ants' || !loomingMode);
    byId('rowStarvation').classList.toggle('hidden', scenario!=='poisson' || !popDynamicsMode);
    byId('rowBirthRate').classList.toggle('hidden', scenario!=='poisson' || !popDynamicsMode);
    byId('rowCapacity').classList.toggle('hidden', scenario!=='poisson' || !popDynamicsMode || noCapacityLimit);
    byId('rowNoLimit').classList.toggle('hidden', scenario!=='poisson' || !popDynamicsMode);
    const showConfusion = scenario==='poisson' && predationMode;
    byId('rowConfusion').classList.toggle('hidden', !showConfusion);
    byId('confusionStats').classList.toggle('hidden', !showConfusion);
    byId('rowCongestion').classList.toggle('hidden', scenario!=='foule');
  }
  
  // Garde anti-scroll-accidentel : le CSS touch-action:pan-y aide pour la direction du geste,
  // mais un <input type="range"> natif "saute" à la position touchée dès le contact, avant même
  // que la direction du geste soit connue. On corrige donc activement : si le geste s'avère être
  // un scroll (mouvement surtout vertical), on remet le curseur à sa valeur d'avant, en continu,
  // tant que le geste reste vertical — la valeur ne se fige que si l'utilisateur fait un geste
  // clairement horizontal sur le slider, qui est alors laissé libre de répondre normalement.

  setupCollapsibles();
  document.querySelectorAll('#panel input[type="range"]').forEach((el)=>guardRangeFromScroll(el as HTMLInputElement));

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
