# DECISIONS.md

Arbitrages pris en cours de route, avec la raison et — quand il y en a un — le coût.
Une entrée par décision, la plus récente en bas de section.

---

## Lot 0 — Fondations

### D-01 · `packages/shared` consommé en TypeScript source

**Décision.** Le package partagé n'a pas d'étape de build. Son `main` et ses `exports`
pointent directement sur les `.ts` de `src/`. Next le compile via `transpilePackages`,
le serveur via `tsx`, les tests via Vitest.

**Pourquoi.** Un `packages/shared/dist` impose de reconstruire à chaque modification, ou
de faire tourner un `tsc --watch` de plus. Sur un projet à trois espaces de travail, le
gain est nul et l'oubli de rebuild est une source de bugs fantômes (« le serveur a
l'ancienne constante »).

**Coût.** Le package n'est pas publiable en l'état sur npm. Hors périmètre v1.

---

### D-02 · Le serveur tourne via `tsx`, y compris en production

**Décision.** Pas d'étape de compilation vers `dist/`. `npm start` lance
`tsx src/index.ts`. `tsx` est en `dependencies`, pas en `devDependencies`.

**Pourquoi.** Conséquence directe de D-01 : `tsc` refuse d'émettre proprement du code qui
importe des fichiers hors de son `rootDir`. Les contournements (`composite` +
`references`, ou un bundler) ajoutent de la configuration pour un serveur qui fait
quelques centaines de lignes.

