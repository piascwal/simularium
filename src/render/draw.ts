import { CELL, PCELL } from '../core/constants';
import { grid, gage, gcols, grows, gidx } from '../core/grid/conway';
import { pherReturn, pherSearch, pcols, prows, pidx } from '../core/grid/pheromone';
import { getMidden as getMiddenCore } from '../core/agent';
import type { Agent, FoodSource, Exit, Alarm, Corpse, Door } from '../core/agent';
import type { AgentTypeDef, Obstacle, Point, ScenarioId } from '../core/types';

// drawShape() / render() déplacées depuis le monolithe (tranche 10 du plan de
// migration), structure interne intouchée. Toutes deux sont en LECTURE SEULE
// vis-à-vis de l'état (contrairement à updateAgents en tranche 9) — pas de
// réassignation, donc pas de réécriture nécessaire en sortie, juste un objet
// de paramètres en entrée.
export interface RenderState {
  W: number;
  H: number;
  zoneScale: number;
  worldW: number;
  worldH: number;
  t: number;
  scenario: ScenarioId;
  TYPES: Record<string, AgentTypeDef>;
  agents: Agent[];
  obstacles: Obstacle[];
  doors: Door[];
  food: FoodSource[];
  exits: Exit[];
  alarms: Alarm[];
  corpses: Corpse[];
  refuge: (Point & { r: number }) | null;
  showPherSearch: boolean;
  showPherReturn: boolean;
  selectedTrail: Point[];
  selectedAgentId: string | null;
}

export function drawShape(ctx: CanvasRenderingContext2D, agent: Agent, TYPES: Record<string, AgentTypeDef>, t: number): void {
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

export function render(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const {
    W, H, zoneScale, worldW, worldH, t, scenario, TYPES, agents,
    obstacles, doors, food, exits, alarms, corpses, refuge,
    showPherSearch, showPherReturn, selectedTrail, selectedAgentId,
  } = state;

  function getMidden(): Point {
    return getMiddenCore(worldW, worldH);
  }

    ctx.clearRect(0,0,W,H);
    ctx.save();
    ctx.scale(1/zoneScale, 1/zoneScale);
    
    if(grid){
      for(let y=0;y<grows;y++){
        for(let x=0;x<gcols;x++){
          const a = gage![gidx(x,y)];
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
            const vs = pherSearch![pidx(x,y)];
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

    for(const d of doors){
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(d.points[0].x, d.points[0].y);
      for(let i=1;i<d.points.length;i++) ctx.lineTo(d.points[i].x, d.points[i].y);
      if(d.open){
        // Ouverte : contour fin en tirets (même langage visuel que le refuge) — se lit comme
        // "actuellement franchissable", pas comme un mur.
        ctx.strokeStyle = 'rgba(224,168,79,0.85)'; ctx.lineWidth = 2; ctx.setLineDash([5,4]);
        ctx.stroke();
      } else {
        // Fermée : même traitement qu'un mur (fond sombre + liseré clair), teinté ambre pour
        // rester identifiable comme une porte plutôt qu'un obstacle ordinaire.
        ctx.strokeStyle = '#3a2f1f'; ctx.lineWidth = d.thickness*2; ctx.stroke();
        ctx.strokeStyle = '#e0a84f'; ctx.lineWidth = 2; ctx.stroke();
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

    for(const a of agents) drawShape(ctx, a, TYPES, t);

    // --- Vecteurs de l'agent sélectionné : vitesse réelle (jaune) vs direction désirée (cyan) ---
    const selAgent = agents.find(a=>a.id===selectedAgentId);
    if(selAgent){
      ctx.save();
      ctx.beginPath(); ctx.arc(selAgent.x, selAgent.y, TYPES[selAgent.type].radius+7, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,214,90,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();

      const drawArrow = (x: number, y: number, angle: number, len: number, color: string)=>{
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
        const da = Math.atan2(selAgent._lastDesiredY ?? 0, selAgent._lastDesiredX ?? 0);
        drawArrow(selAgent.x, selAgent.y, da, 22, 'rgba(95,196,232,0.9)');
      }
      ctx.restore();
    }

    ctx.restore();
}
