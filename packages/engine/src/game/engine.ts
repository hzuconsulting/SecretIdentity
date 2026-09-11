import {
  IDENTITY_REVEAL_MS,
  SERVER_EVENTS,
  STARTING_HAND_CARDS,
  TOTAL_ROUNDS,
  dealPictoCards,
  type Game,
  type Phase,
  type PhaseChangedPayload,
  type Rng,
} from '@identite-secrete/shared';
import { logger } from '../logger';
import type { GameStore } from '../store/GameStore';
import { touch } from './factory';
import { abandonTimerKey, pauseIfNeeded, phaseTimerKey, resumeIfPossible } from './pause';
import {
  autoSubmitClues,
  autoSubmitVotes,
  discardPlayedCards,
  isPhaseComplete,
  settleRound,
} from './roundRules';
import { createRound, currentRound } from './round';
import { TimerRegistry } from '../timers';
import { broadcastState } from '../emit';
import type { Emitter } from '../transport';

/**
 * Machine à états.
 *
 * **Seul l'hôte décide d'un changement de phase.** Les autres joueurs
 * reçoivent `phaseEndsAt` (un timestamp de l'hôte) et affichent un décompte,
 * mais ils peuvent afficher `00:00` pendant une seconde sans que rien ne se
 * passe : la transition n'arrive que quand ce module la déclenche.
 *
 * Trois déclencheurs, le premier qui survient (§4.1) :
 *  - l'échéance `phaseEndsAt` ;
 *  - la condition « tout le monde a soumis », vérifiée par `isPhaseComplete` ;
 *  - un rattrapage explicite via `tick()`, indispensable dans un navigateur —
 *    voir plus bas.
 */

export interface EngineDeps {
  emitter: Emitter;
  store: GameStore;
  timers: TimerRegistry;
  rng: Rng;
  /**
   * Facteur appliqué à **toutes** les durées de phase. Vaut 1 en production.
   *
   * Les tests le descendent à 0,01 : une phase de 60 s dure alors 600 ms.
   * C'est le seul moyen de vérifier un déroulé complet de partie sans simuler
   * les minuteurs — or ce qu'on veut prouver, c'est justement que les vrais
   * `setTimeout` s'enchaînent dans le bon ordre.
   */
  timeScale?: number;
}

/** Convertit un réglage en secondes vers des millisecondes. `null` = sans limite. */
function toMs(seconds: number | null): number | null {
  return seconds === null ? null : seconds * 1_000;
}

export class GameEngine {
  constructor(private readonly deps: EngineDeps) {}

  /**
   * Lance la partie : distribue les mains, puis ouvre la manche 1.
   *
   * La distribution a lieu **ici et nulle part ailleurs**. Les cartes Picto
   * accompagnent le joueur sur les quatre manches sans jamais être remplacées :
   * c'est la ressource qu'il doit gérer, et la recharger en cours de partie
   * viderait le jeu de sa tension.
   */
  async start(game: Game): Promise<void> {
    const now = Date.now();
    game.currentRound = 0;
    game.rounds = [];

    for (const player of game.players.values()) {
      player.hand = dealPictoCards(
        { cardCount: STARTING_HAND_CARDS, idPrefix: `${player.id}-` },
        this.deps.rng,
      );
    }

    logger.info(`Partie ${game.code} lancée (${game.players.size} joueurs)`);
    await this.openRound(game, now);
  }

  /** Ouvre la manche suivante, ou termine la partie. */
  async openRound(game: Game, now = Date.now()): Promise<void> {
    if (game.currentRound >= TOTAL_ROUNDS) {
      await this.enterPhase(game, 'FINAL_RESULTS', now);
      return;
    }

    const roundNumber = game.currentRound + 1;
    const round = createRound(game, roundNumber, this.deps.rng);

    game.rounds.push(round);
    game.currentRound = roundNumber;

    await this.enterPhase(game, 'IDENTITY_REVEAL', now);
  }

  /**
   * Entre dans une phase : calcule l'échéance, applique les effets de sortie
   * de la phase précédente, diffuse, et programme la transition.
   */
  async enterPhase(
    game: Game,
    phase: Phase,
    now = Date.now(),
    options: { applyExitEffects?: boolean } = {},
  ): Promise<void> {
    const round = currentRound(game);
    const applyExitEffects = options.applyExitEffects ?? true;

    // Effets qui doivent avoir lieu **avant** de diffuser la nouvelle phase.
    // Ils sont désactivés lors d'une reprise après pause : rejouer
    // `settleRound` compterait les points une deuxième fois.
    if (applyExitEffects && phase === 'GUESSING' && round) {
      const forced = autoSubmitClues(game, round, this.deps.rng);
      if (forced.length > 0) {
        logger.debug(`Carte tirée au sort pour ${forced.length} joueur(s) dans ${game.code}`);
      }
      // Les boîtiers sont figés : les cartes jouées quittent définitivement les
      // mains. Un seul passage, sous le garde `applyExitEffects`, pour qu'une
      // reprise après pause ne défausse pas deux fois.
      discardPlayedCards(game, round);
    }
    if (applyExitEffects && phase === 'RESULTS' && round) {
      autoSubmitVotes(round);
      settleRound(game, round);
    }

    game.phase = phase;
    touch(game, now);

    const duration = this.phaseDuration(game, phase);
    const phaseEndsAt = duration === null ? null : now + duration;

    if (round) {
      round.phase = phase;
      round.phaseEndsAt = phaseEndsAt;
    }

    await this.deps.store.save(game);

    this.announce(game, phaseEndsAt, now);
    broadcastState(this.deps.emitter, game, now);

    this.deps.timers.cancel(phaseTimerKey(game.code));

    if (duration !== null) {
      this.deps.timers.schedule(phaseTimerKey(game.code), duration, () => {
        void this.onPhaseExpired(game.code, phase);
      });
    }
  }

