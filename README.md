# Simularium

Un théâtre d'agents : des formes simples qui bougent selon des règles locales,
et qu'on regarde en train de composer — sans le vouloir — de la chasse, de la
panique, de la coopération ou de l'organisation collective.

Simularium n'est pas une seule simulation mais quatre, qui partagent le même
moteur :

- **Heider-Simmel** — la ré-interprétation de l'expérience de 1944 : on prête
  spontanément des intentions à de simples formes géométriques en mouvement.
- **Colonie de fourmis** — intelligence collective via phéromones, castes et
  division du travail (recrutement, retour au nid par BFS, nécrophorèse...).
- **Banc de poissons** — auto-organisation façon *boids* (cohésion,
  alignement, séparation) avec prédation et effet de confusion du prédateur.
- **Foule humaine** — panique, effet de harde, et l'embouteillage paradoxal
  d'une sortie qu'on veut atteindre trop vite (*faster-is-slower*).

## Le mélange science / jeu

Chaque comportement activable dans l'interface est répertorié comme une
« primitive » et étiqueté selon sa provenance :

- **Établi** — comportement documenté dans la littérature (éthologie,
  psychologie sociale, dynamique des foules), avec sa référence.
- **Adapté / extrapolé** — inspiré d'un principe réel mais simplifié ou
  recombiné pour la simulation.
- **Artefact technique** — un correctif purement mécanique (anti-blocage,
  rebond aux bords...) sans prétention scientifique.

Cette étiquette est visible directement dans le menu de chaque scénario.

## Utiliser Simularium

**En ligne : [piascwal.github.io/simularium](https://piascwal.github.io/simularium/)**

Ou en local :

```bash
npm install
npm run dev
```

## Version mobile (Android)

Le moteur ne touchant jamais le DOM directement (voir plus bas), l'appli
s'empaquette telle quelle via [Capacitor](https://capacitorjs.com/) :

```bash
npm run build:capacitor   # build web avec chemins relatifs (nécessaire hors navigateur)
npx cap sync android      # recopie les assets + synchronise le projet natif
npx cap open android      # ouvre le projet dans Android Studio
```

Compilation en ligne de commande vérifiée (`./gradlew assembleDebug`, APK généré) :
il faut un JDK **21** (le JBR fourni avec Android Studio est souvent plus
récent — 25 au moment de l'écriture — et n'est pas encore supporté par la
version de Gradle utilisée ici). Pointer `JAVA_HOME` dessus avant d'appeler
`gradlew`, ou laisser Android Studio gérer son propre JDK de build via
*Project Structure → Gradle JDK*.

`minSdkVersion` est fixé à 24 (Android 7.0, 2016), qui couvre déjà la quasi-
totalité des appareils actifs d'après les statistiques de distribution
Android — c'est indépendant du JDK utilisé pour compiler, qui ne fait que
déterminer l'outillage de build, pas la compatibilité de l'appli installée.

iOS demande un Mac (Xcode) : `npx cap add ios` n'a pas pu être tenté ici.

## Architecture

Le monolithe d'origine est découpé en trois couches :

- **`src/core/`** — moteur de simulation pur, aucune dépendance au DOM
  (agents, scénarios, grilles de phéromones/Conway, distance au nid...).
  C'est cette propriété qui permet à Capacitor de réutiliser le même code
  sans changement.
- **`src/render/`** — dessin sur le `<canvas>`, lecture seule vis-à-vis de
  l'état.
- **`src/ui/`** — logique d'interface (sliders, inspecteur, statistiques,
  boucle d'animation).
- **`src/main.ts`** — bootstrap et câblage DOM (événements, sélection
  d'éléments) ; ce qui reste du monofichier d'origine, réduit à la colle
  entre les trois couches ci-dessus.

Le projet est en TypeScript strict partout, `main.ts` compris
(`npm run typecheck`).

## Licence

Apache License 2.0 — voir [LICENSE](LICENSE).
