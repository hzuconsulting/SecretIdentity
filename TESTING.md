# TESTING.md

Deux choses ici : la suite automatisée, et le scénario manuel à plusieurs appareils.

---

## 1. Tests automatisés

```bash
npm test            # tout
npm run test:watch  # en surveillance pendant le développement
npm run typecheck   # tsc --noEmit sur shared, engine et client
```

### Couverture — 165 tests

**`scoring.test.ts`** — le calcul de score du §3.2
- 3 joueurs : personne ne trouve · tout le monde trouve · réponses partielles
- 8 joueurs : plafond à N−1 dans chaque colonne
- une réponse portant sur sa propre étiquette est ignorée
- une étiquette inconnue est ignorée
- un joueur absent du round n'écrit rien
- aucune mutation de l'objet d'entrée
- agrégation des statistiques de fin de partie

**`game-logic.test.ts`** — les données et les tirages
- catalogue d'identités : ≥ 200, aucun id ni nom en double, 11 catégories,
  répartition des difficultés, assez d'identités par difficulté pour 8 joueurs
- packs : `getIdentityPool(['disney'])` filtre réellement
- catalogue d'icônes : ≥ 250, aucun id ni emoji en double, label et mots-clés partout
- `dealHand` : taille exacte, aucun doublon, quotas respectés sur **50 graines**,
  déterminisme à graine égale, divergence à graines différentes, échec franc sur
  catalogue trop petit
- `drawIdentities` : identités distinctes, filtre de difficulté, non-réutilisation sur
  5 manches consécutives, réinitialisation contrôlée quand le pool est épuisé
- codes de partie : format, absence de `0/O/1/I` sur 2 000 tirages, 500 codes uniques
  d'affilée, normalisation de la saisie

**`contracts.test.ts`** — les schémas Zod et l'affichage
- pseudo nettoyé, vide refusé, trop long refusé
- code de partie normalisé (` k7p-4q ` → `K7P4Q`)
- **toutes** les options du salon du §3.3 acceptées, toute valeur hors options refusée
- sélection d'indices vide refusée
- décomptes, couleurs d'avatar stables, suggestion de pseudo (`Sarah` → `Sarah2`)

**`lobby.test.ts`** — intégration, avec de vrais clients parlant à un vrai `GameHost`
par un canal en mémoire. Le transport est le seul élément remplacé : les règles, les
phases et les minuteurs sont ceux de production. Seules les périodes de grâce sont
raccourcies (120 ms et
80 ms au lieu de 60 s et 30 s), injectées par `createGameServer`.

- *création* : code au bon format, jeton de session, vue immédiate au créateur qui est
  hôte, pseudo vide refusé, codes distincts pour deux parties simultanées
- *jointure* : liste mise à jour en temps réel chez les deux joueurs, code accepté en
  minuscules et avec des espaces, `GAME_NOT_FOUND`, `NICKNAME_TAKEN` avec suggestion,
  `GAME_FULL` au neuvième joueur
- *paramètres* : rediffusion à tous, valeurs non touchées préservées, `NOT_HOST` pour un
  invité (et l'état du moteur reste inchangé), valeur hors options refusée
- *déconnexion* : joueur marqué déconnecté sans être retiré, session restaurée à
  l'identique par jeton, retrait effectif après la période de grâce, retrait **annulé**
  si le joueur revient à temps, jeton inconnu refusé, partie supprimée quand le dernier
  joueur part
- *hôte* : transfert immédiat au départ volontaire, transfert différé sur déconnexion,
  **pas** de transfert si l'hôte revient à temps, successeur = joueur connecté le plus
  ancien (un joueur plus ancien mais déconnecté est sauté)
- *confidentialité* : le `sessionToken` d'un joueur n'apparaît dans **aucun** payload reçu
  par un autre (le client de test capture tout via `onAny`, pas seulement les événements
  attendus) ; aucune vue ne contient `sessionToken`, `labelMap`, `connectionId` ni
  `usedIdentityIds` ; un joueur public n'expose exactement que `id`, `nickname`, `score`,
  `connected`, `isHost`
- *robustesse* : action sans session refusée proprement, double départ idempotent,
  payload malformé ignoré sans fermer la connexion

**`phases.test.ts`** — intégration, machine à états. Le nœud de test applique un
facteur `timeScale` de 0,01 à **toutes** les durées de phase : une phase réglée sur 60 s
y dure 600 ms. Les minuteurs restent de vrais `setTimeout`.

- *lancement* : refusé sous 3 joueurs, refusé pour un non-hôte, réglages verrouillés dès
  le départ, double lancement rejeté
- *attribution* : identités distinctes pour 4 joueurs, mains à la bonne taille et sans
  doublon, étiquettes `A`–`D` distinctes, aucune identité réutilisée d'une manche à l'autre
- *transitions* : `IDENTITY_REVEAL → CLUE_SELECTION` automatique et annoncée dans cet
  ordre, échéance cohérente avec l'horloge de l'hôte, **échéance identique pour tous les
  joueurs**, pas d'échéance au salon, `round:next` par l'hôte depuis le classement,
  `round:next` refusé hors phase et pour un non-hôte, partie complète de 3 manches
  jusqu'à `FINAL_RESULTS` avec classement et statistiques
- *confidentialité en manche* : aucun payload reçu par un joueur ne contient l'identité
  d'un autre (instantané figé pendant `CLUE_SELECTION`, avant que `RESULTS` ne révèle
  tout légitimement) ; `labelMap` n'apparaît nulle part ; `clueSets` n'existe qu'en
  `GUESSING` et ne porte que `label` et `iconIds` ; chaque joueur reçoit sa propre main
  et pas celle des autres ; la progression ne contient que des booléens
