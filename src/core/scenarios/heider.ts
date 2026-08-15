import type { AgentTypeDef, ScenarioSliderDefaults } from '../types';

export const types: Record<string, AgentTypeDef> = {
  chasseur: { color: '#e0523f', shape: 'triangleBig', radius: 8, label: 'Chasseur' },
  fugitif: { color: '#e8b84b', shape: 'triangleSmall', radius: 5.5, label: 'Fugitif' },
  gardien: { color: '#4f9dd6', shape: 'circle', radius: 6, label: 'Gardien' },
  neutre: { color: '#8a8f94', shape: 'square', radius: 6, label: 'Errant' },
};

export const sliderDefaults: ScenarioSliderDefaults = {
  perception: 230,
  force: 12,
  speed: 45,
  panicRadius: 80,
  avoidance: 30,
};
