# Identité Secrète

Adaptation en ligne de **SECRET IDENTITY** (Funnyfox), mobile-first. 2 à 8 joueurs,
chacun sur son téléphone. Huit personnages numérotés sont posés au centre, tu reçois
en secret le numéro de l'un d'eux, et tu le fais deviner en posant des pictogrammes
dans ton boîtier — en vert ce qui lui ressemble, en rouge ce qui ne lui ressemble pas.
Pendant ce temps, tu essaies de reconnaître les autres.

Les règles du livret sont suivies fidèlement : **8 personnages quel que soit le nombre
de joueurs** (donc des leurres), **10 cartes Picto pour toute la partie**, jamais
rechargées, **4 manches**, et le départage à l'égalité aux cartes gardées. La seule
adaptation est le **minuteur par phase**, réglable dans le salon — « Auto » par défaut,
qui s'allonge avec le nombre de joueurs, ou une durée fixe jusqu'à 5 min.

Ce que l'adaptation en ligne ajoute :

- **Parties publiques ou privées.** Une partie publique apparaît sur l'accueil et se
  rejoint d'un toucher ; une partie privée ne s'ouvre qu'avec son code.
- **On ne perd jamais sa place.** Quitter une partie en cours, perdre le réseau ou
  changer de téléphone : on revient avec le code et le même pseudo, points et main
  intacts. Le code reste affiché pendant toute la partie.
- **Les règles en un geste**, par-dessus la partie, sans la quitter.
- **Un grand catalogue** — plus de mille personnages, près de mille pictogrammes — et
  l'hôte se souvient des personnages déjà vus d'une soirée à l'autre.

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
  invité ne reçoit jamais le numéro d'un autre, pas plus qu'avant. Le plateau, lui,
  est public — comme les huit cartes posées au centre de la table.

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
| `npm test` | Suite Vitest complète (304 tests) |
| `npm run test:watch` | Vitest en mode surveillance |
| `npm run test:e2e` | Vraie partie à deux navigateurs (demande `npm run dev` et Chrome) |
| `npm run test:e2e:manche` | Manche complète à quatre : exclusion, plateau de 8, pose vert/rouge, vote, décompte |
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
│       ├── dealHand.ts       # Distribution des cartes Picto (4 pictos, 2 par face) avec quotas
│       ├── identityPool.ts   # Tirage des personnages du plateau
│       ├── gameCode.ts       # Codes de salon
│       ├── rng.ts            # RNG injectable (rend tout testable)
│       ├── format.ts         # Décomptes, avatars, libellés
│       └── data/
│           ├── identities.ts # ~300 personnages
│           └── icons.ts      # 349 pictogrammes emoji
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
l'autre. Les STUN suffisent au cas courant — tout le monde dans la même pièce, sur le même
Wi-Fi, ce qui est exactement le cadre d'un jeu de soirée : ils apprennent à chaque pair son
adresse publique, et les deux se parlent ensuite directement.

Ils **ne suffisent pas** derrière un NAT symétrique, typiquement quand deux joueurs sont
sur deux réseaux mobiles différents : aucune adresse devinée ne fonctionne, et le canal ne
s'ouvre jamais. Il faut alors un **relais TURN**, qui fait transiter le trafic.

Un relais public mutualisé (`openrelay.metered.ca`) est donc inclus par défaut, sur trois
ports — 80, 443, et 443 en TCP — pour passer le plus grand nombre de pare-feux. C'est un
service gratuit : il peut être lent, saturé, ou disparaître. Pour en brancher un à soi,
`NEXT_PUBLIC_ICE_SERVERS` **remplace** toute la liste :

```bash
NEXT_PUBLIC_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:mon-turn:3478","username":"u","credential":"p"}]'
```

> Les identifiants TURN sont en clair dans le bundle, et il n'y a pas moyen de faire
> autrement : sans serveur, tout ce que le navigateur doit connaître y est de toute façon.
> Un relais destiné à cet usage doit donc avoir ses propres quotas.

