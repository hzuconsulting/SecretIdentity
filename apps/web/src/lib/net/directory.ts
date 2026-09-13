import { z } from 'zod';
import {
  MAX_NICKNAME_LENGTH,
  MAX_PLAYERS,
  TOTAL_ROUNDS,
  isValidGameCode,
  normalizeGameCode,
  type Game,
} from '@identite-secrete/shared';

/**
 * L'annuaire des parties publiques.
 *
 * Sans serveur, personne ne tient la liste des salons ouverts. Chaque hôte
 * d'une partie publique l'**annonce** donc lui-même sur un sujet ntfy.sh, et
 * l'accueil relit les annonces récentes. Le service ne garde les messages
 * qu'une douzaine d'heures et ne sait rien de nous : c'est un tableau
 * d'affichage, pas une base de données.
 *
 * Deux conséquences structurent tout le fichier :
 *
 *  - **le sujet est public**. N'importe qui peut y écrire n'importe quoi : tout
 *    ce qui en est lu passe par un schéma strict, et une annonce ne donne
 *    jamais qu'un code — qu'on peut de toute façon taper à la main. Rien de
 *    secret n'y est publié : ni jeton, ni identité, ni main.
 *  - **personne ne fait le ménage**. Un hôte qui disparaît sans prévenir laisse
 *    une annonce derrière lui. D'où le battement : une annonce se renouvelle
 *    régulièrement, et celle qui ne l'est plus depuis `STALE_MS` est tenue
 *    pour morte.
 *
 * La logique pure (format, agrégation, péremption) est ici, testée sans
 * réseau. Le transport — `fetch` vers ntfy — est à part, en bas du fichier.
 */

// ─────────────────────────────────────────────────────────────
//  Cadences
// ─────────────────────────────────────────────────────────────

/**
 * Délai avant de publier un changement.
 *
 * Trois joueurs arrivent souvent dans la même seconde : on attend que ça se
 * tasse pour n'en faire qu'une annonce.
 */
export const ANNOUNCE_DEBOUNCE_MS = 3_000;

/**
 * Écart minimal entre deux publications d'un même hôte.
 *
 * Plancher dur, qu'aucune rafale ne franchit : ntfy.sh limite les anonymes à
 * 250 messages par jour **et par adresse IP**, et le quota est partagé avec
 * tout ce qui sort du même réseau.
 */
export const MIN_PUBLISH_INTERVAL_MS = 10_000;

/**
 * Renouvellement d'une annonce inchangée.
 *
 * C'est le poste de dépense principal : 36 messages par heure de partie
 * publique, soit environ sept heures sur le quota du jour — une soirée entière,
 * même en partageant l'adresse IP. Les départs normaux (partie privée, finie,
 * fermée) publient un retrait immédiat : ce battement ne sert qu'à faire
 * disparaître un hôte parti **sans** prévenir.
 */
export const HEARTBEAT_MS = 100_000;

/**
 * Âge au-delà duquel une annonce est tenue pour morte.
 *
 * Deux battements et demi : un seul battement perdu ne fait pas clignoter la
 * partie, et un hôte parti sans prévenir quitte la liste en quatre minutes au
 * plus — le prix d'une soirée entière sur le quota gratuit.
 */
export const STALE_MS = 250_000;

/** Rythme de relecture de l'accueil, tant qu'il est à l'écran. */
export const POLL_INTERVAL_MS = 10_000;

/** Nombre maximal de parties affichées. */
export const MAX_LISTED = 20;

/**
 * Pause après un refus pour excès de débit (HTTP 429).
 *
 * Le quota quotidien est épuisé, ou la limite de requêtes atteinte : insister
 * ne ferait qu'aggraver la situation, et la partie n'en a pas besoin.
 */
export const RATE_LIMIT_PAUSE_MS = 10 * 60_000;

/**
 * Nombre maximal de lignes lues dans une réponse.
 *
 * Le sujet est public : quelqu'un peut l'inonder. On ne lit que la fin de la
 * réponse — les messages les plus récents — pour que l'accueil ne se fige pas
 * à décoder des milliers d'annonces.
 */
export const MAX_POLL_LINES = 1_000;

// ─────────────────────────────────────────────────────────────
//  Format
// ─────────────────────────────────────────────────────────────

/** Version du format. Elle figure aussi dans le nom du sujet (`config.ts`). */
export const DIRECTORY_VERSION = 1;

