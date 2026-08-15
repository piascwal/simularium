import type { AgentTypeDef, ScenarioSliderDefaults } from '../types';

export const types: Record<string, AgentTypeDef> = {
  pieton: { color: '#c9a86a', shape: 'triangleSmall', radius: 5, label: 'Piéton' },
};

export const sliderDefaults: ScenarioSliderDefaults = {
  perception: 180,
  force: 12,
  speed: 45,
  panicRadius: 140,
  avoidance: 30,
};
