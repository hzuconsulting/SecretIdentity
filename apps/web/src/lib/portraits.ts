import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { BASE_PATH } from './config';

/**
 * Les portraits des personnages (D-85).
 *
 * Une petite photo libre, prise sur Wikimedia Commons, accompagne les
 * personnages qui en ont une : si l'on ne connaît pas le nom, on reconnaîtra
 * peut-être le visage. La liste est calculée **hors ligne** et publiée à côté
 * du site, dans `public/portraits.json` :
 *
 *   { v: 1, generatedAt, portraits: { <identityId>: { f, h, a, l, u?, p } } }
 *
 * Ce fichier n'est **jamais** importé dans le code : il pèse plusieurs dizaines
 * de kilo-octets, et seules les pages qui montrent un personnage en ont besoin.
 * Il est lu une fois par page, à la première demande, puis gardé en mémoire.
 *
 * Deux règles tiennent tout le reste :
 *  - le téléphone n'interroge **jamais** les API de Wikipédia ou de Wikidata —
 *    elles brident les appels rapprochés. Il ne charge que des vignettes, sur
 *    `upload.wikimedia.org`, à une adresse qu'il calcule lui-même ;
 *  - un portrait n'est jamais nécessaire pour jouer. Fichier absent, illisible,
 *    réseau coupé : on retombe sur une carte vide, et l'écran montre l'initiale.
 *    Rien ici ne lève d'erreur vers l'appelant.
 */

/** Une entrée du fichier, telle qu'elle a été validée. */
export interface PortraitEntry {
  /** Nom du fichier Commons, déjà encodé pour une URL (`Tom_Hanks_2016.jpg`). */
  f: string;
  /** Répertoire de hachage Commons : `a/ab`. */
  h: string;
  /** Auteur de la photo. */
  a: string;
  /** Licence, en nom court (`CC BY-SA 4.0`). */
  l: string;
  /** Texte de la licence, s'il est connu. */
  u?: string;
  /** Page du fichier sur Wikimedia Commons. */
  p: string;
}

export type PortraitMap = ReadonlyMap<string, PortraitEntry>;

/** Largeurs de vignette demandées à Commons. Deux seulement : elles se partagent le cache. */
export type PortraitWidth = 120 | 250;

const PORTRAITS_VERSION = 1;

/** Au-delà, le fichier n'est pas le nôtre : le catalogue compte un peu plus de mille personnages. */
const MAX_ENTRIES = 5_000;

/** Même garde-fou en octets, avant même d'analyser le JSON. */
const MAX_FILE_CHARS = 4_000_000;

/** Délai après lequel on renonce : un fichier qui ne vient pas ne doit pas figer les écrans. */
const FETCH_TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────────────────────
//  Validation
// ─────────────────────────────────────────────────────────────

/**
 * Caractères de contrôle et de forçage du sens d'écriture : retirés des textes
 * affichés (auteur, licence), comme dans l'annuaire des parties.
 */
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function cleanText(value: string): string {
  return value.replace(UNSAFE_CHARS, '').trim();
}

/** Identifiant de personnage : kebab-case, comme dans le catalogue. */
const IDENTITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Répertoire de hachage : les premiers caractères du MD5 du nom de fichier. */
const HASH_DIR = /^[0-9a-f]\/[0-9a-f]{2}$/;

/**
 * Nom de fichier Commons encodé.
 *
 * Seuls les caractères que MediaWiki laisse en clair dans une URL, plus les
 * échappements `%XX` bien formés. Ni `/`, ni `?`, ni `#`, ni `:` : le nom est
 * inséré tel quel dans un chemin, il ne doit pouvoir ni en sortir, ni changer
 * d'hôte, ni ajouter une requête. Et seulement des formats dont Commons sert la
 * vignette sous le même nom — un SVG ou un TIFF deviendraient `….svg.png`.
 */