**Coût.** Démarrage à froid légèrement plus lent (transpilation esbuild au boot,
de l'ordre de quelques centaines de ms) et `tsx` embarqué en production. Acceptable pour
un process persistant qui démarre une fois. `npm run build` reste un vrai garde-fou : il
exécute `tsc --noEmit` et échoue si les types cassent.

**À revoir si.** On veut une image Docker minimale ou un démarrage instantané → passer à
un bundle esbuild (`esbuild src/index.ts --bundle --platform=node`) au Lot 5.

**Caduque depuis le Lot 7 (D-50).** Il n'y a plus de processus serveur : le moteur est
transpilé par Next avec le reste du site.

---

### D-03 · Pile de polices système plutôt qu'une police distante

**Décision.** `--font-display` et `--font-body` sont une pile arrondie
(`ui-rounded`, `SF Pro Rounded`, `Segoe UI Rounded`, `Nunito`, `system-ui`).
Pas de `next/font/google`.

**Pourquoi.** `next/font/google` télécharge la police au moment du `next build` : le
build devient dépendant du réseau, et échoue dans un environnement isolé. La pile
arrondie donne le bon registre « jeu de société » sur iOS et Windows sans un octet
chargé, et le rendu est immédiat (aucun FOUT).

**Coût.** C'est le point le plus faible de la direction artistique. Le rendu diffère
entre plateformes, et Linux/Android tombent sur `system-ui`, moins caractérisé.

**À revoir au Lot 6.** Une display face auto-hébergée (fichiers `.woff2` dans
`public/fonts`, chargée via `next/font/local`) garde le build hors-ligne tout en donnant
une vraie personnalité typographique.

---

### D-04 · Vitest configuré à la racine, pas par espace de travail

**Décision.** Un seul `vitest.config.ts` racine, avec un `include` qui couvre
`packages/**`.

**Pourquoi.** `npm test` doit tout lancer d'un coup, et les tests d'intégration du Lot 5
mêleront de toute façon le moteur et le package partagé. Une configuration par espace
de travail multiplierait les fichiers sans bénéfice.

*(Le glob couvrait aussi `apps/server/**` jusqu'au Lot 7, où le moteur est devenu
`packages/engine` — voir D-50.)*

---

### D-05 · `noUncheckedIndexedAccess` activé

**Décision.** Option activée dans `tsconfig.base.json`, en plus de `strict`.

**Pourquoi.** Beaucoup de code du jeu indexe des tableaux et des `Record` par des clés
calculées (`labelMap[label]`, `guesses[playerId]`). Sans cette option, TypeScript promet
une valeur là où il peut y avoir `undefined` — exactement le genre de trou qui produit un
`NaN` dans un score. L'option force à traiter le cas absent.

**Coût.** Quelques assertions `as T` dans `rng.ts`, où l'index est borné par construction
mais où TypeScript ne peut pas le savoir. Elles sont commentées.

---

### D-06 · Répartition des difficultés : 47 / 39 / 14

**Décision.** Le cahier des charges vise ~45 % `easy`, ~40 % `medium`, ~15 % `hard`. Le
catalogue livré est à 47 / 39 / 14 sur 293 identités.

**Pourquoi.** L'écart vient d'un classement au cas par cas plutôt que d'un remplissage de
quota. Le test associé vérifie des bornes larges plutôt que des pourcentages exacts : une
identité ajoutée ne doit pas casser la suite de tests.

**Note.** `hard` compte 41 identités, soit assez pour cinq manches à 8 joueurs sans
réutilisation. C'est le seuil qui compte réellement en jeu, et il est tenu.

---

### D-07 · Catalogues plus larges que les minimums

**Décision.** 293 identités (minimum demandé : 200) et 349 icônes (minimum : 250).

**Pourquoi.** Ces deux nombres pilotent directement la rejouabilité. Sur les icônes, la
marge sert aussi les quotas de `dealHand` : plus le catalogue est large par catégorie,
moins deux mains se ressemblent.

---

### D-08 · Les boutons « Créer » et « Rejoindre » sont désactivés au Lot 0

**Décision.** L'écran d'accueil affiche les trois boutons prévus au §7.1, mais les deux
premiers sont désactivés, avec un encart qui explique pourquoi en français, à l'écran.

**Pourquoi.** Les gestionnaires `game:create` et `game:join` appartiennent au Lot 1. Les
alternatives étaient pires : un lien vers une route inexistante (404), ou un formulaire
complet dont la soumission expire sans réponse — ce qui ressemble à un bug plutôt qu'à un
lot en cours.

**À supprimer au Lot 1.** L'encart et l'attribut `disabled` disparaissent en même temps
que les gestionnaires arrivent.

---

### D-09 · L'indicateur de connexion est une vraie fonctionnalité, pas un décor

**Décision.** `ServerStatus` mesure réellement le décalage d'horloge via `time:ping` et
affiche trois états distincts, dont un message d'erreur qui dit quoi faire.

**Pourquoi.** C'est le test d'acceptation du Lot 0 rendu visible : il prouve que la
liaison temps réel fonctionne et que la synchronisation d'horloge du §4.2 est en place.
En développement, il distingue « le serveur ne tourne pas » de « CORS refuse mon
origine », les deux pannes les plus fréquentes.

---

### D-10 · `GameStore` asynchrone dès maintenant

**Décision.** Toutes les méthodes de `GameStore` renvoient des promesses, alors que
`InMemoryStore` est purement synchrone. `save()` est un quasi no-op mais reste appelé
partout.

**Pourquoi.** Une implémentation Redis ne pourra pas être synchrone. Rendre l'interface
asynchrone maintenant coûte quelques `await` ; la rendre asynchrone plus tard obligerait
à rouvrir chaque gestionnaire d'événement.

---

### D-11 · `CLIENT_ORIGIN` accepte plusieurs origines

**Décision.** La variable est découpée sur les virgules et passée telle quelle à la
configuration CORS de Socket.IO.

**Pourquoi.** En pratique on a besoin d'au moins deux origines : le domaine de production
et les URL de prévisualisation Vercel. Une seule valeur obligerait à redéployer le
serveur pour tester une branche.

**Caduque depuis le Lot 7 (D-50).** Sans serveur, il n'y a plus d'origine à autoriser :
les canaux WebRTC ne sont pas soumis au CORS.

---

### D-12 · Le RNG est injecté partout

**Décision.** `dealHand`, `drawIdentities`, `generateGameCode` et les mélanges prennent
un `Rng` en paramètre. `seededRng` (mulberry32) sert dans les tests.

**Pourquoi.** C'est ce qui rend le déterminisme testable sans mocker `Math.random`
globalement. Les tests de quotas tournent sur 50 graines différentes : sans RNG
injectable, ils seraient soit instables, soit inutiles.

---

## Lot 1 — Salon multijoueur

### D-13 · Une vue par joueur, jamais de broadcast d'état

**Décision.** `socket/emit.ts` n'expose aucune fonction qui envoie le même objet à
plusieurs sockets. `broadcastState` boucle sur les joueurs et appelle
`buildPlayerView` pour chacun.

**Pourquoi.** C'est la garantie n° 1 du §6, et elle doit être structurelle, pas
disciplinaire. Un `io.to(code).emit('state', game)` serait plus court, marcherait
parfaitement au Lot 1 où rien n'est secret, et deviendrait une fuite d'identité au
Lot 3 — au moment précis où plus personne ne relit ce fichier.

**Coût.** N sérialisations par changement d'état au lieu d'une. À 8 joueurs et quelques
événements par manche, c'est négligeable.

---

### D-14 · `playerView.ts` construit par liste blanche, jamais par filtrage

**Décision.** La vue est un objet neuf, écrit champ par champ. On ne part jamais d'un
`{ ...game }` auquel on retire des clés.

**Pourquoi.** Le filtrage échoue en silence dès qu'on ajoute un champ à `Game`. La liste
blanche échoue en revanche du bon côté : un champ oublié est un champ absent, pas un
champ divulgué. Un test vérifie qu'aucune vue ne contient les chaînes `sessionToken`,
`labelMap`, `socketId` ni `usedIdentityIds`.

---

### D-15 · Sessions indexées par code de partie dans le `localStorage`

**Décision.** `lib/session.ts` stocke une carte `code → session` sous une clé unique,
plutôt qu'une session globale.

**Pourquoi.** Ouvrir une deuxième partie depuis le même navigateur écraserait sinon la
première : actualiser l'onglet initial ferait revenir le joueur dans la mauvaise partie.

**Limite connue.** Deux onglets d'une même fenêtre partagent ce stockage et sont donc vus
comme un seul joueur. C'est inhérent au `localStorage`, pas contournable proprement, et
c'est documenté dans `TESTING.md`.

---

### D-16 · Aucune mise à jour optimiste côté client

**Décision.** `useGameConnection` ne calcule rien : il stocke la dernière `PlayerView`
reçue. Cliquer sur un réglage envoie l'événement et attend la rediffusion.

**Pourquoi.** Un salon qui affiche brièvement un état que le serveur n'a pas validé est
pire qu'un salon qui met 80 ms à répondre — surtout quand six téléphones doivent montrer
la même chose. Le bouton concerné est désactivé pendant l'aller-retour, ce qui rend
l'attente lisible plutôt que suspecte.

---

### D-17 · Deux délais distincts sur une déconnexion

**Décision.** Un joueur déconnecté est retiré après `DISCONNECT_GRACE_MS` (60 s). S'il
était hôte, le rôle est transféré après `HOST_TRANSFER_DELAY_MS` (30 s) — donc **avant**
son retrait. Un départ volontaire transfère immédiatement.

**Pourquoi.** Les deux échéances répondent à des questions différentes. « Qui décide ? »
ne peut pas rester sans réponse pendant une minute, alors que « qui joue ? » doit
tolérer un tunnel de métro. Un retour avant l'échéance annule les deux.

---

### D-18 · Délais injectés dans `createGameServer`

**Décision.** `disconnectGraceMs` et `hostTransferDelayMs` sont des options du serveur.
Les tests passent 120 ms et 80 ms.

**Pourquoi.** L'alternative était de simuler les minuteurs. Or ce qu'on veut vérifier,
c'est précisément que le vrai `setTimeout` se déclenche, qu'il est annulé au retour du
joueur, et que l'ordre des deux échéances est le bon. Avec des minuteurs simulés, ces
tests ne prouveraient rien.

---

### D-19 · Un registre de minuteurs plutôt que des `setTimeout` dispersés

**Décision.** `TimerRegistry`, clés préfixées par le code de partie.

**Pourquoi.** Un `setTimeout` orphelin garde une référence sur l'objet `Game` : la partie
est purgée du store mais reste en mémoire. Le registre permet de tout annuler par préfixe
quand une partie disparaît, ce que fait la boucle de purge. Les échéances de phase du
Lot 2 réutiliseront le même mécanisme.

---

### D-20 · Le bouton « Lancer la partie » reste désactivé

**Décision.** Comme au Lot 0 pour les boutons de l'accueil, avec une légende explicite.
Sous 3 joueurs, la légende indique le nombre manquant ; au-delà, elle annonce le Lot 2.

**Pourquoi.** `game:start` déclenche `IDENTITY_REVEAL`, donc la machine à états et les
minuteurs de phase — c'est le Lot 2. Implémenter une moitié de transition maintenant
laisserait le jeu dans un état dont il ne pourrait pas sortir.

**À remplacer au Lot 2.** La légende disparaît en même temps que le bouton s'active.

---

## Lot 2 — Machine à états et minuteurs

### D-21 · Le Lot 2 construit déjà les manches (identités, mains, étiquettes)

**Décision.** `game/round.ts` tire les identités, distribue les mains et pose la
permutation `label → playerId` dès maintenant, alors que le §11 range ces trois points
au Lot 3.

**Pourquoi.** Une phase `CLUE_SELECTION` sans main et une phase `GUESSING` sans séries ne
sont pas des phases : on ne pourrait ni écrire `playerView.ts` — qui est explicitement du
Lot 2 — ni tester la moindre garantie de confidentialité. Le découpage retenu est donc :
le Lot 2 **construit et sert** le matériel de la manche, le Lot 3 ajoute la **sélection**
et sa validation.

**Coût.** Le Lot 3 est allégé d'autant. Ce qui lui reste : `clues:submit`, la validation
serveur, l'écran d'attente, la validation automatique en fin de minuteur, et l'interface
de sélection.

---

### D-22 · `timeScale`, un facteur d'échelle sur toutes les durées de phase

**Décision.** `GameEngine` multiplie chaque durée par `timeScale`, qui vaut 1 en
production et 0,01 dans les tests. Une phase réglée sur 60 s y dure 600 ms.

**Pourquoi.** Les durées de phase viennent des réglages de jeu, qui ne descendent pas
sous 30 s : sans ce facteur, un test de partie complète prendrait plus de dix minutes.
L'alternative — simuler les minuteurs — aurait vidé les tests de leur intérêt, puisque ce
qu'on veut prouver est justement que les vrais `setTimeout` s'enchaînent dans le bon
ordre. Même raisonnement que D-18 pour les périodes de grâce.

**Garde-fou.** Le facteur n'est pas lisible depuis un événement client : il n'existe que
dans les options de `createGameServer`.

---

### D-23 · Une transition en retard ne fait rien

**Décision.** `advance(game, expectedPhase)` compare la phase attendue à la phase
courante et abandonne si elles diffèrent. Tous les minuteurs passent par là.

**Pourquoi.** Deux déclencheurs coexistent — l'échéance et la complétude (§4.1) — et le
minuteur n'est pas annulable instantanément. Sans cette vérification, une phase conclue
par « tout le monde a soumis » verrait son minuteur se réveiller une fraction de seconde
plus tard et sauter la phase suivante. Le même garde-fou protège `round:next` contre le
minuteur des vingt secondes du classement.

---

### D-24 · On mélange les joueurs, pas les étiquettes

**Décision.** `buildLabelMap` mélange la liste des joueurs et leur attribue `A`, `B`,
`C`… dans l'ordre.

**Pourquoi.** Mélanger les étiquettes reviendrait à laisser l'ordre d'affichage — qui est
toujours alphabétique — corrélé à l'ordre d'arrivée dans le salon. En mélangeant les
joueurs, `A` reste la première série affichée et c'est bien la personne derrière qui
change à chaque manche.

**Corollaire.** Les listes envoyées en phase `GUESSING` sont **triées** : étiquettes par
ordre alphabétique, identités par identifiant. L'ordre ne doit rien apprendre.

---

### D-25 · Un joueur déconnecté ne bloque jamais une phase

**Décision.** `isPhaseComplete` n'examine que les joueurs connectés. Et une déconnexion
déclenche immédiatement `advanceIfComplete` : si le seul joueur qu'on attendait vient de
partir, la phase se conclut sans attendre son minuteur.

**Pourquoi.** Sinon une coupure réseau chez un joueur imposerait aux cinq autres
d'attendre les soixante secondes complètes, à chaque phase. Le cas inverse est protégé :
si plus personne n'est connecté, `isPhaseComplete` renvoie `false` et c'est le minuteur
qui tranche — on n'enchaîne pas trois manches dans le vide.

---

### D-26 · Le client n'a aucune machine à états

**Décision.** `GameClient.tsx` est un `switch` sur `view.phase`. Aucun état de phase
local, aucun `setInterval` qui déciderait d'une transition.

**Pourquoi.** C'est l'interdit explicite du §2, et c'est ce qui fait qu'actualiser la page
ramène exactement au bon écran : il n'y a rien à reconstruire, la vue suivante suffit.
Le composant `Timer` affiche `00:00` puis attend — il ne déclenche rien.

---

### D-27 · Le masquage d'identité écoute aussi `visibilitychange`

**Décision.** `IdentityCard` arrête de montrer l'identité au relâchement, à la sortie du
pointeur, à la perte de focus **et** quand l'onglet passe en arrière-plan.

**Pourquoi.** Les trois premiers cas sont ceux du §7.2. Le quatrième s'y ajoute pour une
raison pratique : sans lui, le nom resterait affiché dans l'aperçu multitâche du
téléphone, c'est-à-dire exactement là où un voisin le lirait.

---

## Lot 3 — Sélection des indices

### D-28 · Le client valide tout seul une seconde avant l'échéance

**Décision.** `ClueSelectionScreen` envoie la sélection en cours quand le décompte
atteint 1 seconde. Le serveur, de son côté, valide d'office tout joueur encore en attente
quand son minuteur expire.

**Pourquoi.** Le §7.3 demande que la sélection courante soit validée à zéro. Or la
sélection vit dans l'état React tant qu'elle n'est pas envoyée : le serveur ne la connaît
pas. Valider exactement à `00:00` ferait courir la requête contre l'échéance serveur, et
elle arriverait souvent après — donc rejetée en `TOO_LATE`, et le travail du joueur serait
perdu. Une seconde de marge suffit largement à un aller-retour.

**Ce n'est pas le client qui décide.** Il envoie une action à la place du joueur ; le
serveur reste seul maître de la fin de phase. Si la requête se perd, ou si le joueur est
déconnecté, le filet de sécurité serveur prend le relais.

**Alternative écartée.** Envoyer la sélection à chaque appui, pour que le serveur la
connaisse en permanence. Cela aurait multiplié le trafic par le nombre d'appuis et ajouté
un événement absent du contrat du §4.3.

---

### D-29 · Une série vide est remplacée par une icône tirée au sort

**Décision.** `autoSubmitClues` donne une icône aléatoire de sa main à tout joueur qui
n'a rien sélectionné.

**Pourquoi.** C'est la règle du §7.3, et elle a une bonne raison d'être : une série vide
priverait les autres joueurs d'une réponse à trouver et abaisserait leur score maximum
possible. L'icône tirée sera probablement fausse — c'est le prix de l'inattention — mais
la manche reste jouable pour tout le monde.

---

### D-30 · Changer d'avis après validation est refusé, rejouer la même est accepté

**Décision.** Une seconde soumission **identique** (même ensemble, ordre indifférent)
renvoie un succès sans rien réécrire. Une soumission **différente** après validation est
refusée avec « Tes indices sont déjà validés ».

**Pourquoi.** L'idempotence du §4.3 protège contre un double clic ou une requête rejouée
après une coupure réseau : dans les deux cas le payload est identique. Un payload
différent n'est pas un doublon, c'est un changement d'avis — et la confirmation affichée
avant validation prévient explicitement que c'est définitif.

---

### D-31 · Dépasser le maximum d'indices n'affiche pas d'erreur

**Décision.** Appuyer sur une quatrième icône quand le maximum est de trois ne fait rien,
sans message. Les icônes non sélectionnables passent à 40 % d'opacité et le compteur
affiche `3 / 3`.

**Pourquoi.** Un bandeau d'erreur pour un appui de trop serait plus agaçant qu'utile :
l'information « c'est plein » est déjà à l'écran, en permanence, à deux endroits. On
réserve les messages d'erreur à ce qui a vraiment échoué.

---

### D-32 · La validation métier est une fonction pure, séparée du gestionnaire

**Décision.** `game/clues.ts` expose `validateClueSelection(iconIds, hand, settings)`, qui
ne connaît ni la partie ni la socket.

**Pourquoi.** C'est le cœur de l'anti-triche : appartenance à la main, absence de
doublon, respect du maximum. En le sortant du gestionnaire, on peut le lire d'un coup
d'œil et le tester sans monter un serveur. Le gestionnaire ne fait plus que l'enchaînement
phase → validation → écriture → diffusion.

---

## Lot 4 — Devinette et scores

### D-33 · Le serveur accepte des réponses partielles, l'interface non

**Décision.** `guesses:submit` valide un appariement incomplet. Le bouton
`VALIDER MES RÉPONSES`, lui, ne s'active que lorsque toutes les cases sont remplies.

**Pourquoi.** Les deux règles du §3.1 semblent se contredire — « la validation n'est
possible que si toutes les cases sont remplies » et « à l'expiration du timer, les cases
vides sont laissées vides ». Elles ne parlent simplement pas du même moment : la première
est une règle d'interface pour la validation **manuelle**, la seconde décrit ce qui
arrive au **minuteur**. Le client envoie alors ce qu'il a, et le serveur doit l'accepter,
sinon le travail partiel du joueur serait perdu.

---

### D-34 · Choisir une identité déjà prise échange les deux affectations

**Décision.** Pas de message d'erreur, pas de « désélectionne d'abord » : sélectionner
une identité affectée ailleurs permute les deux séries.

**Pourquoi.** C'est ce que demande le §3.1, et c'est aussi le geste qu'on voudrait faire
de toute façon. Refuser aurait imposé une manipulation en deux temps qui n'apprend rien
au joueur et l'oblige à travailler autour de la contrainte de bijection au lieu de
raisonner sur ses réponses.

---

### D-35 · Le sélecteur d'identité est un `<select>` natif

**Décision.** Pas de liste déroulante maison.

**Pourquoi.** Sur téléphone, `<select>` ouvre la roue système : plus rapide à
manipuler d'une main, lisible sans zoom, et accessible au clavier comme au lecteur
d'écran sans une ligne de code. Une liste maison aurait demandé de réimplémenter la
gestion du focus, l'échappement, le défilement et les annonces — pour un résultat moins
bon.

---

### D-36 · Le sous-ensemble autorisé est recalculé côté serveur

**Décision.** `guesses:submit` reconstruit lui-même la liste des étiquettes et des
identités autorisées à partir de l'état de la manche, sans jamais faire confiance à ce
que le client renvoie.

**Pourquoi.** C'est ce qui rend impossible, quel que soit le client utilisé, de deviner
sa propre série ou de proposer sa propre identité — deux tricheries qui rapporteraient
des points gratuits. Trois tests couvrent explicitement ces tentatives.

---

### D-37 · Rejouer conserve `usedIdentityIds`

**Décision.** `game:replay` remet les scores à zéro, vide les manches et revient au
salon, mais **garde** la mémoire des identités déjà tirées.

**Pourquoi.** C'est la demande du §9, et la raison est concrète : sans cela, la partie
suivante redistribuerait très souvent les personnages qu'on vient de jouer, ce qui est
exactement ce qu'on ne veut pas juste après une partie. La réinitialisation contrôlée du
pool prend le relais quand il finit par s'épuiser.

---

### D-38 · Les tests vérifient que les réglages ont bien été acceptés

**Décision.** `playingGame` assert sur l'acquittement de `settings:update`, et son
paramètre `rounds` est typé `3 | 5 | 8 | 10`.

**Pourquoi.** Un bug de test, trouvé en écrivant ce lot : je réglais `rounds: 1`, valeur
absente des options du salon. Zod rejetait **tout** le payload — donc aussi les minuteurs
qui l'accompagnaient — et les tests tournaient silencieusement sur une partie de 5 manches
aux réglages par défaut. Deux d'entre eux passaient par chance. L'assertion transforme ce
genre d'erreur en échec immédiat.

---

## Lot 5 — Robustesse

### D-39 · La pause gèle le minuteur de phase, elle ne le laisse pas courir

**Décision.** Sous 3 joueurs connectés, `pauseIfNeeded` annule l'échéance de phase et
pose `pausedAt`. Les actions de jeu sont refusées avec `GAME_PAUSED`.

**Pourquoi.** Laisser les minuteurs tourner pendant que deux personnes attendent un
troisième reviendrait à faire défiler les manches dans le vide : au retour du joueur, la
partie serait finie et tous les scores à zéro. Le §9 demande une pause, et une pause
n'est utile que si le temps s'arrête vraiment.

---

### D-40 · La reprise repart avec une échéance neuve, sans rejouer les effets de sortie

**Décision.** `resumeIfPossible` rentre à nouveau dans la phase courante, avec une durée
complète, et passe `applyExitEffects: false`.

**Pourquoi.** Deux choses distinctes. D'abord l'échéance : reprendre sur le temps restant
d'avant la pause ferait arriver les joueurs sur un décompte déjà à zéro — on leur rend
donc la phase entière, les soumissions déjà faites étant conservées. Ensuite les effets :
`enterPhase('RESULTS')` calcule les scores. Sans le drapeau, une pause survenue en phase
de devinette ferait compter les points **deux fois** à la reprise. Un test vérifie
précisément ce cas.

---

### D-41 · Une partie en pause finit par rendre la main

**Décision.** Au bout de `PAUSE_ABANDON_MS` (2 min) sans retour, la partie revient au
salon : scores remis à zéro, manches effacées, joueurs conservés.

**Pourquoi.** Le §9 dit « reprise si quelqu'un revient, sinon retour au salon », sans
fixer de délai. Deux minutes couvrent un changement de wagon sans laisser trois personnes
devant un écran figé. Revenir au salon plutôt que supprimer la partie garde le code
valide : ceux qui sont là peuvent relancer.

---

### D-42 · La série d'un joueur parti est révélée sous un nom générique

**Décision.** `buildReveals` n'exige plus que le joueur soit encore dans la partie. S'il
est parti, sa série apparaît quand même, attribuée à « Joueur parti ».

**Pourquoi.** Le §9 demande que la manche se termine normalement. Faire disparaître sa
série de la révélation laisserait les autres sans explication sur ce qu'ils ont essayé de
deviner — et fausserait leur lecture des scores, puisqu'ils ont bel et bien pu marquer
des points dessus.

---

### D-43 · La limitation de débit protège le processus, pas les règles

**Décision.** 60 événements par fenêtre de 10 s et par socket, réponse `RATE_LIMITED`,
socket **maintenue ouverte**.

**Pourquoi.** Aucune règle de jeu ne dépend de la vitesse d'envoi : tout est validé et
idempotent, donc une boucle ne peut pas fausser une partie. Ce qu'elle peut faire, c'est
saturer un processus unique qui garde tout en mémoire. Le plafond est donc volontairement
haut — un joueur qui tapote ses icônes ne l'atteint jamais — et fermer la connexion serait
disproportionné : un bug client déconnecterait un joueur au lieu de le ralentir.

---

### D-44 · Un test du Lot 3 est devenu faux, et c'était le bon signe

**Décision.** Le test « ne bloque pas la phase quand le dernier joueur attendu se
déconnecte » a été repris pour démarrer à **quatre** joueurs.

**Pourquoi.** Écrit au Lot 3, il partait de trois joueurs et en déconnectait un : la
phase avançait. Avec la pause, elle se gèle — ce qui est le comportement correct du §9.
Plutôt que d'assouplir la pause, j'ai corrigé le test : à quatre joueurs, il en reste
trois connectés, la partie continue, et le test vérifie de nouveau ce qu'il prétendait
vérifier. Un test qui casse en ajoutant une règle attendue fait son travail.

---

## Lot 6 — Finition

### D-45 · Les sons sont synthétisés, pas chargés

**Décision.** `lib/sound.ts` construit chaque son à la volée avec l'API Web Audio :
oscillateur, enveloppe, quelques dizaines de millisecondes. Aucun fichier `.mp3` ni
`.wav` dans le projet.

**Pourquoi.** Zéro octet à charger, zéro licence à gérer, et surtout : un son démarre à
l'instant du clic. Un fichier de 20 ko qui arrive 200 ms après l'appui ne ponctue plus
rien, il gêne. L'enveloppe est adoucie à l'attaque et à la coupure — une rampe brutale
« claque » sur un haut-parleur de téléphone.

**Limite.** Ces sons sont des bips, pas du sound design. Si un jour on veut mieux, le
point d'entrée `playSound(name)` ne change pas.

---

### D-46 · Sons activés par défaut, bouton toujours visible

**Décision.** Le réglage vaut `on` tant que rien n'a été choisi, et le bouton 🔊 est dans
l'en-tête de **tous** les écrans de jeu.

**Pourquoi.** Un jeu de soirée muet perd la moitié de son énergie, et personne ne va
chercher un réglage pour activer une fonctionnalité dont il ignore l'existence. Le
contrepoids est l'accessibilité de la coupure : on ne cherche pas un bouton de sourdine
dans un menu quand le téléphone sonne au mauvais moment.

**Ce qui est respecté.** Aucun son au chargement — un son ne part qu'en réaction à un
événement de jeu. Les navigateurs bloquent de toute façon l'audio avant la première
interaction : les tout premiers sons d'une session peuvent être muets, et on ne cherche
pas à contourner ce comportement.

---

### D-47 · Le son de révélation dépend de ce que la carte annonce

**Décision.** Pendant la révélation séquentielle, chaque carte joue un son différent :
neutre pour sa propre série, ascendant si on avait trouvé, grave sinon.

**Pourquoi.** C'est la seule information vraiment personnelle d'un écran que tout le
monde regarde en même temps. L'entendre avant de l'avoir lue rend le moment lisible sans
regarder de près — et c'est exactement ce qu'on fait autour d'une table.

**Détail tenu.** Le bip d'urgence du décompte ne sonne **qu'une fois** par phase. Le
répéter chaque seconde sous dix secondes serait insupportable et n'ajouterait rien.

---

### D-48 · `handlers.ts` découpé en trois modules

**Décision.** Le fichier atteignait 635 lignes, largement au-dessus de la limite de 300
du §12. Il devient `handlers/context.ts` (socle partagé), `handlers/session.ts` (entrées,
sorties, reconnexion, échéances), `handlers/round.ts` (réglages, lancement, soumissions,
enchaînement) et `handlers/index.ts` (assemblage).

**Pourquoi.** Le découpage suit les domaines du cahier des charges, pas des tailles
arbitraires. Et surtout : le contexte partagé — `guard`, `bind`, `resolveContext`,
`finalize` — circule maintenant **explicitement** en paramètre au lieu d'être capturé par
fermeture. Chaque module annonce ce dont il dépend.

**Vérification.** Les 100 tests d'intégration serveur sont passés au vert sans une seule
modification : le refactoring n'a rien changé au comportement observable, ce qui était
tout l'intérêt de les avoir écrits avant.

---

### D-49 · `engine.ts` et `playerView.ts` allégés de la même façon

**Décision.** Les règles pures sortent dans `game/roundRules.ts`, la mise en pause dans
`game/pause.ts`, les classements dans `serialization/scoreboard.ts`.

**Pourquoi.** Chacun de ces trois modules répond à une question différente. `engine.ts`
fait avancer une partie ; `pause.ts` l'arrête et la redémarre ; `roundRules.ts` dit ce
qu'une transition fait aux données. Et `playerView.ts` redevient ce qu'il doit être : la
liste, phase par phase, de ce qui a le droit de sortir vers un socket — sans 90 lignes de
calcul de classement au milieu.

**Résultat.** Tous les fichiers de code sont sous 300 lignes, à l'exception de
`packages/shared/src/types.ts` (306) qui est une déclaration de types, et des deux
catalogues de données.

---

## Lot 7 — Passage au pair à pair, sans serveur

Objectif : déployer sur GitHub Pages, seul. GitHub Pages ne sert que des fichiers, or
le jeu reposait sur un processus Node persistant. Il fallait donc déplacer le moteur —
pas le réécrire.

### D-50 · Le moteur déménage dans le navigateur de l'hôte, il n'est pas réécrit

Trois voies étaient possibles : tout ramener sur un seul appareil qu'on se passe ; louer
un service géré (Firebase, Supabase) ; ou faire tourner le moteur existant dans le
navigateur d'un joueur.

La première changeait le jeu — « chacun sur son téléphone » est la moitié de l'intérêt.
La deuxième déplaçait la dépendance sans la supprimer, et imposait de réécrire les règles
en transactions de base de données, c'est-à-dire de jeter les 146 tests avec.

La troisième garde le code tel quel. Le moteur ne dépendait de Socket.IO que par cinq
fichiers, et de Node que par `node:crypto` : le reste était déjà pur. On a donc extrait
`packages/engine`, remplacé `io: Server` par une interface `Emitter` de trois lignes, et
`randomBytes` par `crypto.getRandomValues` — disponible des deux côtés.

Ce qui n'a pas bougé : les règles, la machine à états, `playerView.ts`, la validation Zod,
le calcul des scores. C'est l'essentiel du projet, et il n'a pas été touché.

### D-51 · Le code de partie **est** l'identifiant de rendez-vous

Le serveur tenait un annuaire : code → partie. Sans lui, il fallait un autre moyen pour
qu'un invité trouve l'hôte à partir de cinq caractères lus à voix haute.

L'espace de noms du service de mise en relation joue ce rôle : l'hôte y réserve
`identite-secrete-v1-K7P4Q`, les invités s'y connectent. Aucun annuaire à écrire, et
l'unicité est garantie par le courtier — s'il refuse l'identifiant, on tire un autre code.

Conséquence sur l'ordre des opérations : le code doit être accepté **avant** que la partie
n'existe, sinon on afficherait à l'hôte un code que personne ne peut joindre. D'où
`fixedCode` dans `GameHost` — le tirage a lieu au-dehors, pas dans `createGame`.

Le préfixe porte un numéro de version. Le jour où le format des messages change,
l'incrémenter empêche un ancien onglet de parler à un nouveau.

### D-52 · L'hôte est un joueur comme les autres, sous la connexion `local`

Il aurait été tentant de court-circuiter : l'hôte a l'état complet dans le même onglet,
autant lire dedans directement.

C'est exactement ce qu'il ne faut pas faire. Le jour où un chemin de lecture directe
existe, c'est par lui que fuit une identité — et il ne serait couvert par aucun test,
puisque les tests passent par les messages. L'hôte émet donc ses actions par
`GameHost.dispatch(LOCAL, …)` et reçoit sa vue par `playerView.ts`, comme tout le monde.

Le coût est nul : ce sont des appels de fonction dans le même processus.

### D-53 · Un rattrapage explicite des échéances, parce qu'un onglet n'est pas un serveur

C'est la vraie différence entre un serveur et un navigateur, et elle est sournoise : un
onglet en arrière-plan voit ses `setTimeout` étalés, puis gelés. L'hôte qui verrouille son
téléphone pendant la phase d'indices rendrait la main sur une manche figée, avec cinq
joueurs devant un décompte à zéro.

`GameEngine.tick()` compare `phaseEndsAt` à l'heure courante et avance si l'échéance est
passée. Il est appelé à trois endroits : à chaque message reçu, sur `visibilitychange`, et
par un battement d'une seconde. Les minuteurs restent le chemin nominal — `tick` ne fait
que rattraper ce qu'ils ont manqué, et ne fait rien quand ils ont fait leur travail.

### D-54 · La partie survit au rechargement de l'onglet de l'hôte

Sur un téléphone, un onglet peut être rechargé par le système sans que personne n'ait rien
demandé. Perdre une partie de huit manches pour cette raison aurait été inacceptable.

L'état est donc sérialisé dans le `localStorage` de l'hôte après chaque diffusion,
groupées par 400 ms — une manche produit des dizaines de diffusions, et l'hôte est déjà le
téléphone le plus chargé. Au rechargement, le moteur repart de cette sauvegarde et
reprend son identifiant auprès du courtier, en insistant : celui-ci met quelques secondes
à libérer un identifiant abandonné.

Les jetons de session sont conservés, donc les autres joueurs se reconnectent seuls, sans
repasser par le formulaire de pseudo. Ils reviennent tous marqués **déconnectés** : leurs
canaux n'existent plus, et les prétendre ouverts ferait attendre la partie sur des joueurs
qui ne recevraient rien.

`JSON.stringify` transforme silencieusement une `Map` en `{}` : la conversion est écrite à
la main plutôt que déléguée, et un test vérifie l'aller-retour complet. C'est le genre de
perte muette qui ne se voit qu'en production.

### D-55 · Une fermeture de canal en retard ne déclare pas absent un joueur revenu

En WebRTC, changer de réseau ouvre souvent le nouveau canal **avant** que l'ancien
n'annonce sa fermeture. Traitée naïvement, cette fermeture marquerait déconnecté un joueur
qui vient de revenir — et pourrait mettre la partie en pause alors que tout le monde est là.

`handleDisconnect` compare donc l'identifiant de connexion qui se ferme à celui que porte
le joueur : s'ils diffèrent, la fermeture concerne un canal périmé et on l'ignore.

### D-56 · Les tests d'intégration abandonnent les sockets

Ils démarraient un vrai serveur sur un vrai port avec de vrais clients Socket.IO. Ce
qu'ils éprouvaient de Socket.IO n'a plus d'objet : le transport n'est plus là.

Ils passent désormais par un canal en mémoire qui parle au même `GameHost`. Les 146 tests
sont conservés à l'identique — mêmes scénarios, mêmes assertions, vraies parties, vrais
minuteurs — et neuf s'y ajoutent pour la sérialisation, le rattrapage d'échéances et la
course de reconnexion. La suite passe de deux minutes à vingt secondes, et les
acquittements arrivent après les diffusions : plus aucun test ne peut passer par chance
sur un ordonnancement favorable.

### D-57 · La validation reste entière, bien que le moteur soit « chez un joueur »

Objection naturelle : si le moteur tourne dans un navigateur, un joueur malintentionné
peut le modifier. C'est vrai — et sans conséquence sur ce qui compte.

L'hôte pouvait déjà tricher avant : il lui suffisait de modifier le serveur. Ce qui n'a
pas changé, c'est que les messages des **autres** joueurs viennent de navigateurs que
l'hôte ne contrôle pas, et restent donc validés un par un : phase, rôle, appartenance à la
main, sous-ensemble d'étiquettes autorisé. Un invité modifié ne peut toujours pas deviner
sa propre série ni lire l'identité d'un voisin.

La table d'événements est fermée : un nom inconnu est rejeté, il n'existe aucun chemin
générique par lequel un message inattendu atteindrait l'état.

### D-58 · Un TURN n'est pas fourni, et c'est assumé

Sans relais, deux joueurs sur deux réseaux mobiles différents peuvent ne pas réussir à
s'atteindre — NAT symétrique. Un TURN règle le cas, mais il fait transiter tout le trafic :
il ne peut pas être gratuit, et en fournir un annulerait l'intérêt du projet.

Le cadre visé est une pièce et un Wi-Fi commun, où les STUN publics suffisent. Le point de
configuration existe (`NEXT_PUBLIC_ICE_SERVERS`) pour brancher un relais sans toucher au
code, et le README dit franchement quand il devient nécessaire.

### D-59 · On sérialise les messages nous-mêmes, en chaînes, à cause de Safari

Symptôme : sur iPhone, plus rien ne marchait — ni rejoindre la partie d'un autre,
ni laisser les autres rejoindre la sienne. Le canal s'ouvrait pourtant, et aucune
erreur n'apparaissait nulle part.

Cause : **Safari ne parvient pas à émettre de binaire** sur un canal de données
PeerJS. Il en reçoit sans problème, ce qui explique la forme exacte de la panne —
un iPhone invité n'arrivait pas à envoyer sa demande de jointure, et un iPhone
hôte n'arrivait pas à répondre. Deux directions cassées, une seule cause.

Le piège est que le remède évident n'en est pas un. On lit partout « utilise
`serialization: 'json'` pour Safari », mais dans PeerJS 1.5.5 le sérialiseur JSON
fait `new TextEncoder().encode(JSON.stringify(data))` : il envoie **aussi** un
`Uint8Array`. Seul le mode `raw` transmet la valeur telle quelle.

On utilise donc `raw`, et `protocol.ts` fait lui-même le `JSON.stringify` /
`JSON.parse`. C'est trois lignes de plus et ça retire une dépendance à une
mécanique qu'on ne contrôlait pas.

**Coût.** `raw` ne découpe pas les gros messages ; un envoi trop volumineux ferait
échouer `send()`, et PeerJS ferme le canal sur cette erreur. D'où un plafond
explicite qui lève plutôt que de laisser tomber la connexion. L'ordre de grandeur
réel est très en dessous : une vue de jeu à huit joueurs pèse quelques kilo-octets.

**Ce qui garde la leçon.** `protocol.test.ts` vérifie en premier que ce qui part
est bien une chaîne. Le jour où quelqu'un « simplifiera » en laissant PeerJS
sérialiser, iPhone cessera silencieusement de fonctionner — et ce test le dira.

### D-60 · L'accueil teste le transport pour de vrai, pas seulement la signalisation

Le voyant d'accueil ne vérifiait que la joignabilité du courtier. Il était vert
sur l'iPhone pendant que le jeu était entièrement cassé : il ne mesurait pas la
bonne chose.

Il ouvre maintenant deux pairs sur l'appareil, les connecte l'un à l'autre et fait
passer un vrai message par un vrai canal, avec la sérialisation de production.
C'est plus coûteux — deux connexions au courtier, détruites aussitôt — et ça vaut
largement son prix : le bug de Safari se serait annoncé en trois secondes, sur
l'appareil concerné, au lieu de coûter un aller-retour de diagnostic à l'aveugle.

**Ce qu'il ne prouve pas.** Une boucle locale ne traverse aucun NAT : il couvre le
navigateur et la mise en relation, jamais la topologie du réseau. Deux joueurs sur
deux réseaux mobiles peuvent toujours échouer avec un voyant vert (D-58).

---

## Points laissés ouverts

- **Safari a déjà coûté une panne complète, d'autres navigateurs peuvent en cacher.**
  Le bug d'émission binaire (D-59) n'a été trouvé qu'en jouant sur un vrai iPhone. Les
  165 tests couvrent le moteur et le format de fil, mais l'établissement des canaux
  WebRTC ne se vérifie que dans de vrais navigateurs — Android/Chrome et Firefox restent
  à éprouver de la même façon. La procédure est dans `TESTING.md` §2.
- **Si l'hôte ferme son onglet, la partie est perdue.** C'est la contrepartie assumée de
  l'absence de serveur (D-50). Une migration du moteur vers un autre joueur serait
  possible — l'état est déjà sérialisable (D-54) — mais elle demande de transférer cet
  état à un successeur avant la coupure, ce qui est un chantier à part entière.
- **La direction typographique reste le maillon faible** (voir D-03). C'est le premier
  chantier si le projet devait continuer : une police d'affichage auto-hébergée en
  `.woff2`, chargée via `next/font/local`, garderait le build hors-ligne tout en donnant
  une vraie personnalité.
- **Aucun test d'interface.** Les 165 tests couvrent le moteur, le format de fil et la logique partagée ;
  les écrans et la couche réseau ne sont vérifiés que par `tsc` et le build. Une passe
  Playwright sur le scénario du §1 serait le complément naturel — et le seul moyen de
  couvrir `lib/net/`, qui a besoin d'un vrai navigateur.
- **La limitation de débit est par canal, pas par pair.** Ouvrir cinquante canaux
  contourne le plafond. Suffisant pour un jeu de soirée à code partagé ; à revoir si le
  service devenait public.
- **La pause ne distingue pas déconnexion et départ.** Trois joueurs dont un part
  définitivement mettent la partie en pause pendant deux minutes avant de revenir au
  salon, alors qu'on pourrait y revenir tout de suite. Améliorable, sans conséquence sur
  la correction.
- **Pas de linter.** `eslint-config-next` n'est pas installé. `tsc --noEmit` en mode
  strict couvre l'essentiel. À rajouter au Lot 5 si le besoin se fait sentir.
- **`InMemoryStore.save()` reste un quasi no-op.** Voulu (D-10), mais cela signifie qu'un
  oubli d'appel à `save()` ne se verrait pas aujourd'hui et casserait un futur
  `RedisStore`. Les gestionnaires l'appellent systématiquement après mutation.
