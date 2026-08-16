import type { Agent } from '../core/agent';
import type { AgentTypeDef } from '../core/types';

// Construit le contenu texte du panneau inspecteur pour un agent donné — la partie
// avec de la vraie logique (quelles lignes afficher selon le type/l'état de l'agent) ;
// séparée de sa mise à jour DOM (document.getElementById(...).textContent = ...),
// qui reste dans main.ts avec le reste du câblage d'événements (tranche 11 du plan
// de migration).
export interface InspectorContent {
  title: string;
  bodyHtml: string;
}

export function buildInspectorContent(
  agent: Agent,
  TYPES: Record<string, AgentTypeDef>,
  popDynamicsMode: boolean,
  starvationTime: number,
): InspectorContent {
  const meta = TYPES[agent.type];
  const deg = Math.round((((agent.angle as number) * 180 / Math.PI) % 360 + 360) % 360);
  const lines = [
    `<div>Position <b>${Math.round(agent.x)}, ${Math.round(agent.y)}</b></div>`,
    `<div>Cap <b>${deg}°</b></div>`,
    `<div>Vitesse <b>${((agent._lastSpeed as number) || 0).toFixed(1)}</b> u/s</div>`,
    `<div>Comportement actif <b>${agent._lastHasDesire ? 'oui' : 'non'}</b></div>`,
  ];
  if (agent.type === 'fugitif' || agent.type === 'poisson') {
    lines.push(`<div>Panique (Looming) <b>${agent.isPanicking ? 'oui' : 'non'}</b></div>`);
  }
  if (agent.type === 'chasseur') {
    lines.push(`<div>État <b>${agent._fleeing ? 'fuit le gardien' : agent._hunting ? 'chasse' : 'errance'}</b></div>`);
    if (popDynamicsMode) lines.push(`<div>Faim <b>${((agent._hunger as number) || 0).toFixed(1)}s</b> / ${starvationTime}s</div>`);
  }
  if (agent.type === 'predateur') {
    lines.push(`<div>État <b>${agent._hunting ? 'chasse' : 'errance'}</b></div>`);
    if (popDynamicsMode) {
      lines.push(`<div>Faim <b>${((agent._hunger as number) || 0).toFixed(1)}s</b> / ${starvationTime}s</div>`);
      const mot = (agent._huntMotivation as number) ?? 1;
      lines.push(`<div>Motivation de chasse <b>${mot < 0.15 ? 'rassasié, peu motivé' : mot < 0.6 ? 'modérée' : 'affamé, forte'}</b></div>`);
    }
  }
  if (agent.type === 'ouvriere' || agent.type === 'eclaireuse') {
    lines.push(`<div>Charge nourriture <b>${agent._carryingFood ? 'oui' : 'non'}</b></div>`);
  }
  lines.push('<div style="margin-top:4px; color:var(--dim);">🟡 vitesse réelle · 🔵 direction désirée</div>');
  return { title: meta.label, bodyHtml: lines.join('') };
}
