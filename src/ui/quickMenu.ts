// Positionnement du menu rapide (appui long sur la scène, mobile) — logique pure,
// séparée de l'ouverture/fermeture DOM qui reste dans main.ts.
export interface QuickMenuPosition {
  left: number;
  top: number;
}

// Centre le menu sur le point d'appui, au-dessus du doigt par défaut (pour ne pas être
// caché par la main) ; passe en dessous s'il n'y a pas la place en haut ; toujours
// maintenu dans le viewport (utile près des bords d'écran sur mobile).
export function computeQuickMenuPosition(
  clientX: number,
  clientY: number,
  menuW: number,
  menuH: number,
  viewportW: number,
  viewportH: number,
): QuickMenuPosition {
  const margin = 8;
  const gap = 18; // distance entre le doigt et le menu
  let left = clientX - menuW / 2;
  let top = clientY - menuH - gap;
  if (top < margin) top = clientY + gap;
  left = Math.max(margin, Math.min(viewportW - menuW - margin, left));
  top = Math.max(margin, Math.min(viewportH - menuH - margin, top));
  return { left, top };
}
