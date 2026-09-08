# Identité Secrète

Jeu de soirée multijoueur en temps réel, mobile-first. 3 à 8 joueurs, chacun sur son
téléphone. Tu reçois une identité secrète, tu la fais deviner avec des icônes, et tu
essaies de reconnaître celles des autres.

**Aucun serveur à déployer.** Le site est un ensemble de fichiers statiques, publiable
sur GitHub Pages, et le moteur de jeu tourne dans le navigateur du joueur qui crée la
partie. Les téléphones échangent ensuite directement, en WebRTC.

---

## Comment ça marche

```
     Téléphone HÔTE                    Téléphones INVITÉS
  ┌──────────────────────┐          ┌──────────────────────┐
  │  Interface           │◄────────►│  Interface           │
  │  + MOTEUR DE JEU     │  WebRTC  │                      │
  │  (état autoritaire)  │  direct  │                      │
  └──────────┬───────────┘          └──────────┬───────────┘
             │                                 │
             └────────────┬────────────────────┘
                          ▼
              Service de mise en relation
        (uniquement pour se trouver, au début)
```

Trois conséquences, à connaître avant de jouer :

- **Le code de partie est un identifiant de rendez-vous.** L'hôte le réserve auprès du
  service de mise en relation ; les invités s'y connectent. C'est ce qui remplace
  l'annuaire de salons que tenait le serveur.
- **L'onglet de l'hôte fait tourner la partie.** Le fermer y met fin pour tout le monde.
  Le rafraîchir, en revanche, est sans danger : la partie est restaurée depuis le
  stockage local de l'hôte, et les autres joueurs se reconnectent tout seuls.
- **Le moteur reste autoritaire.** Il valide tout, et n'envoie à chaque joueur que la vue
  calculée pour lui. Le fait qu'il tourne dans un navigateur ne change rien à ça : un
  invité ne reçoit jamais l'identité d'un autre, pas plus qu'avant.

## Prérequis

- **Node.js ≥ 20.11** (testé sur 22)
- npm ≥ 10

Rien d'autre : pas de base de données, pas de Docker, pas de compte à créer.

## Installation

```bash
git clone <ce-dépôt>
cd identite-secrete
npm install
```

Un seul `npm install` à la racine installe les trois espaces de travail
(`packages/shared`, `packages/engine`, `apps/web`).

## Lancement en développement

```bash
npm run dev
```

Un seul processus, sur http://localhost:3000. Le bandeau en bas de l'accueil doit passer
au vert : « Prêt · aucun serveur nécessaire ». S'il reste rose, voir *Dépannage*.

## Scripts

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement Next |
| `npm test` | Suite Vitest complète (165 tests) |
| `npm run test:watch` | Vitest en mode surveillance |
| `npm run typecheck` | `tsc --noEmit` sur les trois projets |
| `npm run build` | Build de production |
| `npm run build:static` | Site statique dans `apps/web/out` |

## Structure

```
identite-secrete/
├── packages/shared/          # Source de vérité partagée
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
├── packages/engine/          # Moteur autoritaire — sans réseau ni Node
│   └── src/
│       ├── host.ts           # GameHost : reçoit des messages, répond, diffuse
│       ├── transport.ts      # Le seul contrat avec l'extérieur (`Emitter`)
│       ├── persistence.ts    # Sérialisation d'une partie (survie au rechargement)
│       ├── random.ts         # Jetons de session (crypto.getRandomValues)
│       ├── timers.ts         # Registre d'échéances nommées
│       ├── game/             # engine, pause, roundRules, round, lobby, clues, guesses
│       ├── serialization/    # playerView.ts — ce qui sort vers un joueur
│       ├── handlers/         # Table des événements acceptés
│       ├── store/            # GameStore (interface) + InMemoryStore
│       └── __tests__/        # Intégration : vraies parties, vrais minuteurs
└── apps/web/                 # Next.js App Router + Tailwind + Framer Motion
    └── src/
        ├── app/              # /, /creer, /rejoindre, /game, /comment-jouer
        ├── components/       # game/ (écrans de phase), lobby/, ui/
        ├── hooks/            # useGameConnection, useServerClock, useSound
        └── lib/
            ├── net/          # hostNode, guestNode, peer, protocol, hostStorage
            ├── session.ts    # Sessions localStorage
            └── sound.ts      # Web Audio
```

**Le module le plus important est `packages/engine/src/serialization/playerView.ts`.**
Tout ce qui part vers un joueur passe par lui, et il construit ses objets par liste
blanche. Aucun objet `Game` brut n'atteint jamais un canal.

