import type { AgentTypeDef } from '../core/types';

// Construction du HTML des boutons de type d'agent (tranche 11 du plan de
// migration) — la partie sans état ; le câblage des clics reste dans main.ts,
// puisqu'il réassigne selectedType/placeCount/mode, partagés avec le reste de
// l'appli (canvasInput lit ces mêmes variables pour savoir quoi placer).
export function buildTypeButtonsHtml(TYPES: Record<string, AgentTypeDef>): string {
  const keys = Object.keys(TYPES);
  return keys.map((k, i) =>
    `<button class="type-btn${i === 0 ? ' active' : ''}" data-type="${k}"><span class="dot" style="background:${TYPES[k].color}"></span><span class="type-btn-label">${TYPES[k].label}</span><span class="type-btn-count"></span></button>`,
  ).join('');
}
