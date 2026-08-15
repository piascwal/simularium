// PRNG seedable (mulberry32). Par défaut, comportement inchangé pour les
// utilisateurs : la seed est dérivée de l'horloge, donc toujours réellement
// aléatoire. Ajouter ?seed=N à l'URL fige la seed — utile pour comparer
// numériquement l'état de la simulation avant/après une extraction de code,
// plutôt que de vérifier "à l'œil" que le comportement n'a pas changé.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveSeed(): number {
  if (typeof window !== 'undefined') {
    const seedParam = new URLSearchParams(window.location.search).get('seed');
    if (seedParam !== null) {
      const n = Number(seedParam);
      if (Number.isFinite(n)) return n >>> 0;
    }
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

const next = mulberry32(resolveSeed());

export function rand(): number {
  return next();
}
