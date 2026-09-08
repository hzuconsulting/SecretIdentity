# Identité Secrète

Jeu de soirée multijoueur en temps réel, mobile-first. 3 à 8 joueurs, chacun sur son
téléphone. Tu reçois une identité secrète, tu la fais deviner avec des icônes, et tu
essaies de reconnaître celles des autres.

---

## Prérequis

- **Node.js ≥ 20.11** (testé sur 22)
- npm ≥ 10

Rien d'autre : pas de base de données, pas de Docker, pas de service externe.

## Installation

```bash
git clone <ce-dépôt>
cd identite-secrete
npm install
```

Un seul `npm install` à la racine installe les trois espaces de travail
(`packages/shared`, `apps/server`, `apps/web`).

## Lancement en développement

```bash
cp .env.example .env    # optionnel : les valeurs par défaut suffisent en local
npm run dev
```

Cela démarre **les deux processus** en parallèle :

| Processus | URL | Rôle |
|---|---|---|
| Client Next.js | http://localhost:3000 | Interface |
| Serveur Socket.IO | http://localhost:4000 | État de jeu autoritaire |

Ouvre http://localhost:3000. Le bandeau en bas de l'accueil doit passer au vert :
« Serveur connecté · horloge synchronisée ». S'il reste rose, le serveur n'est pas
joignable — voir *Dépannage* plus bas.

Pour lancer un seul côté :

```bash
npm run dev:server
npm run dev:web
```

## Scripts

| Commande | Effet |
|---|---|
| `npm run dev` | Client + serveur ensemble |
| `npm test` | Suite Vitest complète |
| `npm run test:watch` | Vitest en mode surveillance |
| `npm run typecheck` | `tsc --noEmit` sur les trois projets |
| `npm run build` | Build de production du client + vérification de types du serveur |
| `npm run start:server` | Serveur en mode production |

## Structure

```
identite-secrete/
├── packages/shared/          # Source de vérité partagée client ⇄ serveur
│   └── src/
│       ├── types.ts          # Modèle de données, phases, vues joueur, erreurs
│       ├── constants.ts      # Toutes les valeurs de réglage et les durées
│       ├── events.ts         # Noms d'événements + schémas Zod de validation
│       ├── scoring.ts        # Calcul de score (fonction pure, testée)
│       ├── dealHand.ts       # Distribution des mains avec quotas
│       ├── identityPool.ts   # Attribution des identités
│       ├── gameCode.ts       # Codes de salon
│       ├── rng.ts            # RNG injectable (rend tout testable)
│       ├── format.ts         # Décomptes, avatars, libellés
│       └── data/
│           ├── identities.ts # 293 identités
│           └── icons.ts      # 349 icônes emoji
├── apps/server/              # Node + Socket.IO, état en mémoire, autoritaire
│   └── src/
│       ├── index.ts          # Lecture de l'environnement, écoute, arrêt propre
│       ├── server.ts         # Fabrique du serveur (réutilisée par les tests)
│       ├── config/env.ts     # Environnement validé au démarrage
│       ├── game/             # engine, pause, roundRules, round, lobby, clues, guesses
│       ├── serialization/    # playerView.ts — ce qui sort vers un socket
│       ├── socket/           # handlers/ (session, round) + emit.ts (diffusion)
│       ├── store/            # GameStore (interface) + InMemoryStore
│       └── __tests__/        # Intégration : vrais sockets, vrai serveur
└── apps/web/                 # Next.js App Router + Tailwind + Framer Motion
    └── src/
        ├── app/              # /, /creer, /rejoindre, /game/[code], /comment-jouer
        ├── components/       # game/ (écrans de phase), lobby/, ui/
        ├── hooks/            # useGameConnection, useServerClock, useSound
        └── lib/              # socket, session localStorage, sound (Web Audio)
```

**Le module le plus important est `apps/server/src/serialization/playerView.ts`.** Tout
ce qui part vers un client passe par lui, et il construit ses objets par liste blanche.
Aucun objet `Game` brut n'atteint jamais un socket.

**Le second est `apps/server/src/game/engine.ts`.** Il détient la machine à états : seul
le serveur décide d'un changement de phase, sur l'échéance `phaseEndsAt` ou sur la
condition « tout le monde a soumis », le premier des deux. Le client ne fait qu'afficher
le décompte.

