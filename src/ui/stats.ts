import type { Agent } from '../core/agent';
import type { AgentTypeDef, ScenarioId } from '../core/types';

// Logique de comptage/mise en forme pour le compteur de population et le graphique
// d'historique — séparée de la mise à jour DOM elle-même, qui reste dans main.ts
// (tranche 11 du plan de migration).

function countByType(agents: Agent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of agents) counts[a.type] = (counts[a.type] || 0) + 1;
  return counts;
}

export interface PopCounterParams {
  agents: Agent[];
  TYPES: Record<string, AgentTypeDef>;
  popDynamicsMode: boolean;
  scenario: ScenarioId;
  totalBirths: number;
  noCapacityLimit: boolean;
  carryingCapacity: number;
  exitRemovesAgents: boolean;
  totalEvacuated: number;
  predationMode: boolean;
  edgeCaptures: number;
  interiorCaptures: number;
}

export interface PopCounterContent {
  popCounterHtml: string;
  confusionStatsHtml: string | null;
}

export function buildPopCounterContent(p: PopCounterParams): PopCounterContent {
  const counts = countByType(p.agents);
  const rows = Object.keys(p.TYPES).map((type) => {
    const n = counts[type] || 0;
    return `<div class="pc-row"><span class="pc-dot" style="background:${p.TYPES[type].color}"></span>${p.TYPES[type].label} <b>${n}</b></div>`;
  });
  let popCounterHtml = rows.join('');
  if (p.popDynamicsMode && p.scenario === 'poisson') {
    const preyCount = counts['poisson'] || 0;
    popCounterHtml += `<div class="pc-row" style="margin-top:4px;border-top:1px solid rgba(255,255,255,.1);padding-top:4px;">Naissances cumulées <b>${p.totalBirths}</b> (plafond ${preyCount}/${p.noCapacityLimit ? '∞' : p.carryingCapacity})</div>`;
  }
  if (p.scenario === 'foule' && p.exitRemovesAgents) {
    popCounterHtml += `<div class="pc-row" style="margin-top:4px;border-top:1px solid rgba(255,255,255,.1);padding-top:4px;">Évacués <b>${p.totalEvacuated}</b></div>`;
  }
  let confusionStatsHtml: string | null = null;
  if (p.scenario === 'poisson' && p.predationMode) {
    const total = p.edgeCaptures + p.interiorCaptures;
    const pct = total > 0 ? Math.round((p.edgeCaptures / total) * 100) : 0;
    confusionStatsHtml = `Captures en bordure : <b>${p.edgeCaptures}</b> · au centre : <b>${p.interiorCaptures}</b>${total > 0 ? ` (${pct}% en bordure)` : ''}`;
  }
  return { popCounterHtml, confusionStatsHtml };
}

export const STATS_MAX_POINTS = 90; // ~90s de fenêtre glissante

// Mutation en place (push/shift) : statsHistory reste le même tableau, pas besoin
// de réécriture côté appelant.
export function sampleStatsHistory(statsHistory: Record<string, number>[], agents: Agent[]): void {
  statsHistory.push(countByType(agents));
  if (statsHistory.length > STATS_MAX_POINTS) statsHistory.shift();
}

export function renderStatsChartHtml(statsHistory: Record<string, number>[], TYPES: Record<string, AgentTypeDef>): string {
  const types = Object.keys(TYPES);
  if (statsHistory.length < 2) {
    return '<div style="font-size:10.5px;color:var(--dim);padding:4px 2px;">Lance la simulation pour commencer à voir l’évolution des effectifs.</div>';
  }
  const w = 240, h = 90, pad = 4;
  let maxV = 1;
  for (const snap of statsHistory) {
    for (const ty of types) {
      if ((snap[ty] || 0) > maxV) maxV = snap[ty] || 0;
    }
  }
  const stepX = (w - pad * 2) / (statsHistory.length - 1);
  const paths = types.map((ty) => {
    const d = statsHistory.map((snap, i) => {
      const x = pad + i * stepX;
      const y = pad + (h - pad * 2) * (1 - (snap[ty] || 0) / maxV);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<path d="${d}" fill="none" stroke="${TYPES[ty].color}" stroke-width="1.6"/>`;
  }).join('');
  const legend = types.map((ty) =>
    `<span class="sl-item"><span class="sl-dot" style="background:${TYPES[ty].color}"></span>${TYPES[ty].label}</span>`,
  ).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${paths}</svg><div class="stats-legend">${legend}</div>`;
}
