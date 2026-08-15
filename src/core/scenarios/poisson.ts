import type { AgentTypeDef, ScenarioSliderDefaults } from '../types';

export const types: Record<string, AgentTypeDef> = {
  poisson: { color: '#5fb0e8', shape: 'triangleSmall', radius: 5, label: 'Poisson' },
  predateur: { color: '#e0523f', shape: 'triangleBig', radius: 8, label: 'Prédateur' },
};

export const sliderDefaults: ScenarioSliderDefaults = {
  perception: 110,
  force: 12,
  speed: 45,
  panicRadius: 80,
  avoidance: 30,
  cohesion: 4,
  alignment: 10,
  separation: 12,
};