- *reconnexion en manche* : phase, identité, main, numéro de manche et **échéance**
  restaurés à l'identique

**`clues.test.ts`** — intégration, sélection et validation des indices.

- *soumission valide* : sélection enregistrée et renvoyée au joueur ; progression visible
  chez les autres **sans que leurs icônes fuitent** (vérifié sur tous les payloads reçus) ;
  un seul indice accepté ; la phase se conclut dès que les trois joueurs ont validé, sans
  attendre le minuteur
- *anti-triche* : icône absente de la main refusée, icône **piochée dans la main d'un
  autre joueur** refusée, dépassement du maximum refusé, sélection vide refusée, doublon
  refusé, et surtout : **une validation qui échoue n'écrit rien** dans l'état du moteur
- *idempotence* : deux soumissions identiques (ordre inversé) réussissent sans effet de
  bord ; changer d'avis après validation est refusé ; une soumission arrivée après la
  phase renvoie `TOO_LATE` avec « Trop tard ! »
- *validation automatique* : une icône de sa propre main est tirée au sort pour qui n'a
  rien envoyé ; la sélection de ceux qui avaient validé est conservée ; chaque joueur se
  retrouve avec N−1 séries **non vides** à deviner
- *déconnexion en pleine sélection* : le départ du dernier joueur attendu conclut la
  phase au lieu de la bloquer ; une sélection déjà validée est restaurée à la reconnexion

**`guesses.test.ts`** — intégration, devinette, scores et rejouer. Les tests lisent
`labelMap` directement dans le store pour composer des réponses justes ou fausses ; les
**clients**, eux, ne la reçoivent jamais.

- *matériel* : N−1 séries et N−1 identités, la sienne exclue des deux ; listes triées
- *validation* : appariement complet accepté, appariement partiel accepté, deux fois la
  même identité refusée, **deviner sa propre série refusée**, **proposer sa propre
  identité refusée**, identité inconnue refusée, et un échec n'écrit rien
- *idempotence* : deux soumissions identiques réussissent, un changement d'avis est refusé
- *scores* : maximum quand tout le monde trouve tout (+2 / +2 à trois joueurs) ; zéro
  partout quand personne ne répond ; **cas mixte** — Sarah répond juste, Allan inverse ses
  deux réponses, Malo ne répond pas, et chaque colonne est vérifiée séparément ; cumul sur
  plusieurs manches jusqu'aux statistiques finales
- *rejouer* : scores remis à zéro, retour au salon, `usedIdentityIds` **conservé**,
  refusé hors fin de partie et pour un non-hôte, et une partie complète peut repartir

**`robustness.test.ts`** — cas limites du §9.

- *mise en pause* : la partie gèle sous 3 joueurs connectés, les actions de jeu sont
  refusées avec `GAME_PAUSED`, **la phase n'avance plus** (vérifié en attendant plus
  longtemps que la durée de phase), la reprise repart avec une échéance neuve, les
  soumissions déjà faites sont conservées, et **les points ne sont pas comptés deux fois**
- *joueur parti en cours de manche* : la manche se termine et sa série est révélée sous
  « Joueur parti » ; il est exclu des attributions de la manche suivante
- *limitation de débit* : fenêtre glissante testée unitairement ; en intégration, une
  rafale reçoit `RATE_LIMITED` sans que le canal soit fermé
