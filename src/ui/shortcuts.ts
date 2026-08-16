// Raccourcis clavier (desktop) — quelques actions fréquentes sans ouvrir le panneau.
export type ShortcutAction = 'toggleRun' | 'speedUp' | 'speedDown' | 'toggleInspect' | 'backToPlace' | 'toggleMenu';

// Détermine l'action associée à une touche, ou null si aucune ne correspond — y compris
// quand le focus est sur un champ de saisie (slider, texte...), pour ne jamais interférer
// avec l'ajustement normal d'un curseur ou la frappe dans un champ.
export function resolveShortcut(key: string, activeElementTag: string): ShortcutAction | null {
  const tag = activeElementTag.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
  switch (key) {
    case ' ':
      return 'toggleRun';
    case '+':
    case '=':
      return 'speedUp';
    case '-':
      return 'speedDown';
    case 'i':
    case 'I':
      return 'toggleInspect';
    case 'Escape':
      return 'backToPlace';
    case 'm':
    case 'M':
      return 'toggleMenu';
    default:
      return null;
  }
}