`packages/shared` est consommé **en TypeScript source**, sans étape de build
intermédiaire : `transpilePackages` côté Next, `tsx` côté serveur. Client et serveur ne
peuvent donc pas diverger sur un type ou une constante.

## Tester à plusieurs onglets

La procédure complète, pas à pas, est dans [`TESTING.md`](./TESTING.md).

En résumé : ouvre quatre onglets (ou mieux, quatre fenêtres de navigation privée
séparées — le `sessionToken` vit dans le `localStorage`, et deux onglets d'une même
fenêtre le partagent). Sur un vrai téléphone du réseau local, remplace `localhost` par
l'IP de ta machine, et lance le client avec `next dev -H 0.0.0.0`.

## Variables d'environnement

Voir [`.env.example`](./.env.example), commenté.

| Variable | Côté | Défaut | Rôle |
|---|---|---|---|
| `PORT` | serveur | `4000` | Port d'écoute |
| `CLIENT_ORIGIN` | serveur | `http://localhost:3000` | Origines CORS autorisées, séparées par des virgules |
| `NODE_ENV` | serveur | `development` | Niveau de log |
| `NEXT_PUBLIC_SERVER_URL` | client | `http://localhost:4000` | URL du serveur Socket.IO, **inlinée au build** |

⚠️ `NEXT_PUBLIC_SERVER_URL` est figée au moment du `next build`. La changer sur Vercel
impose de **redéployer**, pas seulement de redémarrer.

## Déploiement

Le serveur Socket.IO a besoin d'un **processus persistant** et d'un état en mémoire :
il ne peut pas tourner en fonction serverless. D'où le déploiement en deux morceaux.

### Client → Vercel

1. Importe le dépôt sur Vercel.
2. **Root Directory** : `apps/web`.
3. Coche « Include files outside the root directory » (le monorepo a besoin de
   `packages/shared`).
4. Build command : `npm run build` · Install command : `npm install` (lancée à la racine).
5. Variable d'environnement : `NEXT_PUBLIC_SERVER_URL` = l'URL publique du serveur,
   en `https://`.
6. Déploie, puis reporte l'URL Vercel obtenue dans `CLIENT_ORIGIN` côté serveur.

### Serveur → Railway (ou Fly / Render)

**Railway**

1. Nouveau service depuis le dépôt.
2. Root Directory : la racine du dépôt (pas `apps/server` — npm workspaces a besoin de
   la racine pour résoudre `@identite-secrete/shared`).
3. Build command : `npm install`
4. Start command : `npm run start:server`
5. Variables : `CLIENT_ORIGIN` = l'URL Vercel, `NODE_ENV=production`.
   `PORT` est fourni automatiquement par Railway — ne le définis pas à la main.
6. Génère un domaine public, et reporte-le dans `NEXT_PUBLIC_SERVER_URL` côté Vercel.

**Render** : mêmes réglages, type « Web Service », plan avec instance persistante
(le plan gratuit met le service en veille, ce qui coupe les parties en cours).

**Fly.io** : `fly launch` à la racine, `internal_port = 4000`, et
`auto_stop_machines = false` pour la même raison.

Vérifie le déploiement avec `curl https://<serveur>/health` : la réponse contient le
nombre de parties en cours et la taille du catalogue.

## Dépannage

**Le bandeau reste rose (« Serveur injoignable »)**
Le serveur ne tourne pas, ou `NEXT_PUBLIC_SERVER_URL` pointe ailleurs. Teste
`curl http://localhost:4000/health`.

**Erreur CORS dans la console du navigateur**
L'origine du client n'est pas dans `CLIENT_ORIGIN`. En production, l'URL doit être
exacte, avec le schéma et sans barre oblique finale.

**Le client se connecte en local mais pas depuis un téléphone**
Lance Next avec `-H 0.0.0.0`, et mets l'IP locale de la machine (pas `localhost`)
dans `NEXT_PUBLIC_SERVER_URL` **et** dans `CLIENT_ORIGIN`.

## Documents

- [`DECISIONS.md`](./DECISIONS.md) — les arbitrages pris et pourquoi
- [`TESTING.md`](./TESTING.md) — scénario de test manuel