export type ListingStatus = 'lobby' | 'playing';

/** Ce qu'une partie dit d'elle-même dans l'annuaire. */
export interface DirectoryListing {
  code: string;
  /** Pseudo de l'hôte du salon. */
  host: string;
  /** Joueurs connectés. */
  players: number;
  max: number;
  status: ListingStatus;
  /** Manche en cours, 0 au salon. */
  round: number;
  rounds: number;
  /**
   * Génération d'hébergement (`game.epoch`).
   *
   * Départage deux hôtes qui annonceraient le même code — l'ancien revenu
   * après une reprise par un invité, typiquement : la génération la plus haute
   * l'emporte, et le retrait publié par l'ancien n'efface pas l'annonce du
   * nouveau.
   */
  gen: number;
}

export type DirectoryMessage =
  | ({ type: 'open'; at: number } & DirectoryListing)
  | { type: 'closed'; code: string; gen: number; at: number };

/** Une partie telle que l'accueil l'affiche. */
export interface OpenGame extends DirectoryListing {
  /** Heure de l'annonce, selon le service (ms). */
  updatedAt: number;
}

/** Une annonce lue sur le sujet, horodatée par le service. */
export interface DirectoryRecord {
  /** Heure de réception par ntfy (ms). Jamais celle, falsifiable, de l'émetteur. */
  time: number;
  message: DirectoryMessage;
}

/**
 * Caractères invisibles ou trompeurs : contrôle, et surtout forçage de sens
 * d'écriture, qui sert à maquiller un texte. Retirés plutôt que refusés : un
 * pseudo légitime n'en contient pas, et un pseudo à émoji composé (qui utilise
 * U+200D) doit rester lisible.
 */
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function cleanText(value: string): string {
  return value.replace(UNSAFE_CHARS, '').trim();
}

const codeSchema = z
  .string()
  .max(16)
  .transform(normalizeGameCode)
  .refine(isValidGameCode, 'Code de partie invalide.');

const genSchema = z.number().int().min(0).max(1_000_000);
const atSchema = z.number().finite().nonnegative();

const openSchema = z.object({
  v: z.literal(DIRECTORY_VERSION),
  type: z.literal('open'),
  code: codeSchema,
  host: z
    .string()
    .max(64)
    .transform(cleanText)
    .pipe(z.string().min(1).max(MAX_NICKNAME_LENGTH)),
  players: z.number().int().min(0).max(MAX_PLAYERS),
  max: z.number().int().min(1).max(MAX_PLAYERS),
  status: z.enum(['lobby', 'playing']),
  round: z.number().int().min(0).max(TOTAL_ROUNDS),
  rounds: z.number().int().min(1).max(TOTAL_ROUNDS),
  gen: genSchema,
  at: atSchema,
});

const closedSchema = z.object({
  v: z.literal(DIRECTORY_VERSION),
  type: z.literal('closed'),
  code: codeSchema,
  gen: genSchema,
  at: atSchema,
});

const messageSchema = z
  .discriminatedUnion('type', [openSchema, closedSchema])
  .superRefine((message, ctx) => {
    if (message.type !== 'open') return;
    if (message.players > message.max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Plus de joueurs que de places.' });
    }
    if (message.round > message.rounds) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Manche hors limites.' });
    }
  });

/** L'enveloppe ntfy d'un message, telle que la renvoie `/json?poll=1`. */
const envelopeSchema = z.object({
  time: z.number().int().positive(),
  event: z.literal('message'),
  message: z.string().max(4_096),
});

export function encodeDirectoryMessage(message: DirectoryMessage): string {
  return JSON.stringify({ v: DIRECTORY_VERSION, ...message });
}

/** Valide le corps d'une annonce. `null` pour tout ce qui n'est pas conforme. */
export function parseDirectoryMessage(raw: string): DirectoryMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = messageSchema.safeParse(json);
  if (!parsed.success) return null;

  const { v: _version, ...message } = parsed.data;
  return message;
}

/**
 * Lit une réponse `/json?poll=1` : un objet JSON par ligne.
 *
 * Tout ce qui n'est pas une annonce valide est ignoré en silence — ligne
 * tronquée, message d'une autre application, farce. L'ordre des lignes est
 * conservé : c'est l'ordre d'arrivée chez ntfy.
 */