- *purge* : une partie inactive au-delà du TTL est supprimée, une partie active est
  épargnée, et le jeton de session d'une partie purgée est oublié
- *robustesse générale* : partie supprimée quand tout le monde s'est déconnecté
  définitivement, aucune échéance orpheline derrière une partie supprimée, survie à une
  rafale de payloads malformés (`null`, texte, nombre, tableau), et toutes les actions de
  jeu sans session renvoient `SESSION_NOT_FOUND`

---

## 2. Vérification manuelle du salon

Le jeu n'est pas encore jouable (les manches arrivent aux Lots 2 à 4). Ce qui doit être
vérifié à ce stade, c'est le **salon multijoueur**, à deux navigateurs minimum.

### 2.1 Le site seul

```bash
npm run dev
```

Un seul processus, sur http://localhost:3000. Il n'y a plus de serveur de jeu à lancer :
le moteur démarre dans l'onglet du joueur qui crée la partie.

`localhost` est un contexte sécurisé, donc WebRTC et `crypto.getRandomValues` y
fonctionnent. Une IP locale en `http://` **ne l'est pas** — voir §3 pour tester depuis un
téléphone.

### 2.2 L'accueil

Ouvre http://localhost:3000.

Le bandeau du bas n'est pas décoratif : il ouvre deux pairs sur l'appareil et fait
réellement passer un message par un canal WebRTC, avec la sérialisation de production.
**Le vérifier sur chaque nouvel appareil avant de jouer** — c'est trois secondes, et ça
distingue un navigateur incapable d'un ami qui a fermé son onglet.

| À vérifier | Attendu |
|---|---|
| Titre | `IDENTITÉ SECRÈTE`, « Secrète » en violet |
| Héros | Carte sombre « Cléopâtre » + cinq icônes en éventail, numérotées 1 à 5 |
| Bandeau du bas | Point **vert**, « Prêt · aucun serveur nécessaire, les téléphones se parlent directement » |
| Compteur | « 3 à 8 joueurs · 293 identités · 349 icônes » |
| `COMMENT JOUER ?` | Ouvre `/comment-jouer`, cinq étapes numérotées, retour vers l'accueil |
| `CRÉER` / `REJOINDRE` | Mènent à `/creer` et `/rejoindre` |

### 2.3 Le salon à deux navigateurs

Ouvre deux **contextes séparés** (voir §3 pour la raison) : une fenêtre normale et une
fenêtre de navigation privée.

| Étape | Attendu |
|---|---|
| Fenêtre A : `CRÉER UNE PARTIE`, pseudo « Sarah » | Redirection vers `/game?c=XXXXX`, code affiché en cinq jetons noirs ; mention « la partie tourne sur ton téléphone » en bas |
| `COPIER LE CODE` | « Copié ! » sous les boutons |
| `PARTAGER` | Feuille de partage native sur mobile, copie du lien ailleurs |
| Fenêtre B : coller le lien `/game?c=XXXXX` | Le salon demande le pseudo **sur place**, sans repasser par l'accueil |
| Fenêtre B : pseudo « Allan » | Les **deux** fenêtres affichent 2 joueurs, sans rechargement |
| Fenêtre A | 👑 sur Sarah, badge « Toi » sur Sarah, « 2 sur 8 connectés » |
| Fenêtre B : réglages | Boutons visibles mais **inertes**, mention « Seul l'hôte peut les changer » |
| Fenêtre A : passer les manches à 8 | La fenêtre B bascule sur 8 en moins d'une seconde |
| Fenêtre B : entrer le pseudo « sarah » | Erreur rose « pseudo déjà pris », suggestion `sarah2` **pré-remplie** dans le champ |
| Bouton `LANCER LA PARTIE` | Visible chez l'hôte seulement ; désactivé sous 3 joueurs avec « Encore 1 joueur… » |

### 2.6 Une manche complète

Trois contextes ouverts, réglages laissés par défaut (5 manches, 60 s / 60 s).

