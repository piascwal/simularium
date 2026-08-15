export type PrimitiveStatus = 'established' | 'adapted' | 'artifact';

export interface Primitive {
  label: string;
  status: PrimitiveStatus;
  ref: string | null;
  desc: string;
}

// Catalogue de primitives comportementales. Chaque brique est documentée avec son
// statut scientifique :
//   'established' -> comportement directement issu d'études publiées
//   'adapted'      -> principe établi, mais implémentation numérique simplifiée/extrapolée
//   'artifact'     -> correctif d'ingénierie pur, sans fondement biologique
// Objectif : que l'app puisse toujours dire honnêtement "ceci est prouvé" vs
// "ceci est une rustine technique", plutôt que de laisser croire que tout vient
// de la littérature éthologique.
export const PRIMITIVES: Record<string, Primitive> = {
  poursuivre: {
    label: 'Poursuite',
    status: 'adapted',
    ref: 'Heider & Simmel 1944 (attribution perceptive d\u2019intention) + steering behaviors, Reynolds 1987',
    desc: 'Un agent se dirige vers une cible perçue comme proie.'
  },
  fuir: {
    label: 'Fuite prioritaire sur menace',
    status: 'established',
    ref: 'Dawkins & Krebs 1979 \u2014 "life-dinner principle"',
    desc: 'Une menace directe interrompt tout autre objectif en cours.'
  },
  interposition: {
    label: 'Interposition / protection',
    status: 'adapted',
    ref: 'Heider & Simmel 1944 (rôle de "protecteur" perçu)',
    desc: 'Un agent se place entre un prédateur et sa cible.'
  },
  looming: {
    label: 'Réponse au looming',
    status: 'established',
    ref: 'Card 2012 \u2014 neurones loom-sensitive (insectes, poissons)',
    desc: 'Réponse motrice automatique déclenchée par un stimulus qui grossit rapidement dans le champ de perception.'
  },
  cohesionBanc: {
    label: 'Cohésion / alignement / séparation',
    status: 'established',
    ref: 'Reynolds 1987 (Boids) ; Couzin et al. 2002',
    desc: 'Trois règles locales simples (se rapprocher, s\u2019aligner, s\u2019écarter) suffisent à produire un comportement de banc.'
  },
  errance: {
    label: 'Errance passive',
    status: 'adapted',
    ref: 'Marche aléatoire simplifiée (analogue Lévy walk)',
    desc: 'Mouvement indifférent au but, utilisé ici comme comportement neutre de référence.'
  },
  evitementObstacle: {
    label: 'Évitement d\u2019obstacle',
    status: 'adapted',
    ref: 'Steering behaviors, Reynolds 1987',
    desc: 'Répulsion proportionnelle à la proximité d\u2019un obstacle infranchissable.'
  },
  separationCorps: {
    label: 'Non-recouvrement des corps',
    status: 'adapted',
    ref: 'Contrainte physique de base (exclusion de volume)',
    desc: 'Deux agents ne peuvent pas occuper le même espace ; correction de position après coup.'
  },
  evitementCoins: {
    label: 'Évitement des coins d\u2019écran',
    status: 'artifact',
    ref: null,
    desc: 'Correctif d\u2019ingénierie pour éviter l\u2019empilement visuel dans les angles. Aucun fondement biologique — un vrai animal n\u2019a pas de "coin d\u2019écran".'
  },
  antiBlocage: {
    label: 'Anti-blocage (suivi de contour)',
    status: 'adapted',
    ref: 'Lumelsky & Stepanov 1987 \u2014 algorithmes "Bug" de navigation robotique',
    desc: 'Un agent qui pousse contre un mur sans progresser suit temporairement son contour (comme une main posée dessus) au lieu de recalculer sans cesse vers un objectif qu\u2019il ne peut pas voir à travers l\u2019obstacle. Simplification d\u2019un principe robotique réel, pas un comportement animal à proprement parler.'
  },
  predationContact: {
    label: 'Prédation par contact',
    status: 'adapted',
    ref: 'Lotka 1925 ; Volterra 1926 ; Holling 1959 (réponse fonctionnelle)',
    desc: 'Un chasseur qui atteint physiquement un fugitif l\u2019élimine — simplification déterministe des modèles proie-prédateur classiques, qui décrivent normalement une probabilité de capture plutôt qu\u2019une certitude.'
  },
  confusionPredateur: {
    label: 'Effet de confusion du prédateur',
    status: 'established',
    ref: 'Landeau & Terborgh 1986',
    desc: 'Plus un poisson ciblé est entouré de congénères proches, plus la probabilité de capture du prédateur chute — surcharge sensorielle/attentionnelle documentée chez le prédateur face à un groupe dense.'
  },
  predationBordure: {
    label: 'Prédation de bordure',
    status: 'established',
    ref: 'Hamilton 1971 \u2014 théorie du "troupeau égoïste" (selfish herd)',
    desc: 'Conséquence directe de l\u2019effet de confusion : un poisson en périphérie du banc a moins de voisins proches, donc moins de confusion générée, donc un risque de capture plus élevé. Mesuré et affiché en temps réel plutôt qu\u2019affirmé sans preuve.'
  },
  rechercheSortie: {
    label: 'Recherche de sortie',
    status: 'adapted',
    ref: 'Helbing & Molnár 1995 (modèle de force sociale)',
    desc: 'Chaque piéton se dirige en permanence vers la sortie perçue la plus proche, même en pleine panique — même patron que la recherche de refuge du fugitif.'
  },
  harde: {
    label: 'Effet de harde',
    status: 'established',
    ref: 'Couzin et al. 2002 ; Moussaïd et al. 2011',
    desc: 'Un piéton s\u2019aligne partiellement sur la direction moyenne de ses voisins proches — un suivi de foule non délibéré, pas une imitation volontaire.'
  },
  congestionRalentissement: {
    label: 'Congestion ("faster-is-slower")',
    status: 'established',
    ref: 'Helbing, Farkas & Vicsek 2000',
    desc: 'Plus les piétons sont tassés localement, plus leur vitesse effective chute — ce mécanisme, pas la panique elle-même, produit l\u2019embouteillage paradoxal à un goulot d\u2019étranglement : vouloir sortir plus vite ralentit tout le monde.'
  },
  sursautAttaque: {
    label: 'Sursaut d\u2019attaque (fast-start)',
    status: 'established',
    ref: 'Domenici & Blake 1997',
    desc: 'Le prédateur n\u2019accélère qu\u2019à courte distance pour l\u2019attaque finale — pas une vitesse de croisière soutenue, contrairement à une simple différence de vitesse constante entre prédateur et proie.'
  },
  motivationSatiete: {
    label: 'Motivation liée à la satiété',
    status: 'established',
    ref: 'Beukema 1968 \u2014 prédation de l\u2019épinoche selon la faim',
    desc: 'Un prédateur rassasié chasse beaucoup moins activement qu\u2019un prédateur affamé. Actif uniquement si la Dynamique de population est activée (sinon aucune notion de faim n\u2019existe, motivation maximale par défaut).'
  },
  mortParFamine: {
    label: 'Mort par famine (prédateur)',
    status: 'established',
    ref: 'Lotka 1925 ; Volterra 1926 \u2014 terme de mortalité du prédateur',
    desc: 'Un chasseur qui ne parvient pas à se nourrir pendant une durée donnée meurt. Nécessite que la prédation par contact soit elle-même activée, sinon aucun repas n\u2019est jamais comptabilisé.'
  },
  naissanceProie: {
    label: 'Natalité des proies',
    status: 'established',
    ref: 'Verhulst 1838 (croissance logistique) ; terme de reproduction dans Lotka 1925 / Volterra 1926',
    desc: 'De nouvelles proies apparaissent périodiquement tant que la population reste sous la capacité de charge K, réglable — c\u2019est exactement le paramètre K du modèle logistique de Verhulst, pas un plafond technique arbitraire.'
  },
  suivreGradient: {
    label: 'Suivi de gradient de phéromone',
    status: 'established',
    ref: 'Deneubourg et al. 1990 \u2014 expérience du pont à deux branches',
    desc: 'Une ouvrière sans nourriture s\u2019oriente vers la concentration de phéromone la plus forte perçue autour d\u2019elle, avec un léger biais vers l\u2019extérieur du nid pour ne pas être piégée par le point de convergence des retours près de la reine.'
  },
  explorationScout: {
    label: 'Exploration indépendante (éclaireuse)',
    status: 'adapted',
    ref: 'Beckers, Deneubourg & Goss 1992 ; Franks & Richardson 2006 (tandem running)',
    desc: 'Certaines fourmis explorent sans tenir compte des pistes existantes, puis marquent plus fort au retour pour recruter les ouvrières vers leur découverte.'
  },
  deposerTrace: {
    label: 'Dépôt de phéromone en retour',
    status: 'established',
    ref: 'Deneubourg et al. 1990',
    desc: 'Une ouvrière chargée de nourriture dépose de la phéromone sur son chemin de retour, renforçant les trajets courts par rétroaction positive. Pas de dépôt tout près du nid : cette zone de convergence de tous les retours saturerait sinon artificiellement, sans indiquer aucune direction utile.'
  },
  marquageExploration: {
    label: 'Marquage de piste en recherche',
    status: 'established',
    ref: 'Wehner 2003 \u2014 navigation par intégration de trajet combinée au suivi de repères/pistes',
    desc: 'Une fourmi sans nourriture marque aussi son passage, sur une piste distincte de celle du retour. Une fourmi chargée peut ensuite la suivre pour retracer un chemin réellement praticable à travers un environnement complexe, en complément de sa boussole interne.'
  },
  grilleDistanceNid: {
    label: 'Champ de distances au nid',
    status: 'adapted',
    ref: 'Principe du flood-fill/BFS en navigation robotique (apparenté aux algorithmes "Bug")',
    desc: 'Calculé une fois par balayage depuis le nid, en tenant compte des murs — chaque point du labyrinthe "connaît" sa distance réelle au nid en suivant les couloirs, pas à vol d\u2019oiseau. Sert de boussole principale au retour ; aucun animal ne calcule littéralement ce champ, mais le résultat (suivre les couloirs plutôt que foncer dans les murs) est bien ce qu\u2019on observe chez une fourmi en environnement structuré.'
  },
  integrationTrajet: {
    label: 'Retour au nid (repli sans champ de distances)',
    status: 'established',
    ref: 'Wehner & Srinivasan 1981 ; Wehner 2003 (combinaison intégration de trajet + suivi de repères)',
    desc: 'Ligne droite vers le nid, utilisée uniquement si le champ de distances est indisponible pour la case actuelle (secteur isolé, calcul non encore fait) — plus la boussole principale par défaut.'
  },
  roleStatique: {
    label: 'Rôle reproducteur statique (reine)',
    status: 'established',
    ref: 'Bonabeau, Theraulaz et al. 1996 \u2014 répartition des tâches par seuils de réponse',
    desc: 'La reine reste fixe au nid ; elle ne butine pas et assure la reproduction de la colonie. Simplification assumée : ici elle est totalement inamovible, même percutée \u2014 en réalité une reine peut être physiquement déplacée par les ouvrières lors d\u2019un déménagement de colonie.'
  },
  soinCouvain: {
    label: 'Soin du couvain (nourrice)',
    status: 'established',
    ref: 'Wilson 1971 ; Robinson 1992 \u2014 polyéthisme d\u2019âge, répartition des tâches',
    desc: 'La présence de nourrices près du nid accélère la production de nouvelles ouvrières par la reine. Elles ne butinent jamais.'
  },
  necrophorese: {
    label: 'Nécrophorèse (fossoyeuse)',
    status: 'established',
    ref: 'Wilson, Durlach & Roth 1958 \u2014 déclencheur chimique du comportement nécrophorique',
    desc: 'Une fossoyeuse détecte un cadavre et l\u2019évacue hors du nid. Simplification : ici le signal est la position du corps, pas la molécule (acide oléique) qui le déclenche réellement chez l\u2019animal.'
  },
  rebondBord: {
    label: 'Rebond sur le bord de l\u2019écran',
    status: 'artifact',
    ref: null,
    desc: 'Réflexion physique instantanée au contact, sans aucune anticipation. Aucun animal ne "rebondit" ainsi \u2014 c\u2019est ce raccourci qui provoque les blocages en coin.'
  },
  perceptionBord: {
    label: 'Perception anticipée du bord',
    status: 'adapted',
    ref: 'Thigmotaxie / suivi de paroi \u2014 Kalueff et al. 2013 (tests d\u2019open-field)',
    desc: 'L\u2019agent détecte et évite le bord avant le contact, comme une paroi sensible. Simplification : la vraie thigmotaxie consiste surtout à longer le mur, pas seulement à le fuir.'
  },
  topologieTorique: {
    label: 'Sans limite (topologie torique)',
    status: 'established',
    ref: 'Reynolds 1987 ; Vicsek et al. 1995 ; Couzin et al. 2002 (domaines périodiques)',
    desc: 'L\u2019agent qui sort d\u2019un côté réapparaît de l\u2019autre. Choix standard en modélisation du mouvement collectif : il élimine tout artefact de bord pour isoler la dynamique propre aux interactions entre agents.'
  }
};

export function statusMeta(status: PrimitiveStatus): { dot: string; word: string } {
  if (status === 'established') return { dot: '#59c48c', word: 'Établi' };
  if (status === 'adapted') return { dot: '#e8b84b', word: 'Adapté / extrapolé' };
  return { dot: '#6b7680', word: 'Artefact technique' };
}
