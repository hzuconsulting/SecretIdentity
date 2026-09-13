# TESTING.md

Deux choses ici : la suite automatisée, et le scénario manuel à plusieurs appareils.

---

## 1. Tests automatisés

```bash
npm test            # tout
npm run test:watch  # en surveillance pendant le développement
npm run typecheck   # tsc --noEmit sur shared, engine et client
```

### Couverture — 357 tests

**`scoring.test.ts`** — le calcul de score
- 3 joueurs : personne ne trouve · tout le monde trouve · votes partiels
- 2 joueurs : les deux totaux sont toujours égaux, plafond à 2 par manche
- 8 joueurs : plafond à N−1 dans chaque colonne
- un vote pour soi-même est ignoré
- un vote pour un joueur inconnu est ignoré
- **un vote sur un leurre ne rapporte rien** : le numéro existe, mais personne ne le porte
- un joueur absent de la manche n'écrit rien
- aucune mutation de l'objet d'entrée
- agrégation des statistiques de fin de partie
- `leadersOf` : départage aux cartes gardées, et victoire partagée quand les deux
  critères restent à égalité

**`game-logic.test.ts`** — les données et les tirages
- catalogue d'identités : ≥ 200, aucun id ni nom en double, 11 catégories,
  répartition des difficultés, assez d'identités par difficulté pour 8 joueurs
- packs : `getIdentityPool(['disney'])` filtre réellement
- catalogue d'icônes : ≥ 250, aucun id ni emoji en double, label et mots-clés partout
- `dealHand` : taille exacte, aucun doublon, quotas respectés sur **50 graines**,
  déterminisme à graine égale, divergence à graines différentes, échec franc sur
  catalogue trop petit
- `dealPictoCards` : 10 cartes à deux faces de deux pictogrammes, aucun pictogramme
  répété dans une main (40 distincts), identifiants préfixés par joueur, déterminisme,
  échec franc sur catalogue trop petit
- le catalogue suffit aux règles : assez de personnages pour 4 manches × 8 dans **chaque**
  difficulté, assez de pictogrammes pour huit mains complètes
- `drawIdentities` : identités distinctes, filtre de difficulté, non-réutilisation sur
  5 manches consécutives, réinitialisation contrôlée quand le pool est épuisé
- codes de partie : format, absence de `0/O/1/I` sur 2 000 tirages, 500 codes uniques
  d'affilée, normalisation de la saisie

**`contracts.test.ts`** — les schémas Zod et l'affichage
- pseudo nettoyé, vide refusé, trop long refusé
- code de partie normalisé (` k7p-4q ` → `K7P4Q`)
- **toutes** les options du salon acceptées, toute valeur hors options refusée
- boîtier vide refusé, zone inconnue refusée, plafond de la règle laissé au moteur
- votes bornés aux numéros du plateau (1 à 8, entiers)
- demande d'exclusion validée
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
  attendus) ; aucune vue ne contient `sessionToken`, `connectionId` ni `usedIdentityIds` ;
  un joueur public n'expose exactement que `id`, `nickname`, `score`, `cardsLeft`,
  `connected`, `isHost`
- *exclusion par l'hôte* : le joueur est retiré et prévenu personnellement, son retour est
  refusé par jeton **et** par pseudo (quelle que soit la casse), un nouveau venu entre
  normalement, `NOT_HOST` pour un invité, l'hôte ne peut pas s'exclure lui-même, le geste
  est idempotent, et la partie disparaît quand il ne reste plus personne
- *robustesse* : action sans session refusée proprement, double départ idempotent,
  payload malformé ignoré sans fermer la connexion

**`phases.test.ts`** — intégration, machine à états. Le nœud de test applique un
facteur `timeScale` de 0,01 à **toutes** les durées de phase : une phase réglée sur 60 s
y dure 600 ms. Les minuteurs restent de vrais `setTimeout`.

- *lancement* : refusé à l'hôte seul, **accepté dès 2 joueurs** (plateau de 8, 6 leurres),
  refusé pour un non-hôte, réglages verrouillés dès le départ, double lancement rejeté
- *attribution* : **plateau de 8 personnages** quel que soit le nombre de joueurs,
  personnages distincts pour 4 joueurs, main de 10 cartes par joueur, numéros attribués
  distincts et dans les bornes, aucun personnage réutilisé d'une manche à l'autre