| Étape | Attendu |
|---|---|
| L'hôte clique sur `LANCER LA PARTIE` | Les trois écrans basculent ensemble sur « Ton identité » |
| Comparer les trois écrans | **Trois identités différentes**, chacun ne voit que la sienne |
| `👁 MASQUER MON IDENTITÉ` | Le nom devient « IDENTITÉ MASQUÉE » ; `Maintenir pour voir` ne l'affiche que pendant l'appui |
| Passer l'onglet en arrière-plan pendant l'appui | Le nom se recache immédiatement |
| Après 5 s | Bascule automatique sur « Tes indices », main de 10 icônes visible |
| Appuyer sur trois icônes | Bordure violette **et** pastilles numérotées 1, 2, 3 ; compteur « 3 / 3 indices sélectionnés » |
| Appuyer sur une quatrième | Rien ne se passe, les icônes non choisies sont grisées |
| Réappuyer sur l'icône n° 2 | Elle se désélectionne, la n° 3 devient la n° 2 |
| `VALIDER MES INDICES` | Demande « Confirmer ces indices ? » avec `MODIFIER` et `CONFIRMER` |
| `CONFIRMER` | Écran vert « Indices validés ! », liste de progression `Allan ⏳ / Malo ⏳` |
| Les trois joueurs valident | La phase suivante démarre **immédiatement**, sans attendre le décompte |
| Refaire une manche sans rien choisir chez un joueur | À la fin du décompte, une icône de sa main apparaît quand même dans sa série |
| Comparer les décomptes | **Même valeur à ± 1 s** sur les trois appareils |
| Sous 10 s | Le décompte passe au rose, l'icône change de ⏱️ à ⏳, il pulse |
| À `00:00` | Le décompte reste à zéro, puis la bascule arrive — c'est le moteur qui décide, pas l'écran |
| Phase « Qui est qui ? » | N−1 séries anonymes **avec les vraies icônes choisies**, la sienne absente ; un sélecteur par série |
| Choisir la même identité pour deux séries | Les deux affectations **s'échangent**, aucun message d'erreur |
| Laisser une case vide | `VALIDER MES RÉPONSES` reste désactivé, la légende indique `1 / 2` |
| Tout remplir puis valider | Écran vert « Réponses envoyées ! » avec le récapitulatif |
| Ne rien remplir et laisser filer le décompte | Les réponses partent vides, elles comptent comme fausses |
| Phase « Révélation » | Les séries se dévoilent **une par une**, à 1,5 s d'intervalle |
| Sur chaque carte | Identité, auteur, icônes numérotées, « 2 joueurs sur 2 ont trouvé », et un badge ✓ Trouvé / ✗ Raté selon ta propre réponse |
| Après la dernière carte | Le détail des points apparaît : `Faire deviner : +2 · Bonnes réponses : +2` |
| Phase « Classement » | Podium 🥇🥈🥉, tous à 0 point ; `MANCHE SUIVANTE` chez l'hôte seulement |
| Attendre 20 s sans rien cliquer | La manche 2 démarre toute seule |
| Après la dernière manche | Écran de fin, 🏆, classement, trois statistiques |
| `REJOUER` (hôte) | Retour au salon, tous les scores à zéro, mêmes joueurs et mêmes réglages |
| Relancer après REJOUER | Les identités de la partie précédente ne réapparaissent pas |
| `NOUVELLE PARTIE` | Sortie du salon et retour à l'accueil |

**Le contrôle qui compte** : pendant « Tes indices », fais valider un joueur puis ouvre
les outils de développement d'un **autre** → Réseau → WS → Messages. Il doit voir passer
« Sarah a validé » sous forme d'un simple booléen, et **aucune** des icônes qu'elle a
choisies, ni son identité, ni sa main. C'est la garantie n° 1 du §6, vérifiée automatiquement par
`phases.test.ts` mais qui mérite d'être vue une fois de ses propres yeux.

### 2.7 Mise en pause

Trois contextes en pleine manche. Ferme brutalement l'onglet de l'un d'eux.

| À vérifier | Attendu |
|---|---|
| Chez les deux autres | Un voile sombre recouvre l'écran : « Partie en pause », avec le nom de l'absent·e |
| Le décompte | **Gelé** — attends deux minutes, la phase ne passe pas |
| Toute action | Impossible, l'écran de jeu n'est plus cliquable |
| Rouvrir le lien chez l'absent·e | La partie reprend chez tout le monde, sur la **même phase**, avec un décompte complet |
| Ce qui avait été validé | Toujours validé — on ne recommence pas |
| Ne laisser personne revenir | Au bout de 2 minutes, retour au salon avec les scores remis à zéro |

### 2.8 Actualiser en pleine manche

À n'importe quelle phase, appuie sur F5 chez un joueur au hasard. Attendu : il revient
**exactement** où il en était — même phase, même identité, même main, même décompte. Le
décompte ne repart pas de zéro : il est calculé depuis `phaseEndsAt`, un timestamp produit
par l'hôte.