export function parseDirectoryPoll(body: string): DirectoryRecord[] {
  const records: DirectoryRecord[] = [];

  for (const line of body.split('\n').slice(-MAX_POLL_LINES)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) continue;

    const message = parseDirectoryMessage(envelope.data.message);
    if (message) records.push({ time: envelope.data.time * 1_000, message });
  }

  return records;
}

// ─────────────────────────────────────────────────────────────
//  Agrégation
// ─────────────────────────────────────────────────────────────

/** `true` si `candidate` remplace `current` comme dernier mot sur ce code. */
function supersedes(candidate: DirectoryRecord, current: DirectoryRecord): boolean {
  if (candidate.message.gen !== current.message.gen) {
    return candidate.message.gen > current.message.gen;
  }
  // À la seconde près (l'horodatage de ntfy), c'est l'ordre d'arrivée qui
  // départage : les lignes sont lues dans cet ordre.
  return candidate.time >= current.time;
}

/**
 * Réduit une série d'annonces à la liste des parties ouvertes.
 *
 * Pour chaque code, seul compte le dernier mot — à génération la plus haute.
 * Une partie retirée, ou dont l'hôte ne donne plus signe de vie depuis
 * `staleMs`, disparaît. On garde les `limit` plus récentes, puis on trie pour
 * l'œil : d'abord ce qu'on peut rejoindre, dans un ordre qui ne saute pas
 * d'une relecture à l'autre.
 */
export function aggregateDirectory(
  records: readonly DirectoryRecord[],
  now: number,
  { staleMs = STALE_MS, limit = MAX_LISTED }: { staleMs?: number; limit?: number } = {},
): OpenGame[] {
  const latest = new Map<string, DirectoryRecord>();

  for (const record of records) {
    const current = latest.get(record.message.code);
    if (!current || supersedes(record, current)) latest.set(record.message.code, record);
  }

  const open: OpenGame[] = [];
  for (const { time, message } of latest.values()) {
    if (message.type !== 'open') continue;
    if (now - time > staleMs) continue;

    const { type: _type, at: _at, ...listing } = message;
    open.push({ ...listing, updatedAt: time });
  }

  return open
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .sort(displayOrder);
}

function displayOrder(a: OpenGame, b: OpenGame): number {
  return (
    rank(a) - rank(b) ||
    a.host.localeCompare(b.host, 'fr', { sensitivity: 'base' }) ||
    a.code.localeCompare(b.code)
  );
}

/** Salon avec de la place, puis salon complet, puis partie en cours. */
function rank(game: OpenGame): number {
  if (game.status === 'playing') return 2;
  return isFull(game) ? 1 : 0;
}

export function isFull(game: DirectoryListing): boolean {
  return game.status === 'lobby' && game.players >= game.max;
}

/**
 * Estime l'heure du service, pour juger de la péremption.
 *
 * Les horodatages viennent de ntfy, l'horloge locale du téléphone. Un
 * téléphone qui avance de cinq minutes jugerait tout périmé et afficherait une
 * liste vide sans raison apparente. Tant qu'une partie au moins est vivante,
 * son dernier battement date de moins de `HEARTBEAT_MS` : l'heure du service
 * ne peut pas le dépasser de beaucoup plus. On borne donc l'horloge locale par
 * là — ça ne rend la péremption que plus indulgente, jamais plus sévère, et la
 * fenêtre `since` de la requête, décomptée par le service lui-même, élimine de
 * toute façon ce qui est vraiment ancien.
 */
export function estimateServerNow(records: readonly DirectoryRecord[], localNow: number): number {
  let newest = -Infinity;
  for (const record of records) newest = Math.max(newest, record.time);
  return Number.isFinite(newest) ? Math.min(localNow, newest + HEARTBEAT_MS) : localNow;
}

// ─────────────────────────────────────────────────────────────
//  Côté hôte
// ─────────────────────────────────────────────────────────────

/**
 * Ce que la partie publie d'elle-même, ou `null` si elle ne doit pas figurer
 * dans l'annuaire : partie privée, terminée, ou sans hôte identifiable.
 *
 * C'est la **seule** porte entre l'état complet du moteur et le sujet public :
 * rien d'autre que ces champs ne sort.
 */
