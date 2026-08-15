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

Le tout tient dans un seul fichier HTML autonome, sans dépendance ni build :

```bash
# ouvre simplement index.html dans un navigateur
```

Ou en ligne une fois GitHub Pages activé sur ce dépôt : *(lien à venir)*.

## État du projet

Le prototype actuel est volontairement un monofichier. Une réécriture est
prévue pour découper le moteur de simulation (indépendant du DOM), le rendu
et l'interface, avec pour objectif une version web **et** mobile.

## Licence

Apache License 2.0 — voir [LICENSE](LICENSE).