**À refaire en visant l'hôte lui-même.** C'est le cas nouveau, et le plus important : son
onglet fait tourner la partie. Le moteur est restauré depuis son `localStorage`, il
reprend son code auprès du service de mise en relation, et les autres joueurs se
reconnectent seuls en quelques secondes — sans redemander leur pseudo. Attendu chez eux
pendant l'opération : « Connexion perdue », puis retour automatique à l'écran de la phase
en cours.

### 2.4 Actualiser la page

Dans la fenêtre B, appuie sur F5. Attendu : le salon revient **directement**, sans
redemander le pseudo, avec la même liste de joueurs et les mêmes réglages. C'est
`game:rejoin` avec le `sessionToken` du `localStorage`.

Puis vide le stockage (outils de développement → Application → Local Storage → supprimer
`identite-secrete:session`) et actualise : le salon redemande le pseudo. Les deux
comportements sont corrects, ils vérifient les deux branches.

### 2.5 Transfert du rôle d'hôte

Trois contextes ouverts, Sarah hôte.

| Action | Attendu |
|---|---|
| Sarah clique sur `QUITTER` | Immédiatement, 👑 passe à Allan ; message « Allan est le nouvel hôte » chez tout le monde |
| Fermer brutalement l'onglet de l'hôte (sans `QUITTER`) | Le joueur passe en grisé barré « Déconnecté·e — la place reste réservée », puis après **30 s** le 👑 change et un message jaune l'annonce |
| L'hôte revient (rouvrir le lien) avant 30 s | Il **garde** la couronne, la ligne repasse en normal |
| Un joueur non-hôte se déconnecte plus de **60 s** | Il disparaît de la liste, message « … a quitté la partie » |

### 2.9 La disparition de l'hôte

Deux cas, à ne pas confondre — c'est la contrepartie de l'absence de serveur.

| Action sur l'onglet de l'hôte | Attendu chez les invités |
|---|---|
| **F5** (rechargement) | « Connexion perdue » quelques secondes, puis retour tout seul à la phase en cours, sans rien retaper |
| **Fermeture** de l'onglet | « Connexion perdue », puis après une série de tentatives : « Partie fermée — l'hôte a fermé son onglet ». Il faut recréer une partie |

Le second cas est **normal** : l'état de la partie ne vit nulle part ailleurs que dans
l'onglet de l'hôte. Vérifie surtout que le message le dit clairement, plutôt que de
laisser tourner une reconnexion sans fin.

### 2.12 Perte de réseau chez un invité

Coupe le Wi-Fi d'un invité en pleine manche, attends dix secondes, rétablis-le. Attendu :
il repasse en ligne tout seul, retrouve sa phase et sa main. Chez les autres, il apparaît
grisé pendant la coupure, puis redevient normal — sans qu'aucune phase ne soit sautée.

### 2.10 Sons

| À vérifier | Attendu |
|---|---|
| Au chargement d'une page | **Aucun son** — jamais |
| Bouton 🔊 dans l'en-tête | Présent sur le salon et sur tous les écrans de manche |
| Appuyer dessus | Passe à 🔇, et le réglage survit à un rechargement |
| Sélectionner une icône | Bip court montant ; la retirer donne un bip descendant |
| Valider | Deux notes ascendantes |
| Sous 10 s de décompte | Un double bip, **une seule fois** — pas à chaque seconde |
| Pendant la révélation | Un son par carte, différent selon que tu avais trouvé ou non |
| Fin de partie | Arpège de victoire |
| Son coupé | Plus rien, y compris pendant la révélation |

### 2.11 Accessibilité — passe complète

- Navigation clavier : `Tab` atteint tous les contrôles, le focus est toujours **visible**
  (anneau sombre, y compris sur fond coloré).
- Cibles tactiles : toutes ≥ 44 px, y compris le bouton 🔊 et les puces de réglage.
- Zoom à 200 % : rien ne déborde, rien ne se chevauche.
- Sélection d'icône : la pastille numérotée est présente en plus de la bordure violette —
  l'information n'est jamais portée par la seule couleur. Idem pour l'urgence du
  décompte, qui change d'icône (⏱️ → ⏳) en plus de virer au rose.
- Lecteur d'écran : chaque icône annonce son libellé français (« Couronne », « Serpent »…),
  jamais le nom de l'emoji. Chaque changement de phase est annoncé via `aria-live`.
- Sélecteurs d'identité : `<select>` natifs, donc utilisables au clavier et annoncés
  correctement, sans code d'accessibilité maison.
