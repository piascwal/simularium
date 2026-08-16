import type { ScenarioId } from '../core/types';

// applyScenarioVisibility() / guardRangeFromScroll() / setupCollapsibles() déplacées
// depuis le monolithe (tranche 11 du plan de migration).

// Quels groupes de contrôles afficher selon le scénario actif — extrait en donnée
// pure (id d'élément -> caché ou non) plutôt que laissé comme une suite de
// `classList.toggle` : main.ts applique juste la table au DOM.
export function computeScenarioVisibility(scenario: ScenarioId, antNoCapacityLimit: boolean): Record<string, boolean> {
  return {
    refugeBtn: scenario !== 'heider',
    foodBtn: scenario !== 'ants',
    exitBtn: scenario !== 'foule',
    alarmBtn: scenario !== 'foule',
    // "behaviorGroupHeider" ne contient plus que le Looming, partagé entre Heider-Simmel et
    // Poisson (réponse perceptive à une menace qui approche). Toute l'écologie proie-prédateur
    // (prédation, faim, natalité) est désormais exclusive au scénario Poisson, pour que
    // Heider-Simmel reste une démonstration minimale et lisible de l'expérience de 1944.
    behaviorGroupHeider: scenario === 'ants',
    ecologyGroupPoisson: scenario !== 'poisson',
    behaviorGroupAnts: scenario !== 'ants',
    antGrowthGroup: scenario !== 'ants',
    crowdGroup: scenario !== 'foule',
    behaviorGroupPoisson: scenario !== 'poisson',
    rowAntCapacity: scenario !== 'ants' || antNoCapacityLimit,
    rowPheromoneRange: scenario !== 'ants',
    legendHeider: scenario !== 'heider',
    legendHeiderTypes: scenario !== 'heider',
    legendAnts: scenario !== 'ants',
    legendPoisson: scenario !== 'poisson',
    legendFoule: scenario !== 'foule',
  };
}

export function applyScenarioVisibility(scenario: ScenarioId, antNoCapacityLimit: boolean): void {
  const visibility = computeScenarioVisibility(scenario, antNoCapacityLimit);
  for (const id in visibility) {
    document.getElementById(id)?.classList.toggle('hidden', visibility[id]);
  }
}

// Le scroll vertical du panneau doit pouvoir "traverser" un slider sans le déplacer
// par inadvertance : seul un geste clairement horizontal sur le curseur le fait
// bouger. Fonction autonome (état entièrement local), aucune dépendance externe.
export function guardRangeFromScroll(input: HTMLInputElement): void {
  let startX = 0, startY = 0, startValue: string | null = null, mode: 'scroll' | 'slide' | null = null;
  const THRESH = 6;

  function point(e: TouchEvent | PointerEvent): { clientX: number; clientY: number } {
    return 'touches' in e ? e.touches[0] : e;
  }

  function onDown(e: TouchEvent) {
    const p = point(e);
    startX = p.clientX; startY = p.clientY;
    startValue = input.value;
    mode = null;
  }
  function onMove(e: TouchEvent) {
    const p = point(e);
    const dx = p.clientX - startX, dy = p.clientY - startY;
    if (mode === null) {
      if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return;
      mode = Math.abs(dy) > Math.abs(dx) ? 'scroll' : 'slide';
    }
    if (mode === 'scroll' && input.value !== startValue) {
      input.value = startValue as string;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function onUp() {
    if (mode === 'scroll' && input.value !== startValue) {
      input.value = startValue as string;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    mode = null;
  }

  input.addEventListener('touchstart', onDown, { passive: true });
  input.addEventListener('touchmove', onMove, { passive: true });
  input.addEventListener('touchend', onUp, { passive: true });
  input.addEventListener('touchcancel', onUp, { passive: true });
}

// Délégation générique d'ouverture/fermeture des sections repliables du panneau.
export function setupCollapsibles(): void {
  document.querySelectorAll('.collapse-header').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = (btn as HTMLElement).dataset.collapse;
      if (targetId) document.getElementById(targetId)?.classList.toggle('collapsed');
    });
  });
}
