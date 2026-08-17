// Constantes numériques partagées, extraites du monolithe telles quelles
// (mêmes valeurs, mêmes noms) — relocation pure, aucun changement de comportement.

export const MENU_BAR_H = 34;
export const CELL = 20; // grille de Conway (fond animé)
export const PCELL = 22; // grille de phéromones (colonie de fourmis)
export const DIST_CELL = 24; // champ de distance au nid (BFS, colonie de fourmis)
export const AGENT_CELL = 70; // grille spatiale de voisinage des agents
export const OBSTACLE_DRAW_SPACING = 14; // distance min. entre deux points ajoutés au tracé pendant le glisser
export const OBSTACLE_FUSION_DIST = 20; // distance de "magnétisme" pour fusionner deux tracés dont les bouts se touchent