**Pour savoir si le relais marche depuis ce téléphone-là**, ouvrir `/diagnostic` : la
cinquième étape demande une vraie allocation et rapporte les codes d'erreur ICE (401 pour
des identifiants refusés, 701 pour un serveur injoignable).

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
| `NEXT_PUBLIC_ICE_SERVERS` | 2 STUN + 3 TURN publics | Tableau JSON de `RTCIceServer`. **Remplace** toute la liste |
| `NEXT_PUBLIC_DIRECTORY_URL` | sujet ntfy.sh public | Annuaire des parties publiques (URL d'un sujet ntfy). `off` le désactive |

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

C'est tout. Le workflow vérifie les types, lance les 304 tests, construit le site statique
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

## Vérifier le transport

Deux outils, et ils ne disent pas la même chose.

**`/diagnostic`**, dans le site. Il teste le transport en quatre étapes sur l'appareil qui
l'ouvre, et un bouton copie le rapport entier — c'est ce qu'il faut demander à quelqu'un
dont le jeu ne marche pas.

Attention à sa limite, qui est réelle : les étapes « ouverture du canal » et « passage
d'un message » se font **en boucle sur l'appareil**, qui se connecte à lui-même. Safari
refuse cette boucle tout en fonctionnant parfaitement entre deux téléphones. Un échec y
est donc **non concluant**. La page affiche aussi l'historique des vraies parties tentées,
avec leur état ICE : cette liste-là fait foi.

**`npm run test:e2e`**, en développement. Il joue une vraie partie entre deux navigateurs
— création, code, jointure, diffusion temps réel — et affiche la négociation ICE des deux
côtés. C'est le seul test qui exerce WebRTC pour de bon :

```bash
npm run dev          # dans un terminal
npm run test:e2e     # dans un autre
BASE=https://mon-site npm run test:e2e   # ou contre le site déployé
```

Il n'est pas dans `npm test` : il lui faut un serveur et un vrai Chrome. **À lancer avant
tout déploiement qui touche à `lib/net/`** — les tests unitaires ne couvrent pas cette
couche, et c'est elle qui a produit toutes les pannes de production jusqu'ici.

**`npm run test:e2e:manche`** va plus loin : quatre navigateurs, une exclusion par
l'hôte, puis une manche entière jouée pour de vrai — plateau de 8 personnages, main de
10 cartes, pose en vert et en rouge, vote nominatif, dépouillement des votes, une
révélation qui **reste affichée** tant que l'hôte n'a pas lancé la manche suivante, la
main qui a bien fondu à 8 — puis le code visible en jeu, les règles ouvertes et fermées
sans quitter la phase, et un joueur qui quitte la partie et y revient depuis l'accueil,
dans la même manche et avec sa main. C'est la vérification à lancer après un changement
de règles ou d'interface de partie.

## Dépannage

**Le bandeau reste rose (« Service de mise en relation injoignable »)**
Le courtier public ne répond pas, ou le réseau le bloque. Réessaie ; si c'est durable,
lance ton propre PeerServer (voir *Réseau*).

**Le bandeau dit « Ce navigateur ne gère pas les connexions directes »**
Soit le navigateur est trop ancien, soit le site n'est pas servi en contexte sécurisé.
Vérifie que l'URL commence par `https://` — ou `http://localhost`.

**Le bandeau n'est pas vert : va voir `/diagnostic`**
La page teste le transport en cinq étapes et dit laquelle échoue, avec l'état ICE et
les types de candidats obtenus. C'est la seule information exploitable quand la panne est
sur le téléphone de quelqu'un d'autre — un bouton copie le rapport entier.

| Étape qui échoue | Ce que ça veut dire |
|---|---|
| WebRTC disponible | Navigateur trop ancien, contexte non sécurisé, ou mode isolement d'iOS |
| Mise en relation | Le courtier ne répond pas : connexion ou pare-feu |
| Ouverture du canal | Piste réseau (ICE). **La boucle locale peut mentir ici** : certains navigateurs refusent de se connecter à eux-mêmes tout en marchant entre deux appareils — tenter une vraie partie avant de conclure |
| Passage d'un message | Le navigateur n'écrit pas sur le canal. C'est le cas Safari de D-59 ; s'il réapparaît, c'est une régression de la sérialisation, et le premier test de `protocol.test.ts` devrait l'avoir attrapée |
| Relais TURN | Aucun relais n'a alloué depuis ce réseau. **N'empêche pas de jouer sur un Wi-Fi commun** — mais rend improbable une partie entre deux réseaux différents. Le détail donne les codes d'erreur ICE |

**« Cette partie n'est plus ouverte »**
L'hôte a fermé son onglet, ou le code a été mal recopié. Il faut recréer une partie :
c'est la contrepartie de l'absence de serveur, l'état ne vit nulle part ailleurs.

**Un joueur n'arrive pas à rejoindre, les autres si**
Presque toujours un problème de NAT : ce joueur est sur un autre réseau que l'hôte. Le
relais par défaut est censé couvrir ce cas — faire ouvrir `/diagnostic` à ce joueur et
regarder l'étape *Relais TURN*. Si elle échoue, le mettre sur le même Wi-Fi règle le cas
immédiatement ; sinon il faut brancher un relais à soi (voir *Réseau*).

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
