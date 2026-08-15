import * as heider from './heider';
import * as ants from './ants';
import * as poisson from './poisson';
import * as foule from './foule';
import type { AgentTypeDef, ScenarioId, ScenarioSliderDefaults } from '../types';

// Relocation pure des données de scénario (SCENARIO_TYPES / SCENARIO_SLIDER_DEFAULTS
// du monolithe) : même forme d'accès qu'avant (SCENARIO_TYPES[scenario]), pour que
// les sites d'appel existants n'aient rien à changer au-delà de l'import. La logique
// par scénario (relation, primitives actives, peuplement initial...) arrive dans une
// tranche suivante, une fois que les entités (agents, obstacles...) seront elles-mêmes
// extraites — tenter les deux en même temps aurait rendu cette tranche plus risquée.
export const SCENARIO_TYPES: Record<ScenarioId, Record<string, AgentTypeDef>> = {
  heider: heider.types,
  ants: ants.types,
  poisson: poisson.types,
  foule: foule.types,
};

export const SCENARIO_SLIDER_DEFAULTS: Record<ScenarioId, ScenarioSliderDefaults> = {
  heider: heider.sliderDefaults,
  ants: ants.sliderDefaults,
  poisson: poisson.sliderDefaults,
  foule: foule.sliderDefaults,
};