  /**
   * Durée d'une phase, en millisecondes. `null` = pas d'échéance : la phase
   * attend une condition (tout le monde a soumis, ou une action de l'hôte).
   */
  phaseDuration(game: Game, phase: Phase): number | null {
    const raw = this.rawPhaseDuration(game, phase);
    if (raw === null) return null;
    return Math.max(1, Math.round(raw * (this.deps.timeScale ?? 1)));
  }

  private rawPhaseDuration(game: Game, phase: Phase): number | null {
    switch (phase) {
      case 'IDENTITY_REVEAL':
        // Durée fixe : le temps de lire son personnage.
        return IDENTITY_REVEAL_MS;

      case 'CLUE_SELECTION':
        return toMs(game.settings.clueSeconds);

      case 'GUESSING':
        return toMs(game.settings.guessSeconds);

      // Pas d'échéance après une manche : c'est le moment où l'on regarde qui a
      // voté quoi, qui portait quel personnage, et on en parle. Un minuteur
      // coupait la conversation au milieu. L'hôte enchaîne quand la table est
      // prête, via `round:next`.
      case 'RESULTS':
      case 'SCOREBOARD':
      case 'LOBBY':
      case 'FINAL_RESULTS':
        return null;

      default:
        return null;
    }
  }

  /**
   * Phase suivante **à l'intérieur d'une manche**. `null` hors manche.
   *
   * Après `RESULTS`, on ne passe pas à une autre phase : on ouvre la manche
   * suivante — voir `advance`.
   */
  nextPhase(phase: Phase): Phase | null {
    switch (phase) {
      case 'IDENTITY_REVEAL':
        return 'CLUE_SELECTION';
      case 'CLUE_SELECTION':
        return 'GUESSING';
      case 'GUESSING':
        return 'RESULTS';
      default:
        return null;
    }
  }

  /**
   * Phases où la manche est terminée et où la partie attend l'hôte.
   *
   * `RESULTS` dans le déroulé normal. `SCOREBOARD` n'est plus atteint que par une
   * reprise après migration d'hôte, qui atterrit sur le classement de la
   * dernière manche réglée — le même bouton doit y fonctionner.
   */
  isBetweenRounds(phase: Phase): boolean {
    return phase === 'RESULTS' || phase === 'SCOREBOARD';
  }

  /**
   * Avance depuis la phase courante.
   *
   * `expectedPhase` protège contre une transition en retard : si un minuteur
   * se déclenche après que la phase a déjà changé (parce que tout le monde
   * avait soumis), on ne fait rien.
   */
  async advance(game: Game, expectedPhase?: Phase): Promise<void> {
    if (expectedPhase && game.phase !== expectedPhase) return;

    const now = Date.now();

    if (this.isBetweenRounds(game.phase)) {
      await this.openRound(game, now);
      return;
    }

    const next = this.nextPhase(game.phase);
    if (!next) return;

    await this.enterPhase(game, next, now);
  }

  /**
   * Avance si la condition de complétude est remplie.
   * Appelée après chaque soumission (Lots 3 et 4).
   */
  async advanceIfComplete(game: Game): Promise<boolean> {
    const round = currentRound(game);
    if (!round || !isPhaseComplete(game, round)) return false;

    await this.advance(game, game.phase);
    return true;
  }

  /**
   * Rattrape une échéance manquée.
   *
   * Un onglet en arrière-plan voit ses `setTimeout` étalés, voire gelés : sur
   * iOS, l'hôte qui verrouille son téléphone pendant la phase d'indices
   * rendrait la main avec une manche figée. On vérifie donc l'échéance sur
   * chaque action reçue et au retour au premier plan, plutôt que de faire
   * confiance au seul minuteur.
   *
   * Sans effet si l'échéance n'est pas dépassée : c'est le minuteur qui reste
   * le chemin nominal.
   */
  async tick(game: Game, now = Date.now()): Promise<boolean> {
    if (game.pausedAt !== null) return false;

    const round = currentRound(game);
    const endsAt = round?.phaseEndsAt ?? null;
    if (endsAt === null || now < endsAt) return false;

    const phase = game.phase;
    await this.advance(game, phase);
    return game.phase !== phase;
  }

  /** Annule toutes les échéances de phase d'une partie. */
  cancel(code: string): void {
    this.deps.timers.cancel(phaseTimerKey(code));
    this.deps.timers.cancel(abandonTimerKey(code));
  }

  /** Mise en pause faute de joueurs connectés — voir `pause.ts`. */
  pauseIfNeeded(game: Game): Promise<boolean> {
    return pauseIfNeeded(this.deps, game);
  }

  /** Reprise après pause — voir `pause.ts`. */
  resumeIfPossible(game: Game): Promise<boolean> {
    return resumeIfPossible(this, this.deps, game);
  }

  private announce(game: Game, phaseEndsAt: number | null, now: number): void {
    const payload: PhaseChangedPayload = {
      phase: game.phase,
      roundNumber: game.currentRound,
      phaseEndsAt,
      serverTime: now,
    };

    for (const player of game.players.values()) {
      if (!player.connected || !player.connectionId) continue;
      this.deps.emitter.emit(player.connectionId, SERVER_EVENTS.phaseChanged, payload);
    }
  }

  private async onPhaseExpired(code: string, expectedPhase: Phase): Promise<void> {
    const game = await this.deps.store.get(code);
    if (!game) return;
    await this.advance(game, expectedPhase);
  }
}