export function describeGame(game: Game): DirectoryListing | null {
  // Une sauvegarde antérieure au réglage n'a pas de visibilité : c'est la
  // valeur par défaut, publique, qui s'applique.
  if (game.settings.visibility === 'private') return null;
  if (game.phase === 'FINAL_RESULTS') return null;

  const host = cleanText(game.players.get(game.hostId)?.nickname ?? '').slice(0, MAX_NICKNAME_LENGTH);
  if (!isValidGameCode(game.code) || !host) return null;

  let players = 0;
  for (const player of game.players.values()) if (player.connected) players++;

  const lobby = game.phase === 'LOBBY';

  return {
    code: normalizeGameCode(game.code),
    host,
    players: Math.min(players, MAX_PLAYERS),
    max: MAX_PLAYERS,
    status: lobby ? 'lobby' : 'playing',
    round: lobby ? 0 : clamp(game.currentRound, 0, TOTAL_ROUNDS),
    rounds: TOTAL_ROUNDS,
    gen: clamp(game.epoch ?? 0, 0, 1_000_000),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min;
}

function sameListing(a: DirectoryListing, b: DirectoryListing): boolean {
  return (
    a.code === b.code &&
    a.host === b.host &&
    a.players === b.players &&
    a.max === b.max &&
    a.status === b.status &&
    a.round === b.round &&
    a.rounds === b.rounds &&
    a.gen === b.gen
  );
}

export type PublishOutcome = 'ok' | 'rate-limited' | 'failed';

/**
 * Envoie un message sur le sujet.
 *
 * `final` signale le dernier message d'un nœud qui s'arrête — la page est
 * peut-être en train de se fermer, l'envoi doit survivre au déchargement.
 */
export type Publish = (body: string, options: { final: boolean }) => Promise<PublishOutcome>;

/**
 * Tient l'annonce d'une partie à jour, sans jamais dépasser le débit permis.
 *
 * On lui dit ce qui **devrait** figurer dans l'annuaire (`update`), aussi
 * souvent qu'on veut ; il décide seul quand publier :
 *
 *  - un changement part après `ANNOUNCE_DEBOUNCE_MS`, compté depuis le
 *    premier changement non publié — une rafale ne le repousse pas ;
 *  - une annonce inchangée est renouvelée toutes les `HEARTBEAT_MS` ;
 *  - un retrait part dès que possible ;
 *  - rien ne part moins de `MIN_PUBLISH_INTERVAL_MS` après le message
 *    précédent, ni pendant la pause qui suit un refus du service.
 *
 * Il ne lève jamais : un annuaire injoignable ne coûte que la visibilité de la
 * partie, jamais la partie.
 */
export class DirectoryAnnouncer {
  private desired: DirectoryListing | null = null;
  /** Dernière annonce envoyée, `null` si rien ne figure (ou plus) à notre nom. */
  private published: DirectoryListing | null = null;
  /** Premier changement non publié, `null` si l'annuaire est à jour. */
  private changedAt: number | null = null;
  private lastPublishAt = Number.NEGATIVE_INFINITY;
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly publish: Publish) {}

  /** Ce qui devrait figurer dans l'annuaire. `null` : rien, ou plus rien. */
  update(listing: DirectoryListing | null): void {
    if (this.stopped) return;
    this.desired = listing;
    this.refreshChanged(Date.now());
    this.plan();
  }

  /**
   * Retire l'annonce tout de suite, sans s'arrêter.
   *
   * Pour la fermeture de page : un rafraîchissement ou un onglet fermé ne
   * laissent pas le temps d'attendre le prochain créneau. Si la page survit
   * (cache de navigation), l'annonce repart d'elle-même au créneau suivant.
   */
  withdrawNow(): void {
    if (this.stopped || !this.published) return;
    this.send({ type: 'closed', code: this.published.code, gen: this.published.gen }, true);
    this.published = null;
    this.refreshChanged(Date.now());
    this.plan();
  }

  /** Arrête l'annonceur, en retirant l'annonce s'il y en a une. Définitif. */
  stop(): void {
    if (this.stopped) return;
    this.clearTimer();
    if (this.published) {
      this.send({ type: 'closed', code: this.published.code, gen: this.published.gen }, true);
    }
    this.stopped = true;
    this.published = null;
    this.desired = null;
  }

  private refreshChanged(now: number): void {
    const pending =
      this.desired !== null &&
      (this.published === null || !sameListing(this.desired, this.published));

    if (!pending) this.changedAt = null;
    else if (this.changedAt === null) this.changedAt = now;
  }

  /** Échéance du prochain message, `null` s'il n'y a rien à envoyer. */
  private nextDueAt(): number | null {
    const floor = Math.max(this.lastPublishAt + MIN_PUBLISH_INTERVAL_MS, this.pausedUntil);

    if (this.desired === null) return this.published === null ? null : floor;
    if (this.changedAt !== null) return Math.max(this.changedAt + ANNOUNCE_DEBOUNCE_MS, floor);
    return Math.max(this.lastPublishAt + HEARTBEAT_MS, floor);
  }

  private plan(): void {
    this.clearTimer();
    if (this.stopped) return;

    const due = this.nextDueAt();
    if (due === null) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, Math.max(0, due - Date.now()));
  }

  private flush(): void {
    if (this.stopped) return;

    const now = Date.now();
    const due = this.nextDueAt();
    if (due === null) return;
    // Minuteur réveillé en avance : on se rendort jusqu'à l'échéance.
    if (due > now) {
      this.plan();
      return;
    }

    if (this.desired === null) {
      const gone = this.published;
      if (gone) this.send({ type: 'closed', code: gone.code, gen: gone.gen }, false);
      this.published = null;
    } else {
      this.send({ type: 'open', ...this.desired }, false);
      this.published = this.desired;
    }

    this.lastPublishAt = now;
    this.changedAt = null;
    this.plan();
  }

  private send(
    message:
      | ({ type: 'open' } & DirectoryListing)
      | { type: 'closed'; code: string; gen: number },
    final: boolean,
  ): void {
    const body = encodeDirectoryMessage({ ...message, at: Date.now() });

    let pending: Promise<PublishOutcome>;
    try {
      pending = this.publish(body, { final });
    } catch (cause) {
      pending = Promise.reject(cause);
    }

    void pending.then(
      (outcome) => {
        if (outcome === 'ok') return;
        console.debug(`[annuaire] publication ${outcome === 'rate-limited' ? 'refusée (débit)' : 'échouée'}`);
        if (outcome === 'rate-limited') {
          this.pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
          this.plan();
        }
      },
      (cause: unknown) => console.debug('[annuaire] publication impossible', cause),
    );
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

// ─────────────────────────────────────────────────────────────
//  Transport ntfy
// ─────────────────────────────────────────────────────────────

/** Délai au-delà duquel une relecture est abandonnée. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Publie sur un sujet ntfy.
 *
 * Un simple `POST` en texte brut, sans en-tête particulier : c'est une requête
 * « simple » au sens de CORS, sans aller-retour de pré-vérification. Le dernier
 * message d'un nœud passe par `sendBeacon`, seul envoi garanti pendant le
 * déchargement de la page.
 */
export function createNtfyPublisher(topicUrl: string): Publish {
  return async (body, { final }) => {
    if (final && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        if (navigator.sendBeacon(topicUrl, body)) return 'ok';
      } catch {
        // Balise refusée : on tente un envoi ordinaire.
      }
    }

    try {
      const response = await fetch(topicUrl, {
        method: 'POST',
        body,
        keepalive: final,
        cache: 'no-store',
        credentials: 'omit',
      });
      if (response.status === 429) return 'rate-limited';
      return response.ok ? 'ok' : 'failed';
    } catch {
      return 'failed';
    }
  };
}

