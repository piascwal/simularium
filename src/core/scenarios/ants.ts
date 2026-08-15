import type { AgentTypeDef, ScenarioSliderDefaults } from '../types';

export const types: Record<string, AgentTypeDef> = {
  ouvriere: { color: '#c98a3c', shape: 'triangleSmall', radius: 4.5, label: 'Ouvrière' },
  eclaireuse: { color: '#5fc4b8', shape: 'triangleSmall', radius: 4.5, label: 'Éclaireuse' },
  soldat: { color: '#6a7dc9', shape: 'triangleBig', radius: 7, label: 'Soldat' },
  nourrice: { color: '#e0a8c0', shape: 'circle', radius: 4.5, label: 'Nourrice' },
  fossoyeuse: { color: '#7a7460', shape: 'triangleSmall', radius: 4.5, label: 'Fossoyeuse' },
  reine: { color: '#d64f8a', shape: 'circle', radius: 9, label: 'Reine' },
  intrus: { color: '#c9455e', shape: 'triangleBig', radius: 7.5, label: 'Intrus' },
};

export const sliderDefaults: ScenarioSliderDefaults = {
  perception: 120,
  force: 12,
  speed: 45,
  panicRadius: 80,
  avoidance: 30,
};
