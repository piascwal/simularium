// Types partagés entre modules core. Étoffé au fil des tranches de la Phase 1
// (voir le plan de migration) au fur et à mesure que chaque partie du monolithe
// est extraite — pas de tentative de tout typer d'un coup.

export interface Point {
  x: number;
  y: number;
}