- *transitions* : `IDENTITY_REVEAL → CLUE_SELECTION` automatique et annoncée dans cet
  ordre, échéance cohérente avec l'horloge de l'hôte, **échéance identique pour tous les
  joueurs**, pas d'échéance au salon, **la révélation n'a pas d'échéance** et attend
  l'hôte, `round:next` enchaîne directement sur la manche suivante, `round:next` refusé
  avant la fin de manche et pour un non-hôte, partie complète de **4 manches**
  jusqu'à `FINAL_RESULTS` avec classement et statistiques
- *confidentialité en manche* : le plateau est public — c'est la règle — mais un joueur ne
  reçoit **que son propre numéro**, et aucune vue ne porte `reveals` avant `RESULTS` ;
  `opponents` n'existe qu'en `GUESSING` et ne porte que `playerId`, `nickname` et
  `placed`, chaque pictogramme adverse se réduisant à `iconId` et `zone` ; chaque joueur
  reçoit sa propre main et **aucune carte d'un autre ne transite par son canal** ; la
  progression ne contient que des booléens
- *reconnexion en manche* : phase, personnage, main, numéro de manche et **échéance**
  restaurés à l'identique

**`clues.test.ts`** — intégration, remplissage et validation du boîtier.

- *distribution* : 10 cartes par joueur, quatre pictogrammes distincts par carte (deux
  par face), identifiants uniques, aucun pictogramme répété dans une main ; **n'importe
  lequel des quatre** peut être posé, recto comme verso
- *soumission valide* : boîtier enregistré et renvoyé au joueur ; mélange vert / rouge
  accepté ; progression visible chez les autres **sans que leurs pictogrammes fuitent**
  (vérifié sur tous les payloads reçus) ; un seul pictogramme accepté ; la phase se
  conclut dès que les trois joueurs ont validé, sans attendre le minuteur
- *la main s'épuise* : les cartes jouées sont défaussées et **jamais remplacées** ; une
  carte de la manche précédente est refusée à la suivante ; les autres joueurs voient le
  **nombre** de cartes restantes, jamais lesquelles
- *anti-triche* : carte absente de la main refusée, carte **d'un autre joueur** refusée,
  pictogramme qui n'est pas sur la carte annoncée refusé, dépassement de 3 refusé, boîtier
  vide refusé, carte posée deux fois refusée, zone inconnue refusée, et surtout : **une
  validation qui échoue n'écrit rien** — main comprise
- *idempotence* : deux soumissions identiques (ordre inversé) réussissent sans effet de
  bord ; changer d'avis après validation est refusé ; une soumission arrivée après la
  phase renvoie `TOO_LATE` avec « Trop tard ! »
- *validation automatique* : une carte de sa propre main est tirée au sort, pictogramme compris,
  pour qui n'a rien posé ; le boîtier de ceux qui avaient validé est conservé ; chaque
  joueur se retrouve avec N−1 boîtiers **non vides** et les 8 numéros
- *exclusion en cours de manche* : exclure le dernier joueur attendu conclut la phase ; en
  pleine phase de vote, la manche se termine et le boîtier de l'exclu est révélé sous
  « Joueur parti »
- *déconnexion en pleine sélection* : le départ du dernier joueur attendu conclut la
  phase au lieu de la bloquer ; un boîtier déjà validé est restauré à la reconnexion

**`guesses.test.ts`** — intégration, vote, scores et rejouer. Les tests lisent les numéros
directement dans le store pour composer des votes justes ou faux ; les **clients**, eux,
ne les reçoivent jamais.

- *matériel* : adversaires nommés, soi-même exclu ; **8 numéros proposés à 3 joueurs**,
  dont 5 leurres ; aucun champ n'associe un adversaire à un numéro
- *validation* : vote complet accepté, vote partiel accepté, **leurre accepté** (valide,
  simplement faux), deux fois le même numéro refusé, **voter pour soi refusé**, joueur
  inconnu refusé, numéro hors plateau refusé, et un échec n'écrit rien
