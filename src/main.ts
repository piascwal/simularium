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
import { createAgent, ageCorpses as ageCorpsesCore, getMidden as getMiddenCore } from './core/agent';
import { updateAgents as updateAgentsCore } from './core/simulate';
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
  function getMidden(){ return getMiddenCore(worldW, worldH); }
  function ageCorpses(dt){
    corpses = ageCorpsesCore(corpses, dt);
  }

  function addAgent(type,x,y){
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

  // updateAgents() vit maintenant dans core/simulate.ts (tranche 9 du plan de
  // migration) : on lui passe un instantané des variables locales concernées dans
  // un objet SimulationState, puis on réécrit ici celles qu'elle a réassignées
  // (un import ne peut pas être réassigné par le module qui l'importe).
  function updateAgents(dt, perception, forceMag, speed, panicRadius){
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
