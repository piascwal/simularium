// La boucle d'animation (tranche 12 du plan de migration). requestAnimationFrame(loop)
// se rappelle elle-même en continu — impossible à découper avec le schéma
// "état explicite + réécriture en sortie" des autres tranches puisque `running`/
// `simSpeedMultiplier` sont aussi lus/écrits depuis l'extérieur (boutons lecture/
// pause, cycle de vitesse). D'où une fabrique : createLoop() reçoit un petit objet
// d'état partagé (même référence que celle utilisée par ces boutons dans main.ts)
// et les callbacks vers les fonctions qui restent dans main.ts (elles-mêmes des
// wrappers vers core/simulate.ts, render/draw.ts, etc.), et renvoie la fonction
// loop(now) prête à passer à requestAnimationFrame.
export interface LoopState {
  running: boolean;
  lastTime: number;
  accTick: number;
  simSpeedMultiplier: number;
  statsAccum: number;
}

export function createLoopState(): LoopState {
  return { running: false, lastTime: 0, accTick: 0, simSpeedMultiplier: 1, statsAccum: 0 };
}

export interface LoopCallbacks {
  getSliderValue(id: string): number;
  updateAgents(dt: number, perception: number, forceMag: number, speed: number, panicRadius: number): void;
  stepConway(): void;
  sampleStatsHistory(): void;
  render(): void;
  updateInspector(): void;
  updatePopCounter(): void;
}

export function createLoop(state: LoopState, cb: LoopCallbacks): (now: number) => void {
  function loop(now: number): void {
    requestAnimationFrame(loop);
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;
    if (state.running) {
      const perception = cb.getSliderValue('perception');
      const forceMag = cb.getSliderValue('force');
      const speed = cb.getSliderValue('speed');
      const panicRadius = cb.getSliderValue('panicRadius');
      for (let s = 0; s < state.simSpeedMultiplier; s++) {
        cb.updateAgents(dt, perception, forceMag, speed, panicRadius);
        state.accTick += dt;
        if (state.accTick > 0.18) { cb.stepConway(); state.accTick = 0; }
        state.statsAccum += dt;
        if (state.statsAccum > 1) { cb.sampleStatsHistory(); state.statsAccum = 0; }
      }
    }
    cb.render();
    cb.updateInspector();
    cb.updatePopCounter();
  }
  return loop;
}