- *idempotence* : deux soumissions identiques réussissent, un changement d'avis est refusé
- *scores* : maximum quand tout le monde trouve tout (+2 / +2 à trois joueurs) ; **un vote
  sur un leurre ne rapporte rien** ; zéro partout quand personne ne vote ; **cas mixte** —
  Sarah vote juste, Allan inverse ses deux votes, Malo ne vote pas, et chaque colonne est
  vérifiée séparément ; cumul sur les 4 manches jusqu'aux statistiques finales ;
  **départage aux cartes restantes** vérifié sur un classement réel ; **dépouillement
  des votes** — pour chaque joueur révélé, ce que chacun a voté, juste, faux sur un
  leurre, ou laissé vide, dans l'ordre du salon
- *rejouer* : scores remis à zéro, mains redistribuées, retour au salon,
  `usedIdentityIds` **conservé**, refusé hors fin de partie et pour un non-hôte

**`robustness.test.ts`** — cas limites du §9.

- *mise en pause* : une partie à 2 gèle dès qu'un joueur décroche, les actions de jeu sont
  refusées avec `GAME_PAUSED`, **la phase n'avance plus** (vérifié en attendant plus
  longtemps que la durée de phase), la reprise repart avec une échéance neuve, les
  soumissions déjà faites sont conservées, et **les points ne sont pas comptés deux fois**
- *joueur parti en cours de manche* : la manche se termine et son boîtier est révélé
  sous son vrai pseudo, marqué absent ; il n'est pas servi dans la manche suivante
- *revenir dans une partie en cours* : quitter garde la place ; retaper **le même
  pseudo** (casse indifférente) la rend, points et main intacts, avec un jeton neuf —
  l'ancien n'ouvre plus rien ; un absent n'est plus servi, puis l'est de nouveau dès son
  retour ; la fin de la période de grâce ne retire plus personne en partie ; le pseudo
  d'un joueur **connecté** ne permet jamais de le déloger ; un inconnu apprend comment
  revenir
- *limitation de débit* : fenêtre glissante testée unitairement ; en intégration, une
  rafale reçoit `RATE_LIMITED` sans que le canal soit fermé
- *purge* : une partie inactive au-delà du TTL est supprimée, une partie active est
  épargnée, et le jeton de session d'une partie purgée est oublié
- *robustesse générale* : partie supprimée quand tout le monde s'est déconnecté
  définitivement, aucune échéance orpheline derrière une partie supprimée, survie à une
  rafale de payloads malformés (`null`, texte, nombre, tableau), et toutes les actions de
  jeu sans session renvoient `SESSION_NOT_FOUND`

---

## 1 bis. Vraie partie automatisée

```bash
npm run dev          # dans un terminal
npm run test:e2e     # dans un autre
```

Deux contextes de navigateur séparés, une partie créée, un code, une jointure, et la
vérification que chacun voit l'autre **sans rechargement**. Le script affiche pour finir
la négociation ICE des deux côtés.

C'est le seul test qui exerce réellement WebRTC. Les 357 tests de la section 1 parlent au
moteur par un canal en mémoire : ils ne peuvent rien dire du transport, et c'est le
transport qui a produit chaque panne de production jusqu'ici. **Le lancer avant tout
déploiement touchant `apps/web/src/lib/net/`.**

`HEADED=1 npm run test:e2e` ouvre les fenêtres, pour regarder ce qui se passe.

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
| Bouton `LANCER LA PARTIE` | Visible chez l'hôte seulement ; désactivé tant que l'hôte est seul (« Encore 1 joueur… »), actif dès que B est entré |

### 2.6 Une manche complète

Trois contextes ouverts, réglages laissés par défaut (5 manches, 60 s / 60 s).