const FILE_SEGMENT =
  /^(?:[A-Za-z0-9_.~!$*()',;@+-]|%[0-9A-Fa-f]{2})+\.(?:jpe?g|png|gif|webp)$/i;

/** Échappements qui, une fois décodés, redeviendraient un séparateur ou un contrôle. */
const DANGEROUS_ESCAPES = /%(?:2F|5C|0[0-9A-F]|1[0-9A-F]|7F)/i;

const fileSegmentSchema = z
  .string()
  .min(5)
  .max(512)
  .refine((value) => FILE_SEGMENT.test(value), 'nom de fichier')
  .refine((value) => !value.startsWith('.') && !DANGEROUS_ESCAPES.test(value), 'nom de fichier');

function isHttpUrl(value: string, host?: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (host) return url.protocol === 'https:' && url.hostname === host;
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const entrySchema = z
  .object({
    f: fileSegmentSchema,
    h: z.string().regex(HASH_DIR),
    a: z.string().max(400).transform(cleanText).pipe(z.string().min(1).max(300)),
    l: z.string().max(120).transform(cleanText).pipe(z.string().min(1).max(80)),
    u: z
      .string()
      .max(300)
      .refine((value) => isHttpUrl(value), 'URL de licence')
      .optional(),
    p: z
      .string()
      .max(1_024)
      .refine((value) => isHttpUrl(value, 'commons.wikimedia.org'), 'page Commons'),
  })
  .strict();

const fileSchema = z
  .object({
    v: z.literal(PORTRAITS_VERSION),
    generatedAt: z.string().max(64),
    portraits: z.record(z.unknown()),
  })
  .strict();

/**
 * Lit un fichier de portraits déjà analysé.
 *
 * L'enveloppe (version, champs) doit être exacte, sinon rien n'est gardé. Les
 * entrées, elles, sont jugées une par une : une entrée douteuse est écartée,
 * son personnage retombe sur l'initiale, et les autres restent.
 */
export function parsePortraitsFile(raw: unknown): Map<string, PortraitEntry> {
  const portraits = new Map<string, PortraitEntry>();

  const file = fileSchema.safeParse(raw);
  if (!file.success) return portraits;

  const entries = Object.entries(file.data.portraits);
  if (entries.length > MAX_ENTRIES) return portraits;

  for (const [identityId, value] of entries) {
    if (identityId.length > 80 || !IDENTITY_ID.test(identityId)) continue;

    const entry = entrySchema.safeParse(value);
    if (entry.success) portraits.set(identityId, entry.data);
  }

  return portraits;
}

// ─────────────────────────────────────────────────────────────
//  Adresses
// ─────────────────────────────────────────────────────────────

/**
 * Vignette Commons d'une entrée.
 *
 * L'adresse est calculée, jamais demandée à une API : c'est le schéma fixe des
 * vignettes de Commons, `thumb/<h>/<fichier>/<largeur>px-<fichier>`.
 */
export function portraitUrl(entry: Pick<PortraitEntry, 'f' | 'h'>, width: PortraitWidth): string {
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${entry.h}/${entry.f}/${width}px-${entry.f}`;
}

// ─────────────────────────────────────────────────────────────
//  Chargement
// ─────────────────────────────────────────────────────────────

let pending: Promise<PortraitMap> | null = null;
let loaded: PortraitMap | null = null;
const listeners = new Set<() => void>();

async function fetchPortraits(): Promise<PortraitMap> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_PATH}/portraits.json`, {
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    if (text.length > MAX_FILE_CHARS) throw new Error('fichier trop gros');

    return parsePortraitsFile(JSON.parse(text));
  } catch (cause) {
    // Un portrait n'est qu'un plus : on le dit à qui ouvre la console, pas au joueur.
    console.debug('[portraits] liste indisponible, initiales seulement', cause);
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * La liste des portraits, chargée une seule fois par page.
 *
 * Ne rejette jamais : en cas d'échec, la promesse rend une carte vide — et la
 * garde, pour ne pas relancer la requête à chaque personnage affiché.
 */
export function loadPortraits(): Promise<PortraitMap> {
  if (!pending) {
    pending = fetchPortraits().then((portraits) => {
      loaded = portraits;
      for (const listener of listeners) listener();
      return portraits;
    });
  }
  return pending;
}

/** Oublie la liste chargée. Réservé aux tests. */
export function resetPortraitsCache(): void {
  pending = null;
  loaded = null;
  listeners.clear();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // S'abonner, c'est avoir besoin de la liste : le premier composant affiché
  // déclenche le chargement, les suivants partagent la même requête.
  void loadPortraits();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => loaded;
// Au rendu statique, la liste n'existe pas encore : la page part sans portrait,
// et l'hydratation ne diverge pas.
const getServerSnapshot = () => null;

/** Toute la liste, ou `null` tant qu'elle n'est pas arrivée. */
export function usePortraits(): PortraitMap | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Le portrait d'un personnage.
 *
 * `ready` passe à `true` quand la liste est arrivée (ou a échoué) : avant, on
 * ne sait pas encore s'il faut attendre une photo ou montrer l'initiale.
 */
export function usePortrait(identityId: string): { entry: PortraitEntry | null; ready: boolean } {
  const portraits = usePortraits();
  return { entry: portraits?.get(identityId) ?? null, ready: portraits !== null };
}