- `prefers-reduced-motion` activé dans le système : les animations d'entrée disparaissent,
  et la révélation affiche **toutes** les cartes d'un coup — même information, mise en
  scène en moins.
- Masquage d'identité : le bouton `Maintenir pour voir` répond aussi à la barre d'espace
  maintenue.

---

## 3. Le scénario complet du §1 — à partir du Lot 4

À reproduire réellement, avec 4 onglets ou 4 appareils. Non applicable au Lot 0, listé
ici pour être complété au fil des lots.

> Ouvrir le site sur téléphone → créer une partie → envoyer le code → 3 amis rejoignent
> depuis leur téléphone → l'hôte lance → chacun découvre **secrètement** son identité →
> chacun choisit ses icônes → tout le monde devine → résultats et points → manche
> suivante → après 5 manches, un gagnant est annoncé. Pendant toute la partie,
> **actualiser la page d'un joueur au hasard** : il revient exactement où il en était.

### Préparer quatre joueurs sur une seule machine

Le `sessionToken` est stocké par origine dans le `localStorage`. Quatre onglets d'une
même fenêtre le **partagent** : ils seraient vus comme un seul joueur.

Utilise donc quatre contextes séparés :

- une fenêtre normale
- une fenêtre de navigation privée
- un second navigateur (Firefox à côté de Chrome)
- un profil de navigateur distinct, ou un vrai téléphone

### Depuis de vrais téléphones du réseau local

1. Relève l'IP locale de la machine : `ipconfig getifaddr en0` (macOS) ou
   `hostname -I | awk '{print $1}'` (Linux).
⚠️ **Une IP locale en `http://` ne suffit pas.** WebRTC et `crypto.getRandomValues`
exigent un contexte sécurisé : `https://` ou `localhost`. Servir le site sur
`http://192.168.1.42:3000` donnera une page qui s'affiche mais ne crée aucune partie.

Deux façons de contourner, au choix :

**Un tunnel HTTPS** — le plus simple :

```bash
npm run dev
npx localtunnel --port 3000    # ou : ngrok http 3000
```

Ouvre l'URL `https://…` fournie sur chaque téléphone.

**Le site déployé** — le plus représentatif : pousse sur `main`, attends le workflow,
et joue sur `https://TON-PSEUDO.github.io/NOM-DU-DEPOT/`. C'est le seul moyen de tester
le service de mise en relation dans les conditions réelles.

Si un téléphone ne rejoint pas alors que les autres y arrivent, c'est un problème de NAT
et non de pare-feu : mets-le sur le même Wi-Fi que l'hôte. Si ça règle le cas, il faudra
un relais TURN pour les réseaux mixtes (voir la section *Réseau* du README).

### Points à surveiller pendant le scénario

À cocher au fur et à mesure que les lots avancent :

- [x] **Lot 1** — le code fonctionne, le lien `/game/XXXXX` amène directement au salon,
      la liste des joueurs se met à jour en temps réel chez tout le monde
- [x] **Lot 1** — l'hôte quitte : le rôle passe au joueur connecté le plus ancien
- [x] **Lot 2** — le décompte affiche la même valeur (± 1 s) sur les quatre appareils
- [x] **Lot 2** — aucun joueur ne voit l'identité d'un autre (à vérifier aussi dans
      l'onglet Réseau du navigateur, pas seulement à l'écran)
- [x] **Lot 4** — les scores affichés correspondent à `Faire deviner` + `Bonnes réponses`
- [x] **Lot 5** — actualiser la page d'un joueur au hasard, à chaque phase : il revient
      exactement où il en était, main et soumissions comprises

### Vérifier l'absence de fuite d'identité à la main

Le trafic de jeu passe par un canal WebRTC, que l'onglet **Réseau** n'affiche pas. On
l'inspecte donc autrement, en phase `CLUE_SELECTION`, chez le joueur B :

`chrome://webrtc-internals` liste les canaux ouverts et leur volume, ce qui confirme que
les messages vont bien de téléphone à téléphone. Pour lire le contenu, poser un point
d'arrêt dans `GuestNode.receive` (`apps/web/src/lib/net/guestNode.ts`) et examiner les
payloads reçus : aucun ne doit contenir l'identité de A, ni `labelMap`, ni un
`sessionToken` qui ne soit pas le sien.

C'est la garantie n° 1 du §6. Les tests `phases.test.ts` la vérifient automatiquement en
inspectant **tous** les payloads reçus, pas seulement ceux qu'on attendait.
