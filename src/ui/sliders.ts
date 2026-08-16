import { SCENARIO_SLIDER_DEFAULTS } from '../core/scenarios';
import type { ScenarioId } from '../core/types';

// Applique les valeurs par défaut de sliders du scénario actif aux <input> du DOM,
// en déclenchant leur événement 'input' pour que les écouteurs déjà enregistrés
// dans main.ts (qui réassignent les variables de poids/paramètres) se déclenchent
// normalement — c'est par ce mécanisme que les valeurs se propagent, pas par un
// retour de cette fonction (tranche 11 du plan de migration).
export function applyScenarioSliderDefaults(scenario: ScenarioId): void {
  const d = SCENARIO_SLIDER_DEFAULTS[scenario];
  if (!d) return;
  for (const [id, value] of Object.entries(d)) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) {
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}