**Le second est `packages/engine/src/game/engine.ts`.** Il détient la machine à états :
seul le moteur décide d'un changement de phase, sur l'échéance `phaseEndsAt` ou sur la
condition « tout le monde a soumis », le premier des deux. Les écrans ne font qu'afficher
le décompte.

**Le troisième est `packages/engine/src/host.ts`.** C'est la frontière : il reçoit des
messages étiquetés par une connexion et répond, sans rien savoir du transport. C'est ce
qui permet de le faire tourner dans le navigateur de l'hôte **et** dans les tests, avec
exactement le même code.

`packages/shared` et `packages/engine` sont consommés **en TypeScript source**, sans étape
de build intermédiaire : `transpilePackages` côté Next. Les écrans et le moteur ne peuvent
donc pas diverger sur un type ou une constante.

## Réseau

Deux services externes sont en jeu, et il faut savoir ce que chacun fait.

**La mise en relation (signalisation).** Elle sert uniquement à ce que les joueurs se
trouvent : l'hôte y réserve son code, les invités le cherchent. Une fois les canaux
ouverts, plus rien n'y passe — ni les identités, ni les indices, ni les scores. Par
défaut on utilise le courtier public de PeerJS, gratuit et sans inscription. Pour
reprendre la main dessus, un PeerServer se lance en une commande :

```bash
npx peerjs --port 9000 --path /peer
```

puis on renseigne `NEXT_PUBLIC_PEER_HOST` & co. (voir [`.env.example`](./.env.example)).

**Les serveurs ICE.** Ils permettent aux navigateurs de trouver un chemin l'un vers
l'autre. Les STUN publics configurés par défaut suffisent au cas courant — tout le monde
dans la même pièce, sur le même Wi-Fi, ce qui est exactement le cadre d'un jeu de soirée.

Ils **ne suffisent pas** derrière certains NAT symétriques, typiquement quand deux joueurs
sont sur deux réseaux mobiles différents. Il faut alors un relais TURN, qui ne peut pas
être gratuit puisqu'il fait transiter tout le trafic. Il se branche via
`NEXT_PUBLIC_ICE_SERVERS`, sans toucher au code.

## Variables d'environnement

Toutes optionnelles. Voir [`.env.example`](./.env.example), commenté.

| Variable | Défaut | Rôle |
|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | *(vide)* | Sous-dossier du site. `/nom-du-depot` sur GitHub Pages |
| `NEXT_OUTPUT` | *(vide)* | `export` pour produire un site statique |
| `NEXT_PUBLIC_PEER_HOST` | *(vide)* | PeerServer à soi. Vide : courtier public PeerJS |
| `NEXT_PUBLIC_PEER_PORT` | — | Port du PeerServer |
| `NEXT_PUBLIC_PEER_PATH` | `/` | Chemin du PeerServer |
| `NEXT_PUBLIC_PEER_KEY` | — | Clé du PeerServer |
| `NEXT_PUBLIC_PEER_SECURE` | `true` | `false` pour un PeerServer en clair (local) |
| `NEXT_PUBLIC_ICE_SERVERS` | 2 STUN publics | Tableau JSON de `RTCIceServer`, TURN compris |

⚠️ Ces variables sont figées au moment du `next build`. Les changer impose de
**reconstruire**, pas seulement de redémarrer.

## Application installable (PWA)

Le site est une **application web installable**. Sur Android comme sur iOS, elle s'ajoute
à l'écran d'accueil et s'ouvre en plein écran, sans barre d'adresse.

- **Android / Chrome** : menu ⋮ → « Installer l'application ».
- **iOS / Safari** : bouton Partager → « Sur l'écran d'accueil ».
  Safari est le seul navigateur iOS qui sait le faire.

Ce qui est en place : `manifest.webmanifest`, icônes 192/512 et « maskable », icône Apple,
couleur de thème, `viewport-fit=cover` pour occuper l'écran sous l'encoche, et un service
worker qui met en cache la coquille de l'application.

Le trafic de jeu passe par WebRTC, qui ne traverse pas `fetch` : le service worker n'a
donc rien à en exclure. Concrètement, l'accueil s'ouvre hors ligne, mais jouer demande
évidemment le réseau.

## Déploiement

### GitHub Pages

Le dépôt contient déjà le workflow `.github/workflows/deploy-pages.yml`.

1. Dans le dépôt : **Settings → Pages → Source : « GitHub Actions »**.
2. Pousse sur `main`.