/** L'annonceur d'un hôte, ou `null` si l'annuaire est désactivé. */
export function createAnnouncer(topicUrl: string | null): DirectoryAnnouncer | null {
  return topicUrl ? new DirectoryAnnouncer(createNtfyPublisher(topicUrl)) : null;
}

export class DirectoryUnavailableError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? 'Annuaire injoignable.' : `Annuaire indisponible (HTTP ${status}).`);
    this.name = 'DirectoryUnavailableError';
  }
}

/**
 * Relit les annonces encore fraîches.
 *
 * La fenêtre `since` est décomptée par le service, sur sa propre horloge : ce
 * qui date de plus de `STALE_MS` n'arrive même pas jusqu'ici.
 */
export async function fetchDirectoryRecords(
  topicUrl: string,
  { signal, fetchImpl = fetch }: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<DirectoryRecord[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  const timeout = setTimeout(abort, FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(
      `${topicUrl}/json?poll=1&since=${Math.round(STALE_MS / 1_000)}s`,
      { cache: 'no-store', credentials: 'omit', signal: controller.signal },
    );
    if (!response.ok) throw new DirectoryUnavailableError(response.status);
    return parseDirectoryPoll(await response.text());
  } catch (cause) {
    if (cause instanceof DirectoryUnavailableError) throw cause;
    throw new DirectoryUnavailableError(null);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
