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

## Installer comme app (PWA)

Le site en ligne est une PWA installable directement depuis le navigateur,
sans store ni APK : dans Chrome (Android) ou Safari (iOS), menu → « Ajouter
à l'écran d'accueil » / « Installer l'application ». Elle se lance ensuite
en plein écran avec sa propre icône, et reste utilisable hors-ligne
(service worker en cache-réseau-d'abord, `public/sw.js`) — l'app étant
100% statique, rien ne dépend d'un serveur au runtime.

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

### Release signée (installation sans mode développeur)

Un APK debug ne s'installe pas sans le débogage USB activé sur le
téléphone. Pour un APK release signé — transférable par simple copie de
fichier (USB/MTP) et installable via le gestionnaire de fichiers, sans
jamais activer les options développeur :

```bash
JAVA_HOME="<jdk21>" ./gradlew assembleRelease
```

nécessite `android/keystore.properties` (non committé, voir
`android/.gitignore`) pointant vers un keystore local, généré une fois via
`keytool -genkeypair`. Sans ce fichier, `assembleRelease` produit un APK
non signé, inutilisable tel quel. **À conserver précieusement** : perdre ce
keystore empêche de mettre à jour l'app en place sur un appareil (Android
exige la même signature pour accepter une mise à jour).

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