C'est tout. Le workflow vérifie les types, lance les 165 tests, construit le site statique
et le publie sur `https://TON-PSEUDO.github.io/NOM-DU-DEPOT/`. Aucune variable n'est
requise ; celles de la section *Réseau* peuvent être ajoutées dans
**Settings → Secrets and variables → Actions → Variables** si le besoin s'en fait sentir.

⚠️ **Le site doit être servi en HTTPS** — ce que GitHub Pages fait par défaut. WebRTC et
`crypto.getRandomValues` ne fonctionnent que dans un contexte sécurisé : `https://` ou
`localhost`, jamais une IP en clair.

Pour construire en local et vérifier le résultat :

```bash
npm run build:static
npx serve apps/web/out
```

Attention : servi ainsi sur une IP locale en `http://`, le jeu ne fonctionnera pas —
contexte non sécurisé. Pour tester depuis un téléphone du réseau local, utiliser un
tunnel HTTPS (`npx localtunnel --port 3000`, `ngrok http 3000`) ou déployer.

### Autres hébergeurs

N'importe quel hébergement de fichiers statiques convient : Netlify, Cloudflare Pages,
Vercel, un seau S3, un dossier Apache. Il n'y a rien d'autre à installer. Sur un domaine
dédié, laisser `NEXT_PUBLIC_BASE_PATH` vide.

## Tester à plusieurs onglets

La procédure complète, pas à pas, est dans [`TESTING.md`](./TESTING.md).

En résumé : ouvre quatre **fenêtres de navigation privée séparées** — le `sessionToken`
vit dans le `localStorage`, et deux onglets d'une même fenêtre le partagent. La connexion
WebRTC entre deux onglets du même navigateur fonctionne normalement.

## Dépannage

**Le bandeau reste rose (« Service de mise en relation injoignable »)**
Le courtier public ne répond pas, ou le réseau le bloque. Réessaie ; si c'est durable,
lance ton propre PeerServer (voir *Réseau*).

**Le bandeau dit « Ce navigateur ne gère pas les connexions directes »**
Soit le navigateur est trop ancien, soit le site n'est pas servi en contexte sécurisé.
Vérifie que l'URL commence par `https://` — ou `http://localhost`.

**Le bandeau n'est pas vert : va voir `/diagnostic`**
La page teste le transport en quatre étapes et dit laquelle échoue, avec l'état ICE et
les types de candidats obtenus. C'est la seule information exploitable quand la panne est
sur le téléphone de quelqu'un d'autre — un bouton copie le rapport entier.

| Étape qui échoue | Ce que ça veut dire |
|---|---|
| WebRTC disponible | Navigateur trop ancien, contexte non sécurisé, ou mode isolement d'iOS |
| Mise en relation | Le courtier ne répond pas : connexion ou pare-feu |
| Ouverture du canal | Piste réseau (ICE). **La boucle locale peut mentir ici** : certains navigateurs refusent de se connecter à eux-mêmes tout en marchant entre deux appareils — tenter une vraie partie avant de conclure |
| Passage d'un message | Le navigateur n'écrit pas sur le canal. C'est le cas Safari de D-59 ; s'il réapparaît, c'est une régression de la sérialisation, et le premier test de `protocol.test.ts` devrait l'avoir attrapée |

**« Cette partie n'est plus ouverte »**
L'hôte a fermé son onglet, ou le code a été mal recopié. Il faut recréer une partie :
c'est la contrepartie de l'absence de serveur, l'état ne vit nulle part ailleurs.

**Un joueur n'arrive pas à rejoindre, les autres si**
Presque toujours un problème de NAT : ce joueur est sur un autre réseau que l'hôte.
Le mettre sur le même Wi-Fi règle le cas immédiatement ; sinon il faut un relais TURN
(voir *Réseau*).

**Le site s'affiche sans aucun style sur GitHub Pages**
Le `NEXT_PUBLIC_BASE_PATH` ne correspond pas au nom du dépôt. Le workflow le calcule
automatiquement ; en build manuel, il faut le passer à la main.

**« Installer l'application » n'apparaît pas**
L'installation exige HTTPS (ou `localhost`), un manifeste valide et un service worker
enregistré. En développement le service worker est volontairement désactivé : teste
l'installation sur le site déployé.

## Documents

- [`DECISIONS.md`](./DECISIONS.md) — les arbitrages pris et pourquoi
- [`TESTING.md`](./TESTING.md) — scénario de test manuel