| Étape | Attendu |
|---|---|
| L'hôte clique sur `LANCER LA PARTIE` | Les trois écrans basculent ensemble sur « Ta carte Mystère » |
| Comparer les trois écrans | **Le même plateau de 8 personnages** partout ; **trois numéros différents**, chacun ne voit que le sien |
| `👁 MASQUER MA CARTE` | Numéro et nom deviennent « CARTE MASQUÉE » ; `Maintenir pour voir` ne les affiche que pendant l'appui |
| Passer l'onglet en arrière-plan pendant l'appui | La carte se recache immédiatement |
| Après 8 s | Bascule automatique sur « Ton boîtier », main de **10 cartes, chacune avec un recto et un verso de deux pictogrammes** |
| Taper un pictogramme | Il passe dans « Ce que tu poses », en vert ; compteur « 1 / 3 » ; les trois autres de sa carte s'estompent |
| Basculer sur `✗ Ce n’est pas représentatif`, taper une autre carte | Le second pictogramme est posé en rouge |
| Taper un autre pictogramme d'une carte déjà posée | Le pictogramme posé change, sa zone ne change pas |
| Taper une quatrième carte | Rien ne se passe, les cartes non posées sont grisées |
| `VALIDER MON BOÎTIER` | Demande « Confirmer ce boîtier ? » avec le nombre de cartes qui partent à la défausse |
| `CONFIRMER` | Écran vert « Boîtier validé ! », liste de progression `Allan ⏳ / Malo ⏳` |
| Les trois joueurs valident | La phase suivante démarre **immédiatement**, sans attendre le décompte |
| Refaire une manche sans rien poser chez un joueur | À la fin du décompte, une carte de sa main apparaît quand même dans son boîtier |
| Comparer les décomptes | **Même valeur à ± 1 s** sur les trois appareils |
| Sous 10 s | Le décompte passe au rose, l'icône change de ⏱️ à ⏳, il pulse |
| À `00:00` | Le décompte reste à zéro, puis la bascule arrive — c'est le moteur qui décide, pas l'écran |
| Phase « Qui est qui ? » | Un bloc **par adversaire nommé**, avec son boîtier vert / rouge ; la sienne absente ; un sélecteur de numéro 1→8 |
| Choisir le même numéro pour deux joueurs | Les deux votes **s'échangent**, aucun message d'erreur |
| Laisser une case vide | `VALIDER MES VOTES` reste désactivé, la légende indique `1 / 2` |
| Tout remplir puis valider | Écran vert « Votes envoyés ! » avec le récapitulatif |
| Ne rien remplir et laisser filer le décompte | Les votes partent vides, ils comptent comme faux |
| Phase « Révélation » | Les boîtiers se dévoilent **un par un**, à 1,5 s d'intervalle ; `TOUT RÉVÉLER` les montre d'un coup |
| Sur chaque carte | Numéro et personnage, joueur, pictogrammes vert / rouge, **ce que chacun a voté pour lui** (✓ / ✗, « sans réponse », « (leurre) »), et un badge ✓ Trouvé / ✗ Raté selon ton propre vote |
| Après la dernière carte | Le détail des points apparaît, avec le total cumulé ; `MANCHE SUIVANTE` chez l'hôte seulement |
| Attendre une minute sans rien cliquer | **Rien ne bouge** : pas de minuteur après une manche, c'est l'hôte qui enchaîne |
| L'hôte appuie sur `MANCHE SUIVANTE` | Tout le monde passe directement à la carte Mystère de la manche 2, main réduite des cartes jouées |
| Dernière manche révélée | Le bouton devient `VOIR LE CLASSEMENT FINAL` |
| Après la dernière manche | Écran de fin, 🏆, classement avec cartes gardées, trois statistiques |
| `REJOUER` (hôte) | Retour au salon, tous les scores à zéro, mêmes joueurs et mêmes réglages |
| Relancer après REJOUER | Mains neuves de 10 cartes ; les personnages de la partie précédente ne réapparaissent pas |
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

### Vérifier l'absence de fuite de numéro à la main

Le trafic de jeu passe par un canal WebRTC, que l'onglet **Réseau** n'affiche pas. On
l'inspecte donc autrement, en phase `CLUE_SELECTION`, chez le joueur B :

`chrome://webrtc-internals` liste les canaux ouverts et leur volume, ce qui confirme que
les messages vont bien de téléphone à téléphone. Pour lire le contenu, poser un point
d'arrêt dans `GuestNode.receive` (`apps/web/src/lib/net/guestNode.ts`) et examiner les
payloads reçus : le plateau des huit personnages est légitime — il est public — mais
aucun ne doit contenir le **numéro** de A, une de ses cartes, ni un `sessionToken` qui
ne soit pas le sien.

C'est la garantie n° 1 du §6. Les tests `phases.test.ts` la vérifient automatiquement en
inspectant **tous** les payloads reçus, pas seulement ceux qu'on attendait.
