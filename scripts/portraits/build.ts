/**
 * Générateur hors ligne des portraits libres (Wikimedia Commons).
 *
 *   npx vite-node scripts/portraits/build.ts [--refresh] [--verify[=N]] [--dry] [--only=id1,id2]
 *                                            [--cache-dir=DIR]
 *
 * Pipeline : identité → article frwiki → élément Wikidata → image libre
 * (P18, sinon image de page frwiki) → crédits Commons → filtre de licence.
 *
 * Sorties :
 *   - apps/web/public/portraits.json   (contrat consommé par l'UI, minifié)
 *   - scripts/portraits/report.md      (couverture + listes à relire)
 *
 * Corrections manuelles : scripts/portraits/overrides.json
 *   { "<identityId>": { "frwiki": "Titre exact" } }   article frwiki imposé
 *   { "<identityId>": { "qid": "Q123" } }             élément Wikidata imposé
 *   { "<identityId>": { "none": true } }              aucun portrait
 *   Clés optionnelles, combinables avec frwiki / qid :
 *   "file": "Nom.jpg"   image Commons imposée (vaut validation du sujet) ; accepte
 *                       une liste, essayée dans l'ordre ; sans frwiki/qid, aucun
 *                       article n'est cherché (personnage sans page propre)
 *   "accept": true      garde la correspondance malgré le contrôle de type
 *   "note": "…"         commentaire libre, ignoré
 *
 * Politesse Wikimedia : User-Agent descriptif, requêtes groupées par 50,
 * au plus 1 requête/s, maxlag=5, recul exponentiel sur 429/503/maxlag.
 * Les réponses sont mises en cache par élément (titre, QID, fichier) :
 * une relance ne refait que les requêtes manquantes (--refresh pour tout
 * recharger). Cache : --cache-dir, sinon $PORTRAITS_CACHE_DIR, sinon
 * <tmp>/identite-secrete-portraits-cache.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITIES } from '../../packages/shared/src/data/identities';

// ── Paramètres ─────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_JSON = path.join(ROOT, 'apps/web/public/portraits.json');
const OVERRIDES_FILE = path.join(HERE, 'overrides.json');
const REPORT_FILE = path.join(HERE, 'report.md');

const argv = process.argv.slice(2);
const hasFlag = (n: string) => argv.includes(`--${n}`);
const optVal = (n: string) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a === undefined ? undefined : a.slice(n.length + 3);
};
const REFRESH = hasFlag('refresh');
const VERIFY = hasFlag('verify') || optVal('verify') !== undefined;
const VERIFY_N = Number(optVal('verify') ?? 30) || 30;
const ONLY = optVal('only')?.split(',').filter(Boolean);
const DRY = hasFlag('dry') || !!ONLY;
const CACHE_DIR =
  optVal('cache-dir') ??
  process.env.PORTRAITS_CACHE_DIR ??
  path.join(os.tmpdir(), 'identite-secrete-portraits-cache');

const UA =
  'IdentiteSecrete-portraits/1.0 (https://github.com/hzuconsulting/SecretIdentity; party game credits generator)';
const FR_API = 'https://fr.wikipedia.org/w/api.php';
const WD_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const UPLOAD_PREFIX = 'https://upload.wikimedia.org/wikipedia/commons/';
const THUMB_PREFIX = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';
const MIN_INTERVAL_MS = 1100;
const BATCH = 50;
const MIN_WIDTH = 250;

const REAL_CATEGORIES = new Set(['celebrite', 'sport', 'musique', 'histoire']);
const CATEGORY_ORDER = [
  'disney', 'animation', 'superhero', 'cinema', 'serie', 'jeuvideo',
  'celebrite', 'sport', 'musique', 'histoire', 'fiction',
];

const log = (...a: unknown[]) => console.log(...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── HTTP poli ─────────────────────────────────────────────────────────

let lastRequestAt = 0;
let requestCount = 0;

async function pace() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function retryDelay(res: Response | undefined, attempt: number): number {
  // Recul exponentiel (5 s, 10 s, 20 s… plafonné à 2 min), jamais plus court
  // que le Retry-After annoncé par le serveur.
  const ra = res ? Number(res.headers.get('retry-after')) : NaN;
  const exp = Math.min(120_000, 5000 * 2 ** attempt);
  return Number.isFinite(ra) && ra > 0 ? Math.max(ra * 1000, exp) : exp;
}

async function http(url: string, init: RequestInit = {}, what = url): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await pace();
    requestCount++;
    let res: Response | undefined;
    let err: unknown;
    try {
      res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, 'Api-User-Agent': UA, ...(init.headers ?? {}) },
      });
    } catch (e) {
      err = e;
    }
    if (res && ![429, 500, 502, 503, 504].includes(res.status)) return res;
    if (attempt >= 7) {
      throw new Error(`${what}: abandon (${res ? `HTTP ${res.status}` : String(err)})`);
    }
    const delay = retryDelay(res, attempt);
    log(`  … ${what.slice(0, 80)} : ${res ? `HTTP ${res.status}` : 'erreur réseau'}, nouvel essai dans ${Math.round(delay / 1000)} s`);
    try {
      await res?.body?.cancel();
    } catch {
      /* ignore */
    }
    await sleep(delay);
  }
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(endpoint: string, params: Record<string, string>): Promise<Json> {
  const body = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  for (let attempt = 0; ; attempt++) {
    const url = `${endpoint}?${body.toString()}`;
    const res =
      url.length < 6000
        ? await http(url, {}, `${endpoint} ${params.action}`)
        : await http(
            endpoint,
            {
              method: 'POST',
              body: body.toString(),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            },
            `${endpoint} ${params.action} (POST)`,
          );
    const text = await res.text();
    if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status} ${text.slice(0, 200)}`);
    let j: Json;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error(`${endpoint}: réponse non JSON ${text.slice(0, 200)}`);
    }
    if (j.error) {
      // Le lag de Wikidata (WDQS) dépasse souvent 5 s pendant de longues
      // périodes : on patiente (2 min entre essais) jusqu'à ~1 h plutôt
      // que d'abandonner la passe.
      if (j.error.code === 'maxlag' && attempt < 35) {
        const delay = retryDelay(res, attempt);
        log(`  … maxlag (${j.error.lag ?? '?'} s), nouvel essai dans ${Math.round(delay / 1000)} s`);
        await sleep(delay);
        continue;
      }
      throw new Error(`${endpoint}: ${j.error.code} — ${j.error.info}`);
    }
    return j;
  }
}

interface QueryResult {
  pages: Json[];
  normalized: { from: string; to: string }[];
  redirects: { from: string; to: string; tofragment?: string }[];
}

/** action=query avec suivi de `continue` ; fusionne les pages par titre. */
async function apiQueryAll(endpoint: string, params: Record<string, string>): Promise<QueryResult> {
  const byTitle = new Map<string, Json>();
  const normalized: QueryResult['normalized'] = [];
  const redirects: QueryResult['redirects'] = [];
  let cont: Record<string, string> = {};
  for (let guard = 0; guard < 50; guard++) {
    const j = await api(endpoint, { action: 'query', ...params, ...cont });
    const q = j.query ?? {};
    normalized.push(...(q.normalized ?? []));
    redirects.push(...(q.redirects ?? []));
    for (const p of q.pages ?? []) {
      const prev = byTitle.get(p.title);
      if (!prev) {
        byTitle.set(p.title, p);
        continue;
      }
      for (const [k, v] of Object.entries(p)) {
        if (Array.isArray(v) && Array.isArray(prev[k])) prev[k] = [...prev[k], ...v];
        else if (prev[k] === undefined) prev[k] = v;
      }
    }
    if (!j.continue) break;
    cont = j.continue;
  }
  return { pages: [...byTitle.values()], normalized, redirects };
}

// ── Cache disque par élément ───────────────────────────────────────────

class Store<T> {
  private data: Record<string, T> = {};
  private fresh = new Set<string>();
  constructor(private readonly name: string) {}
  get file() {
    return path.join(CACHE_DIR, `${this.name}.json`);
  }
  async load() {
    try {
      this.data = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
    return this;
  }
  get(k: string): T | undefined {
    if (REFRESH && !this.fresh.has(k)) return undefined;
    return this.data[k];
  }
  peek(k: string): T | undefined {
    return this.data[k];
  }
  set(k: string, v: T) {
    this.data[k] = v;
    this.fresh.add(k);
  }
  async save() {
    const sorted: Record<string, T> = {};
    for (const k of Object.keys(this.data).sort()) sorted[k] = this.data[k];
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(sorted, null, 1));
  }
}

const chunks = <T,>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};
const uniq = <T,>(a: T[]): T[] => [...new Set(a)];

// ── Wikipédia (fr) ─────────────────────────────────────────────────────

interface FrPage {
  req: string;
  title?: string;
  missing?: boolean;
  invalid?: boolean;
  qid?: string;
  disambig?: boolean;
  description?: string;
  pageimage?: string;
  fragment?: string;
  redirected?: boolean;
}

const frPages = new Store<FrPage>('frwiki-pages');
const frLinks = new Store<string[]>('frwiki-links');
const frSearch = new Store<string[]>('frwiki-search');

function resolveRequested(t: string, r: QueryResult): FrPage {
  let cur = t;
  const n = r.normalized.find((x) => x.from === cur);
  if (n) cur = n.to;
  const red = r.redirects.find((x) => x.from === cur);
  let fragment: string | undefined;
  if (red) {
    cur = red.to;
    fragment = red.tofragment || undefined;
  }
  const p = r.pages.find((x) => x.title === cur) ?? r.pages.find((x) => x.invalid && x.title === t);
  if (!p) return { req: t, missing: true };
  if (p.invalid) return { req: t, invalid: true };
  if (p.missing) return { req: t, title: cur, missing: true };
  return {
    req: t,
    title: p.title,
    qid: p.pageprops?.wikibase_item,
    disambig: !!p.pageprops && 'disambiguation' in p.pageprops,
    description: p.description,
    pageimage: p.pageimage,
    fragment,
    redirected: !!red || undefined,
  };
}

async function frLookup(titles: string[]) {
  const need = uniq(titles).filter((t) => !frPages.get(t));
  for (const batch of chunks(need, BATCH)) {
    log(`  frwiki : ${batch.length} titres`);
    const r = await apiQueryAll(FR_API, {
      prop: 'pageprops|pageimages|description',
      ppprop: 'wikibase_item|disambiguation',
      piprop: 'name',
      pilicense: 'free',
      pilimit: '50',
      redirects: '1',
      titles: batch.join('|'),
    });
    for (const t of batch) frPages.set(t, resolveRequested(t, r));
    await frPages.save();
  }
}

async function frLinksLookup(titles: string[]) {
  const need = uniq(titles).filter((t) => !frLinks.get(t));
  for (const batch of chunks(need, BATCH)) {
    log(`  frwiki liens : ${batch.length} pages d'homonymie`);
    const r = await apiQueryAll(FR_API, {
      prop: 'links',
      plnamespace: '0',
      pllimit: 'max',
      titles: batch.join('|'),
    });
    for (const t of batch) {
      const p = r.pages.find((x) => x.title === t);
      frLinks.set(t, uniq((p?.links ?? []).map((l: Json) => l.title as string)));
    }
    await frLinks.save();
  }
}

async function frSearchLookup(q: string): Promise<string[]> {
  const cached = frSearch.get(q);
  if (cached) return cached;
  log(`  frwiki recherche : ${q}`);
  const j = await api(FR_API, {
    action: 'query',
    list: 'search',
    srsearch: q,
    srnamespace: '0',
    srlimit: '8',
    srprop: '',
  });
  const titles = (j.query?.search ?? []).map((s: Json) => s.title as string);
  frSearch.set(q, titles);
  await frSearch.save();
  return titles;
}

// ── Wikidata ───────────────────────────────────────────────────────────

interface Entity {
  id: string;
  missing?: boolean;
  label?: string;
  labelEn?: string;
  desc?: string;
  descEn?: string;
  p18: string[];
  p31: string[];
  frwiki?: string;
}
interface ClassLabel {
  fr?: string;
  en?: string;
}

const wdEntities = new Store<Entity>('wikidata-entities');
const wdLabels = new Store<ClassLabel>('wikidata-class-labels');

function claimValues(e: Json, prop: string): Json[] {
  const claims: Json[] = e.claims?.[prop] ?? [];
  const rank = (c: Json) => (c.rank === 'preferred' ? 0 : c.rank === 'normal' ? 1 : 2);
  return claims
    .filter((c) => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value')
    .sort((a, b) => rank(a) - rank(b))
    .map((c) => c.mainsnak.datavalue?.value)
    .filter((v) => v !== undefined);
}

async function wdLookup(ids: string[]) {
  const need = uniq(ids).filter((id) => !wdEntities.get(id));
  for (const batch of chunks(need, BATCH)) {
    log(`  wikidata : ${batch.length} éléments`);
    const j = await api(WD_API, {
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'claims|descriptions|labels|sitelinks',
      languages: 'fr|en',
      sitefilter: 'frwiki',
    });
    for (const [key, e] of Object.entries<Json>(j.entities ?? {})) {
      if ('missing' in e) {
        wdEntities.set(key, { id: key, missing: true, p18: [], p31: [] });
        continue;
      }
      const rec: Entity = {
        id: e.id,
        label: e.labels?.fr?.value,
        labelEn: e.labels?.en?.value,
        desc: e.descriptions?.fr?.value,
        descEn: e.descriptions?.en?.value,
        p18: claimValues(e, 'P18').map(String),
        p31: claimValues(e, 'P31').map((v: Json) => v.id as string),
        frwiki: e.sitelinks?.frwiki?.title,
      };
      wdEntities.set(e.id, rec);
      if (key !== e.id) wdEntities.set(key, rec);
    }
    for (const id of batch) if (!wdEntities.get(id)) wdEntities.set(id, { id, missing: true, p18: [], p31: [] });
    await wdEntities.save();
  }
}

async function wdLabelLookup(ids: string[]) {
  const need = uniq(ids).filter((id) => !wdLabels.get(id));
  for (const batch of chunks(need, BATCH)) {
    log(`  wikidata libellés : ${batch.length} classes`);
    const j = await api(WD_API, {
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'labels',
      languages: 'fr|en',
    });
    for (const [key, e] of Object.entries<Json>(j.entities ?? {})) {
      const rec = { fr: e.labels?.fr?.value, en: e.labels?.en?.value };
      wdLabels.set(key, rec);
      if (e.id && e.id !== key) wdLabels.set(e.id, rec);
    }
    for (const id of batch) if (!wdLabels.get(id)) wdLabels.set(id, {});
    await wdLabels.save();
  }
}

// ── Commons ────────────────────────────────────────────────────────────

interface FileInfo {
  req: string;
  title?: string;
  missing?: boolean;
  width?: number;
  height?: number;
  mime?: string;
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  meta?: Record<string, string>;
  categories?: string[];
}

const commonsFiles = new Store<FileInfo>('commons-files');

const fileKey = (name: string) => {
  const bare = name.replace(/^(File|Fichier|Image):/i, '').replace(/_/g, ' ').trim();
  return `File:${bare.charAt(0).toUpperCase()}${bare.slice(1)}`;
};

async function commonsLookup(keys: string[]) {
  const need = uniq(keys).filter((k) => !commonsFiles.get(k));
  for (const batch of chunks(need, BATCH)) {
    log(`  commons : ${batch.length} fichiers`);
    const r = await apiQueryAll(COMMONS_API, {
      prop: 'imageinfo|categories',
      iiprop: 'url|size|extmetadata|mime',
      iiurlwidth: '120',
      iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|Credit|UsageTerms|License',
      clshow: '!hidden',
      cllimit: 'max',
      redirects: '1',
      titles: batch.join('|'),
    });
    for (const k of batch) {
      const res = resolveRequested(k, r);
      const p = res.title ? r.pages.find((x) => x.title === res.title) : undefined;
      const ii = p?.imageinfo?.[0];
      if (!p || p.missing || !ii) {
        commonsFiles.set(k, { req: k, missing: true });
        continue;
      }
      const meta: Record<string, string> = {};
      for (const [mk, mv] of Object.entries<Json>(ii.extmetadata ?? {})) meta[mk] = String(mv?.value ?? '');
      commonsFiles.set(k, {
        req: k,
        title: p.title,
        width: ii.width,
        height: ii.height,
        mime: ii.mime,
        url: ii.url,
        thumburl: ii.thumburl,
        descriptionurl: ii.descriptionurl,
        meta,
        categories: (p.categories ?? []).map((c: Json) => String(c.title).replace(/^Category:/, '')),
      });
    }
    await commonsFiles.save();
  }
}

// ── Normalisation de texte ─────────────────────────────────────────────

/** Diacritiques combinants (U+0300 à U+036F), après décomposition NFD. */
const COMBINING = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const deaccent = (s: string) => s.normalize('NFD').replace(COMBINING, '');
const norm = (s: string) =>
  deaccent(s)
    .replace(/[’‘`´]/g, "'")
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
/** Mots seuls : lettres/chiffres séparés par une espace. */
const words = (s: string) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
const stripArticle = (s: string) => s.replace(/^(?:(?:le|la|les|the)\s+|l')/, '');
const core = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '');
const qualifier = (title: string) => title.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
const containsWords = (hay: string, needle: string) => ` ${hay} `.includes(` ${needle} `);
const STOP = new Set(['de', 'du', 'des', 'les', 'la', 'le', 'et', 'the', 'of', 'un', 'une', 'aux', 'au', 'en']);
const tokens = (s: string) => words(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));

const escapeCell = (s: unknown) =>
  String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

// ── Contrôle du type de sujet (P31) ───────────────────────────────────

type Klass = 'human' | 'char' | 'work' | 'lit' | 'place' | 'taxon' | 'name' | 'group' | 'org' | 'thing' | 'other';

const HEADS: Record<Exclude<Klass, 'human' | 'char' | 'other'>, string[]> = {
  work: [
    'film', 'films', 'movie', 'serie', 'series', 'feuilleton', 'show', 'emission', 'programme', 'program',
    'jeu', 'game', 'franchise', 'album', 'chanson', 'song', 'single', 'roman', 'novel', 'livre', 'book',
    'bande', 'comic', 'comics', 'manga', 'anime', 'episode', 'saga', 'oeuvre', 'work', 'court-metrage',
    'long-metrage', 'telefilm', 'sitcom', 'piece', 'play', 'comedie', 'musical', 'opera', 'ballet',
    'spectacle', 'magazine', 'revue', 'journal', 'periodique', 'logiciel', 'software', 'application',
    'site', 'website', 'podcast', 'chaine', 'channel', 'collection', 'univers', 'universe', 'trilogie',
    'trilogy', 'cycle', 'jouet', 'toy', 'marque', 'brand', 'personnalisation', 'dessin', 'webserie',
    'miniserie', 'mini-serie', 'anthologie', 'publication', 'volume', 'numero', 'strip', 'webtoon',
    'saison', 'season', 'meme',
  ],
  lit: [
    'conte', 'fable', 'poeme', 'legende', 'mythe', 'recit', 'nouvelle', 'epopee', 'tale', 'poem',
    'legend', 'myth', 'story', 'fairy',
  ],
  place: [
    'commune', 'ville', 'village', 'municipalite', 'municipality', 'departement', 'department', 'region',
    'pays', 'country', 'etat', 'state', 'province', 'riviere', 'river', 'fleuve', 'lieu', 'place', 'ile',
    'island', 'montagne', 'mountain', 'mont', 'lac', 'lake', 'quartier', 'neighborhood', 'station', 'gare',
    'batiment', 'building', 'edifice', 'rue', 'street', 'avenue', 'parc', 'park', 'chateau', 'castle',
    'eglise', 'church', 'cathedrale', 'cathedral', 'monument', 'localite', 'locality', 'hameau', 'hamlet',
    'canton', 'arrondissement', 'territoire', 'territory', 'capitale', 'capital', 'cite', 'city', 'town',
    'planete', 'planet', 'asteroide', 'asteroid', 'cratere', 'crater', 'settlement', 'stade', 'stadium',
    'aeroport', 'airport', 'musee', 'museum', 'restaurant', 'navire', 'ship', 'bateau',
  ],
  taxon: ['taxon', 'espece', 'sous-espece', 'race', 'species', 'subspecies', 'breed', 'genus', 'cultivar', 'variete'],
  name: ['nom', 'prenom', 'patronyme', 'name', 'surname', 'anthroponyme', 'homonymie', 'disambiguation', 'page'],
  group: [
    'groupe', 'group', 'band', 'duo', 'trio', 'quatuor', 'quartet', 'quintette', 'ensemble', 'orchestre',
    'orchestra', 'fratrie', 'siblings', 'couple', 'famille', 'family', 'dynastie', 'dynasty', 'troupe',
    'collectif', 'collective',
  ],
  org: [
    'entreprise', 'societe', 'company', 'organisation', 'organization', 'association', 'club', 'equipe',
    'team', 'parti', 'party', 'institution', 'federation', 'business', 'label', 'studio', 'maison',
    'editeur', 'publisher', 'prix', 'award', 'distinction', 'recompense',
  ],
  // Objets, notions, phénomènes : jamais le sujet d'un portrait.
  thing: [
    'plat', 'dish', 'langue', 'language', 'peuple', 'ethnie', 'satellite', 'instrument', 'type', 'concept',
    'phenomene', 'phenomenon', 'emotion', 'sentiment', 'feeling', 'modele', 'model', 'mot', 'mot-valise',
    'portmanteau', 'voix', 'pole', 'munition', 'ammunition', 'cartridge', 'odonyme', 'plaine', 'vallee',
    'fete', 'festival', 'bloc', 'principe', 'principle', 'medicament', 'drug', 'gelatine', 'effet', 'effect',
    'biais', 'bias', 'syndrome', 'maladie', 'disease', 'symptome', 'symptom', 'voiture', 'automobile',
    'vehicule', 'vehicle', 'lanceur', 'fusee', 'arme', 'weapon', 'element', 'molecule', 'mineral', 'roche',
    'etoile', 'star', 'galaxie', 'galaxy', 'constellation', 'produit', 'product', 'objet', 'object',
    'outil', 'tool', 'vetement', 'aliment', 'food', 'boisson', 'drink', 'cocktail', 'fromage', 'cheese',
    'sauce', 'facteur', 'factor', 'titre', 'grade', 'mode', 'scene', 'peinture', 'painting', 'tableau',
    'discipline', 'technique', 'danse', 'dance', 'expression', 'locution', 'proverbe', 'coussin', 'meuble',
    'programme de recherche',
  ],
};

const FR_ONLY_THING_HEADS = new Set(['type', 'mode', 'titre', 'grade', 'scene', 'element', 'model', 'star', 'object', 'title']);

/** Une description qui évoque un personnage, une créature ou une figure légendaire. */
const CHARISH_DESC =
  /personnage|character|fictif|fictive|fiction|cr[ée]ature|mytholog|l[ée]gend|\bcontes?\b|h[ée]ro|super|dessin anim|cartoon|mascot|jeu vid[ée]o|video game|comics|manga|anime|bande dessin|pok[ée]mon|folklore|monstre|monster|divinit|dieu|d[ée]esse|deity|\bgod|poup[ée]e|doll|marionnette|puppet|robot|extraterrestre|alien|dragon|fant[ôo]me|ghost|vampire|sorci|\bf[ée]e\b|fairy|lutin|elfe|ogre|g[ée]ant|jouet|toy|mutant|cyborg|antagonist|protagonist|m[ée]chant|villain/i;
const CHAR_SUBSTR = [
  'personnage', 'character', 'fiction', 'fictif', 'fictive', 'fictional', 'super-heros', 'superhero',
  'super-vilain', 'supervillain', 'mascot', 'legend', 'mytholog', 'mythique', 'mythical', 'folklore',
  'deity', 'divinite', 'dieu', 'deesse', 'goddess', ' god', 'creature', 'cryptid', 'monstre', 'monster',
  'demi-dieu', 'demigod', 'heros', 'hero', 'pokemon', 'fantome', 'ghost', 'vampire', 'sorciere', 'witch',
  'fee ', 'fairy', 'gorgon', 'robot', 'android', 'extraterrestre', 'dragon', 'demon', 'titan', 'lutin',
  'mutant', 'kaiju', 'yokai', 'esprit', 'spirit',
];

function classifyLabel(label: string | undefined, lang: 'fr' | 'en'): Klass | undefined {
  if (!label) return undefined;
  const n = norm(label);
  if (n.includes('wikimedia')) return 'name';
  const parts = n.split(/[\s]+/).filter(Boolean);
  const head = (lang === 'fr' ? parts[0] : parts[parts.length - 1]) ?? '';
  if (HEADS.work.includes(head)) return 'work';
  if (HEADS.lit.includes(head) && !n.includes('personnage') && !n.includes('character')) return 'lit';
  if (CHAR_SUBSTR.some((c) => ` ${n} `.includes(c))) return 'char';
  for (const k of ['place', 'taxon', 'name', 'group', 'org', 'thing'] as const) {
    // « tale type », « blood type »… : ces têtes ne valent qu'en français.
    if (k === 'thing' && lang === 'en' && FR_ONLY_THING_HEADS.has(head)) continue;
    if (HEADS[k].includes(head)) return k;
  }
  if (HEADS.thing.some((t) => t.includes(' ') && n.startsWith(t))) return 'thing';
  return 'other';
}

interface TypeInfo {
  classes: Set<Klass>;
  labels: string[];
}

function typeInfo(e: Entity | undefined): TypeInfo {
  const classes = new Set<Klass>();
  const labels: string[] = [];
  for (const c of e?.p31 ?? []) {
    if (c === 'Q5') {
      classes.add('human');
      labels.push('être humain');
      continue;
    }
    const l = wdLabels.peek(c) ?? {};
    const kf = classifyLabel(l.fr, 'fr');
    const ke = classifyLabel(l.en, 'en');
    // Le libellé français tranche ; l'anglais ne sert qu'en l'absence de français.
    const k = kf ?? ke ?? 'other';
    classes.add(k === 'other' && ke && ke !== 'other' ? ke : k);
    labels.push(l.fr ?? l.en ?? c);
  }
  return { classes, labels };
}

type Verdict = { verdict: 'ok' | 'verify' | 'wrong'; reason: string };

function checkType(category: string, e: Entity | undefined, pageDesc?: string): Verdict {
  const desc = [e?.desc, e?.descEn, pageDesc].filter(Boolean).join(' · ');
  const charish = CHARISH_DESC.test(desc);
  if (!e || e.missing) {
    if (REAL_CATEGORIES.has(category) || charish) return { verdict: 'verify', reason: "pas d'élément Wikidata" };
    return { verdict: 'wrong', reason: `pas d'élément Wikidata et rien n'indique un personnage : « ${desc || 'sans description'} »` };
  }
  const { classes, labels } = typeInfo(e);
  const what = labels.join(', ') || 'aucune nature (P31)';
  const has = (k: Klass) => classes.has(k);
  if (REAL_CATEGORIES.has(category)) {
    if (has('human') || has('group')) return { verdict: 'ok', reason: what };
    if (has('char')) return { verdict: 'verify', reason: `figure légendaire/personnage : ${what}` };
    if (['work', 'lit', 'place', 'taxon', 'name', 'org', 'thing'].some((k) => has(k as Klass)))
      return { verdict: 'wrong', reason: `pas une personne : ${what}` };
    return { verdict: 'verify', reason: `nature inattendue : ${what}` };
  }
  if (has('char')) return { verdict: 'ok', reason: what };
  if (has('human')) return { verdict: 'wrong', reason: `personne réelle : ${what}` };
  if (has('work')) return { verdict: 'wrong', reason: `œuvre, pas le personnage : ${what}` };
  if (['place', 'taxon', 'name', 'org', 'thing'].some((k) => has(k as Klass)))
    return { verdict: 'wrong', reason: `autre sujet : ${what}` };
  if (has('group') && !charish) return { verdict: 'wrong', reason: `groupe réel : ${what}` };
  if (has('lit')) return { verdict: 'verify', reason: `œuvre (conte/mythe/légende) : ${what}` };
  if (!charish)
    return { verdict: 'wrong', reason: `rien n'indique un personnage : ${what} — « ${desc || 'sans description'} »` };
  return { verdict: 'verify', reason: `nature inattendue : ${what}` };
}

// ── Choix dans une page d'homonymie ────────────────────────────────────

const CAT_WORDS: Record<string, string[]> = {
  disney: ['disney', 'personnage', 'pixar'],
  animation: ['personnage', 'dessin anime', 'animation', 'pixar', 'dreamworks', 'manga', 'anime', 'bande dessinee', 'comics'],
  superhero: ['marvel', 'dc comics', 'comics', 'super heros', 'super vilain', 'personnage'],
  cinema: ['personnage', 'star wars', 'harry potter', 'tolkien'],
  serie: ['personnage'],
  jeuvideo: ['personnage', 'pokemon', 'nintendo', 'zelda', 'mario', 'sonic', 'sega'],
  fiction: ['personnage', 'conte', 'mythologie', 'legende', 'fiction', 'litterature', 'folklore', 'divinite'],
  musique: [
    'chanteur', 'chanteuse', 'musicien', 'musicienne', 'rappeur', 'rappeuse', 'groupe', 'dj', 'artiste',
    'auteur compositeur', 'compositeur', 'compositrice', 'interprete', 'pianiste', 'guitariste',
    'violoniste', 'musique', 'chanteur francais', 'producteur',
  ],
  sport: [
    'footballeur', 'footballeuse', 'football', 'joueur', 'joueuse', 'athlete', 'basket', 'basketball',
    'tennis', 'cycliste', 'nageur', 'nageuse', 'boxeur', 'boxe', 'pilote', 'rugby', 'handball', 'judoka',
    'judo', 'skieur', 'sportif', 'sportive', 'catcheur', 'catch', 'golfeur', 'patineur', 'gymnaste',
    'perchiste', 'biathlete', 'echecs', 'skateur', 'skateboard',
  ],
  celebrite: [
    'acteur', 'actrice', 'humoriste', 'animateur', 'animatrice', 'presentateur', 'presentatrice', 'mannequin',
    'youtubeur', 'videaste', 'cuisinier', 'chef', 'personnalite', 'realisateur', 'realisatrice', 'cineaste',
    'comedien', 'comedienne', 'styliste', 'couturier', 'entrepreneur', 'explorateur', 'astronaute',
    'magicien', 'illusionniste', 'dessinateur', 'scenariste', 'auteur', 'chanteuse',
  ],
  histoire: [
    'roi', 'reine', 'empereur', 'imperatrice', 'pharaon', 'homme politique', 'militaire', 'general',
    'scientifique', 'physicien', 'physicienne', 'chimiste', 'explorateur', 'navigateur', 'peintre',
    'ecrivain', 'ecrivaine', 'philosophe', 'saint', 'pape', 'president', 'inventeur', 'mathematicien',
    'savant', 'sculpteur', 'poete', 'dramaturge', 'aviateur', 'aviatrice', 'astronaute', 'cosmonaute',
    'pirate', 'espionne', 'revolutionnaire', 'chef', 'roi de france', 'reine de france',
  ],
};
const BAD_QUALIFIER = [
  'film', 'serie televisee', 'serie', 'jeu video', 'album', 'chanson', 'single', 'roman', 'bande dessinee',
  'commune', 'ville', 'village', 'homonymie', 'franchise', 'emission', 'telefilm', 'jeu', 'livre', 'opera',
  'piece', 'revue', 'magazine', 'navire', 'bateau', 'cheval', 'prenom', 'patronyme', 'nom', 'departement',
  'riviere', 'entreprise', 'marque', 'logiciel', 'asteroide', 'court metrage', 'comedie musicale',
];

function pickLink(st: State, links: string[]): string | undefined {
  const b = stripArticle(words(st.bare));
  const hintTok = tokens(st.hint);
  const catWords = CAT_WORDS[st.category] ?? [];
  let best: { t: string; score: number } | undefined;
  for (const t of [...links].sort()) {
    if (st.tried.has(t)) continue;
    const c = stripArticle(words(core(t)));
    const q = words(qualifier(t));
    // Titre exact « Nom (précision) » d'abord ; un titre qui contient le nom
    // (« Wolfgang Amadeus Mozart ») peut aussi être un homonyme (« Gyula Kiss »).
    let score: number;
    if (c === b) score = q ? 2 : 0;
    else if (containsWords(c, b)) score = 0;
    else continue;
    const full = words(t);
    for (const h of hintTok) if (containsWords(full, h)) score += 5;
    let catHit = false;
    for (const w of catWords) if (containsWords(q, w)) catHit = true;
    if (catHit) score += 3;
    if (!catHit && BAD_QUALIFIER.some((w) => containsWords(q, w))) score -= 6;
    if (score >= 3 && (!best || score > best.score)) best = { t, score };
  }
  return best?.t;
}

function searchAcceptable(st: State, t: string): boolean {
  const b = stripArticle(words(st.bare));
  const c = stripArticle(words(core(t)));
  if (!c) return false;
  if (c === b || containsWords(c, b)) return true;
  if (containsWords(b, c) && c.length >= 3) {
    const q = tokens(qualifier(t));
    return q.some((w) => tokens(st.hint).includes(w));
  }
  return false;
}

// ── Résolution des identités ───────────────────────────────────────────

interface Override {
  frwiki?: string;
  qid?: string;
  none?: boolean;
  /** Fichier(s) Commons imposé(s), essayés dans l'ordre (licence et taille restent vérifiées). */
  file?: string | string[];
  accept?: boolean;
  note?: string;
}

interface Attempt {
  title: string;
  via: string;
  outcome: string;
}

interface State {
  id: string;
  name: string;
  category: string;
  bare: string;
  hint: string;
  override?: Override;
  queue: { title: string; via: string }[];
  tried: Set<string>;
  attempts: Attempt[];
  disambigs: string[];
  linksUsed: Set<string>;
  homonymieTried: boolean;
  searched: boolean;
  wrong?: { title: string; qid?: string; desc?: string; reason: string };
  sectionRedirect?: string;
  done: boolean;
  // Résultat
  page?: FrPage;
  entity?: Entity;
  via?: string;
  typeVerdict?: Verdict;
  fail?: 'none' | 'not-found' | 'disambiguation' | 'suspicious' | 'section';
}

function makeState(identity: { id: string; name: string; category: string }, ov?: Override): State {
  const m = identity.name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const bare = (m ? m[1] : identity.name).replace(/’/g, "'");
  const hint = m ? m[2] : '';
  const st: State = {
    id: identity.id,
    name: identity.name,
    category: identity.category,
    bare,
    hint,
    override: ov,
    queue: [],
    tried: new Set(),
    attempts: [],
    disambigs: [],
    linksUsed: new Set(),
    homonymieTried: false,
    searched: false,
    done: false,
  };
  if (ov?.none) {
    st.done = true;
    st.fail = 'none';
    return st;
  }
  if (ov?.file && !ov.frwiki && !ov.qid) {
    // Image imposée sans article (personnage sans page frwiki propre).
    st.done = true;
    st.via = 'override (fichier)';
    st.typeVerdict = { verdict: 'ok', reason: 'image imposée' };
    return st;
  }
  if (ov?.frwiki) st.queue.push({ title: ov.frwiki, via: 'override' });
  else if (!ov?.qid) {
    const full = identity.name.replace(/’/g, "'");
    if (m) st.queue.push({ title: full, via: 'nom complet' });
    st.queue.push({ title: bare, via: m ? 'nom sans précision' : 'nom' });
  }
  return st;
}

const describe = (p: FrPage | undefined, e: Entity | undefined) =>
  e?.desc ?? p?.description ?? e?.descEn ?? '';

async function resolveAll(states: State[]) {
  // Éléments imposés par QID : on part de Wikidata.
  const qidStates = states.filter((s) => !s.done && s.override?.qid);
  if (qidStates.length) {
    await wdLookup(qidStates.map((s) => s.override!.qid!));
    for (const s of qidStates) {
      const e = wdEntities.get(s.override!.qid!);
      s.entity = e;
      if (e?.frwiki) s.queue.push({ title: e.frwiki, via: 'override (qid)' });
      else {
        s.done = true;
        s.via = 'override (qid)';
        s.typeVerdict = { verdict: 'ok', reason: 'imposé' };
      }
    }
  }

  for (let round = 1; round <= 12; round++) {
    // 1. Expansion des identités sans candidat.
    const empty = states.filter((s) => !s.done && s.queue.length === 0);
    if (empty.length) {
      await frLinksLookup(empty.flatMap((s) => s.disambigs.filter((d) => !s.linksUsed.has(d))));
      for (const s of empty) {
        while (!s.done && s.queue.length === 0) {
          const pending = s.disambigs.filter((d) => !s.linksUsed.has(d));
          if (pending.length) {
            for (const d of pending) {
              s.linksUsed.add(d);
              const t = pickLink(s, frLinks.get(d) ?? frLinks.peek(d) ?? []);
              if (t) s.queue.push({ title: t, via: `homonymie « ${d} »` });
            }
            continue;
          }
          if (!s.homonymieTried && s.wrong && !s.override) {
            s.homonymieTried = true;
            const t = `${s.bare.charAt(0).toUpperCase()}${s.bare.slice(1)} (homonymie)`;
            if (!s.tried.has(t)) s.queue.push({ title: t, via: 'page (homonymie)' });
            continue;
          }
          if (!s.searched && !s.override) {
            s.searched = true;
            const queries = s.hint ? [`${s.bare} ${s.hint}`, s.bare] : [s.bare];
            for (const q of queries) {
              const found = (await frSearchLookup(q)).filter((t) => !s.tried.has(t) && searchAcceptable(s, t));
              for (const t of found.slice(0, 3)) s.queue.push({ title: t, via: `recherche « ${q} »` });
              if (found.length) break;
            }
            continue;
          }
          s.done = true;
          s.fail = s.wrong ? 'suspicious' : s.disambigs.length ? 'disambiguation' : s.sectionRedirect ? 'section' : 'not-found';
        }
      }
    }

    const active = states.filter((s) => !s.done && s.queue.length > 0);
    if (!active.length) break;
    log(`Tour ${round} : ${active.length} identités à résoudre`);

    // 2. Un candidat par identité.
    const picks = new Map<State, { title: string; via: string }>();
    for (const s of active) {
      let c = s.queue.shift();
      while (c && s.tried.has(c.title)) c = s.queue.shift();
      if (!c) continue;
      s.tried.add(c.title);
      picks.set(s, c);
    }
    await frLookup([...picks.values()].map((c) => c.title));
    const qids = [...picks.values()]
      .map((c) => frPages.get(c.title) ?? frPages.peek(c.title))
      .filter((p) => p && !p.missing && !p.disambig && !p.fragment && p.qid)
      .map((p) => p!.qid!);
    await wdLookup(qids);
    await wdLabelLookup(qids.flatMap((q) => (wdEntities.get(q) ?? wdEntities.peek(q))?.p31 ?? []));

    // 3. Évaluation.
    for (const [s, c] of picks) {
      const p = frPages.get(c.title) ?? frPages.peek(c.title)!;
      if (p.missing || p.invalid) {
        s.attempts.push({ ...c, outcome: 'absent' });
        if (c.via === 'override') {
          s.done = true;
          s.fail = 'not-found';
        }
        continue;
      }
      if (p.disambig) {
        s.attempts.push({ ...c, outcome: `homonymie (${p.title})` });
        if (!s.disambigs.includes(p.title!)) s.disambigs.push(p.title!);
        continue;
      }
      if (p.fragment && c.via !== 'override') {
        s.attempts.push({ ...c, outcome: `redirige vers une section : ${p.title}#${p.fragment}` });
        s.sectionRedirect ??= `${p.title}#${p.fragment}`;
        continue;
      }
      const e = s.override?.qid ? s.entity : p.qid ? wdEntities.get(p.qid) ?? wdEntities.peek(p.qid) : undefined;
      const accepted = s.override?.accept || s.override?.file || s.override?.qid;
      const v: Verdict = accepted ? { verdict: 'ok', reason: 'validé par override' } : checkType(s.category, e, p.description);
      if (v.verdict === 'wrong') {
        s.attempts.push({ ...c, outcome: `rejeté : ${v.reason}` });
        s.wrong ??= { title: p.title!, qid: e?.id, desc: describe(p, e), reason: v.reason };
        if (c.via === 'override') {
          s.done = true;
          s.fail = 'suspicious';
        }
        continue;
      }
      s.attempts.push({ ...c, outcome: `retenu (${p.title})` });
      s.done = true;
      s.page = p;
      s.entity = e;
      s.via = c.via;
      s.typeVerdict = v;
    }
  }
  for (const s of states) {
    if (!s.done) {
      s.done = true;
      s.fail = s.wrong ? 'suspicious' : 'not-found';
    }
  }
}

// ── Images & crédits ───────────────────────────────────────────────────

const RASTER = /\.(jpe?g|png|webp|gif)$/i;
const BAD_NAME_WORDS = new Set([
  'logo', 'logos', 'logotype', 'wordmark', 'signature', 'signatures', 'autograph', 'blason', 'blasons',
  'flag', 'flags', 'drapeau', 'drapeaux', 'carte', 'cartes', 'map', 'maps', 'affiche', 'affiches',
  'poster', 'posters',
]);
const BAD_NAME_PHRASES = ['coat of arms', 'coats of arms'];
const BAD_CATEGORY_WORDS = new Set([
  'poster', 'posters', 'affiche', 'affiches', 'logo', 'logos', 'wordmark', 'wordmarks', 'signature',
  'signatures', 'autographs', 'flags', 'maps',
]);

function badNameReason(name: string): string | undefined {
  const w = words(name.replace(/\.[a-z0-9]+$/i, ''));
  const hit = w.split(' ').find((x) => BAD_NAME_WORDS.has(x)) ?? BAD_NAME_PHRASES.find((p) => containsWords(w, p));
  return hit ? `nom de fichier suspect (« ${hit} »)` : undefined;
}

function badCategoryReason(cats: string[]): string | undefined {
  for (const c of cats) {
    const w = words(c);
    const hit = w.split(' ').find((x) => BAD_CATEGORY_WORDS.has(x)) ?? BAD_NAME_PHRASES.find((p) => containsWords(w, p));
    if (hit) return `catégorie Commons « ${c} »`;
  }
  return undefined;
}

function licenseOk(short: string): boolean {
  const t = short.trim().replace(/\s+/g, ' ');
  if (!t) return false;
  if (/\b(nc|nd)\b/i.test(t)) return false;
  if (/^public domain\b/i.test(t) || /^domaine public\b/i.test(t)) return true;
  if (/^pd(?:[- ]|$)/i.test(t)) return true;
  if (/^cc[- ]?0\b/i.test(t) || /^cc[- ]zero\b/i.test(t)) return true;
  return /^cc[- ]by(?:[- ]sa)?(?:[- ]\d(?:\.\d)?)?(?:[- ](?:[a-z]{2,3}|igo|migrated|au|us))?$/i.test(t);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function cleanArtist(html: string | undefined): string {
  let s = html ?? '';
  // Doublons masqués (« Unknown author<span style="display:none">Unknown author</span> »).
  s = s.replace(/<(\w+)[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<span[^>]*class="[^"]*signature-talk[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ');
  // Modèle {{Creator}} : ne garder que le nom (premier élément identifié).
  const creator = s.match(/<(?:bdi|span)[^>]*id="creator"[^>]*>([\s\S]*?)<\/(?:bdi|span)>/i);
  if (creator) s = creator[1];
  else if (/<(?:div|table)\b/i.test(s)) {
    const bdi = s.match(/<bdi[^>]*>([\s\S]*?)<\/bdi>/i);
    if (bdi) s = bdi[1];
    // Bloc « fn value » : la première ligne est le nom, la suite une notice.
    else if (/class="fn value"/.test(s)) s = s.replace(/<br\s*\/?>[\s\S]*$/i, '');
  }
  s = s
    .replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/gi, ' ')
    .replace(/<(?:br|\/li|\/p)\s*\/?>/gi, ' ; ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s).replace(/\s+/g, ' ').trim();
  // Encadrés « This photograph was taken by X and released… ».
  if (s.length > 80) {
    const by =
      s.match(/\b(?:taken|photographed|created|made|drawn|shot) by ([^.;]+?)(?= and released| and is| under|\.|;|$)/i) ??
      s.match(/\bwork by (?:Wikipedia and Wikimedia Commons )?users? ([^.;]+)/i);
    if (by) s = by[1];
  }
  s = s
    .replace(/\{\{\s*user\w*\s*\|\s*([^}|]+?)\s*\}\}/gi, '$1')
    .replace(/^No machine-readable author provided\.\s*(.+?) assumed \(based on copyright claims\)\.?$/i, '$1')
    .replace(/(?<![^\s*])(?:File:)?[^\s:;*][^:;]*?\.(?:jpe?g|png|gif|tiff?|svg|djvu|webp)\s*:\s*\*?\s*/gi, ' ')
    .replace(/\s*\[\d+\]/g, '')
    .replace(/\s*\((?:talk|discuter|discussion|contribs)?\s*\)/gi, '')
    .replace(/[,;]?\s*based on File:.*$/i, '');
  const noUrl = s.replace(/\s*\bhttps?:\/\/\S+/g, '').replace(/\s+at\s*$/i, '');
  if (noUrl.trim()) s = noUrl;
  s = s
    .replace(/\s*;\s*(?:;\s*)*/g, ' ; ')
    .replace(/^\s*;\s*|\s*;\s*$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim();
  s = s.replace(/^(.+?)(?:\s+\1)+$/, '$1');
  s = uniq(s.split(/\s*;\s*/).filter(Boolean)).join('; ');
  const UNKNOWN =
    /^(?:(?:unknown|anonymous|anonyme|inconnu|auteur inconnu|own work|travail personnel|unknown (?:author|artist|photographer|painter))\b(?: or not provided)?[\s,;/.]*)+$/i;
  if (UNKNOWN.test(s)) s = 'Auteur inconnu';
  s = s.replace(/^(?:Unknown author|Unknown artist|Anonymous)\b\s*/i, 'Auteur inconnu ').replace(/\s+;/g, ';').trim();
  if (/^Auteur inconnu\b/.test(s) && s.length > 60) s = 'Auteur inconnu';
  // Notice trop longue : garder la première phrase.
  if (s.length > 100) {
    const dot = s.indexOf('. ', 10);
    if (dot > 0 && dot < 100) s = s.slice(0, dot);
  }
  if (s.length > 120) s = `${s.slice(0, 117).trimEnd()}…`;
  return s || 'Auteur inconnu';
}

interface Candidate {
  key: string;
  source: 'P18' | 'pageimage' | 'override';
}

interface Portrait {
  f: string;
  h: string;
  a: string;
  l: string;
  u?: string;
  p: string;
}

interface ImageOutcome {
  portrait?: Portrait;
  chosen?: { key: string; source: string; info: FileInfo };
  rejections: { key: string; source: string; reason: string; license?: boolean }[];
}

function evaluateFile(key: string, info: FileInfo | undefined, forced: boolean): { reason?: string; license?: boolean; portrait?: Portrait } {
  const bare = key.replace(/^File:/, '');
  if (!RASTER.test(bare)) return { reason: `format non retenu (${bare.split('.').pop()})` };
  if (!forced) {
    const bn = badNameReason(bare);
    if (bn) return { reason: bn };
  }
  if (!info || info.missing) return { reason: 'absent de Commons (fichier local ou supprimé)' };
  if (!info.url?.startsWith(UPLOAD_PREFIX)) return { reason: 'pas hébergé sur Commons' };
  if (!/^image\/(jpeg|png|gif|webp)$/.test(info.mime ?? '')) return { reason: `type ${info.mime}` };
  if ((info.width ?? 0) < MIN_WIDTH) return { reason: `trop petit (${info.width} px)` };
  if (!forced) {
    const bc = badCategoryReason(info.categories ?? []);
    if (bc) return { reason: bc };
  }
  // L'API renvoie désormais thumb.wikimedia.org (avec des paramètres utm_*) ;
  // le chemin /wikipedia/commons/thumb/… est identique sur upload.wikimedia.org.
  const m = info.thumburl?.match(
    /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/thumb\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+)\/120px-([^/?#]+)(?:[?#].*)?$/,
  );
  if (!m || m[2] !== m[3]) return { reason: `miniature non dérivable (${info.thumburl ?? 'aucune'})` };
  const short = (info.meta?.LicenseShortName ?? '').trim();
  if (!licenseOk(short)) return { reason: `licence « ${short || 'inconnue'} »`, license: true };
  const url = (info.meta?.LicenseUrl ?? '').trim();
  const portrait: Portrait = {
    f: m[2],
    h: m[1],
    a: cleanArtist(info.meta?.Artist),
    l: short.replace(/\s+/g, ' '),
    ...(url ? { u: url.replace(/^\/\//, 'https://') } : {}),
    p: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(info.title!.replace(/ /g, '_'))}`,
  };
  return { portrait };
}

function candidatesFor(s: State): Candidate[] {
  if (s.override?.file) {
    const files = Array.isArray(s.override.file) ? s.override.file : [s.override.file];
    return files.map((f) => ({ key: fileKey(f), source: 'override' as const }));
  }
  const out: Candidate[] = [];
  for (const f of s.entity?.p18 ?? []) out.push({ key: fileKey(f), source: 'P18' });
  if (s.page?.pageimage) out.push({ key: fileKey(s.page.pageimage), source: 'pageimage' });
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
}

const GENERIC_WORDS = new Set([
  'capitaine', 'captain', 'docteur', 'doctor', 'princesse', 'princess', 'prince', 'roi', 'reine', 'king',
  'queen', 'monsieur', 'madame', 'mister', 'miss', 'lord', 'professeur', 'professor', 'comte', 'count',
  'baron', 'saint', 'petit', 'petite', 'grand', 'grande', 'little', 'big', 'personnage', 'character',
  'comics', 'disney', 'marvel', 'film', 'serie', 'series', 'mythologie', 'mythology', 'pixar', 'toy',
  'story', 'agent', 'fee', 'sir', 'dame', 'lady', 'mrs', 'jack', 'john', 'man',
]);

/**
 * Personnages : l'image (nom de fichier + catégories Commons) cite-t-elle le
 * personnage ? Sinon ce peut être l'acteur hors rôle, le créateur, un objet…
 */
function imageMentionsSubject(s: State, info: FileInfo | undefined): boolean {
  const names = [s.bare, s.page?.title ? core(s.page.title) : '', s.entity?.label ?? '', s.entity?.labelEn ?? ''];
  const toks = uniq(names.flatMap(tokens)).filter((t) => !GENERIC_WORDS.has(t));
  if (!toks.length) return true;
  const hay = words([info?.title ?? '', ...(info?.categories ?? [])].join(' '));
  const squashed = hay.replace(/ /g, '');
  return toks.some((t) => containsWords(hay, t) || (t.length >= 5 && squashed.includes(t)));
}

function chooseImage(s: State): ImageOutcome {
  const out: ImageOutcome = { rejections: [] };
  for (const c of candidatesFor(s)) {
    const info = commonsFiles.get(c.key) ?? commonsFiles.peek(c.key);
    const r = evaluateFile(c.key, info, c.source === 'override');
    if (r.portrait) {
      out.portrait = r.portrait;
      out.chosen = { key: c.key, source: c.source, info: info! };
      return out;
    }
    out.rejections.push({ key: c.key, source: c.source, reason: r.reason!, license: r.license });
  }
  return out;
}

// ── Vérification des URL dérivées ──────────────────────────────────────

interface VerifyResult {
  id: string;
  url: string;
  status: number;
  acao: string | null;
  ok: boolean;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function verifySample(portraits: Record<string, Portrait>, n: number): Promise<VerifyResult[]> {
  const rnd = mulberry32(Date.now() & 0xffffffff);
  const shuffle = <T,>(a: T[]): T[] => {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };
  // Tirage aléatoire, avec au moins quelques noms « difficiles » :
  // encodage %XX (accents, parenthèses…) et formats PNG/GIF.
  const ids = shuffle(Object.keys(portraits));
  const tricky = [
    ...ids.filter((id) => portraits[id].f.includes('%')).slice(0, Math.ceil(n / 5)),
    ...ids.filter((id) => /\.(png|gif)$/i.test(portraits[id].f)).slice(0, Math.ceil(n / 10)),
  ];
  const sample = uniq([...tricky, ...ids]).slice(0, n).sort();
  const out: VerifyResult[] = [];
  for (const id of sample) {
    const p = portraits[id];
    for (const w of [120, 250]) {
      const url = `${THUMB_PREFIX}${p.h}/${p.f}/${w}px-${p.f}`;
      const res = await http(url, { method: 'HEAD' }, `HEAD ${w}px ${id}`);
      const acao = res.headers.get('access-control-allow-origin');
      out.push({ id, url, status: res.status, acao, ok: res.status === 200 && acao === '*' });
      log(`  ${res.status} ${acao ?? '-'} ${w}px ${id}`);
    }
  }
  return out;
}

// ── Programme principal ───────────────────────────────────────────────

async function main() {
  const started = Date.now();
  await Promise.all([frPages.load(), frLinks.load(), frSearch.load(), wdEntities.load(), wdLabels.load(), commonsFiles.load()]);
  const overrides: Record<string, Override> = JSON.parse(await fs.readFile(OVERRIDES_FILE, 'utf8'));
  const known = new Set(IDENTITIES.map((i) => i.id));
  const unknownOverrides = Object.keys(overrides).filter((k) => !known.has(k));

  const identities = ONLY ? IDENTITIES.filter((i) => ONLY.includes(i.id)) : IDENTITIES;
  log(`${identities.length} identités · cache ${CACHE_DIR}${REFRESH ? ' (rafraîchi)' : ''}`);
  const states = identities.map((i) => makeState(i, overrides[i.id]));

  await resolveAll(states);

  // Images : récupérer toutes les candidates en une passe groupée.
  await commonsLookup(states.filter((s) => !s.fail).flatMap((s) => candidatesFor(s).map((c) => c.key)));

  const portraits: Record<string, Portrait> = {};
  const outcomes = new Map<State, ImageOutcome>();
  for (const s of states) {
    if (s.fail) continue;
    const o = chooseImage(s);
    outcomes.set(s, o);
    if (o.portrait) portraits[s.id] = o.portrait;
  }
  const sortedPortraits: Record<string, Portrait> = {};
  for (const id of Object.keys(portraits).sort()) sortedPortraits[id] = portraits[id];

  // Vérification (optionnelle) des URL de miniatures.
  const verifyStore = new Store<{ at: string; results: VerifyResult[] }>('verify');
  await verifyStore.load();
  if (VERIFY) {
    log(`Vérification HEAD de ${VERIFY_N} portraits (120 et 250 px)…`);
    const results = await verifySample(sortedPortraits, VERIFY_N);
    verifyStore.set('last', { at: new Date().toISOString(), results });
    await verifyStore.save();
  }

  if (hasFlag('dump')) {
    // Débogage : état détaillé par identité, dans le dossier de cache.
    const dump = states.map((s) => {
      const o = outcomes.get(s);
      return {
        id: s.id, name: s.name, category: s.category, fail: s.fail, via: s.via,
        title: s.page?.title, qid: s.entity?.id, desc: describe(s.page, s.entity),
        verdict: s.typeVerdict?.verdict, reason: s.typeVerdict?.reason, wrong: s.wrong,
        file: o?.chosen?.key, source: o?.chosen?.source, portrait: portraits[s.id],
        rejections: o?.rejections, attempts: s.attempts,
        candidates: s.fail ? [] : candidatesFor(s).map((c) => `${c.source}:${c.key}`),
      };
    });
    await fs.writeFile(path.join(CACHE_DIR, 'states.json'), JSON.stringify(dump, null, 1));
  }

  if (DRY) {
    for (const s of states) {
      const o = outcomes.get(s);
      log(`${s.id} → ${s.page?.title ?? '∅'} [${s.entity?.id ?? ''}] ${s.fail ?? s.typeVerdict?.verdict} ${o?.chosen?.key ?? ''} ${o?.portrait ? `${o.portrait.l} · ${o.portrait.a}` : ''}`);
      for (const a of s.attempts) log(`    · ${a.via} : ${a.title} → ${a.outcome}`);
      for (const r of o?.rejections ?? []) log(`    ✗ ${r.source} ${r.key} : ${r.reason}`);
    }
    log(`(dry) ${Object.keys(portraits).length}/${states.length} portraits, ${requestCount} requêtes, ${Math.round((Date.now() - started) / 1000)} s`);
    return;
  }

  // Sortie JSON : generatedAt conservé si le contenu n'a pas changé.
  let generatedAt = new Date().toISOString();
  try {
    const prev = JSON.parse(await fs.readFile(OUT_JSON, 'utf8'));
    if (JSON.stringify(prev.portraits) === JSON.stringify(sortedPortraits) && prev.generatedAt) generatedAt = prev.generatedAt;
  } catch {
    /* premier passage */
  }
  const json = JSON.stringify({ v: 1, generatedAt, portraits: sortedPortraits });
  await fs.writeFile(OUT_JSON, json);

  const report = buildReport(states, outcomes, sortedPortraits, overrides, unknownOverrides, verifyStore.peek('last'), generatedAt, json.length);
  await fs.writeFile(REPORT_FILE, report);

  log(`${Object.keys(sortedPortraits).length}/${states.length} portraits → ${path.relative(ROOT, OUT_JSON)} (${(json.length / 1024).toFixed(1)} Ko)`);
  log(`Rapport → ${path.relative(ROOT, REPORT_FILE)} · ${requestCount} requêtes · ${Math.round((Date.now() - started) / 1000)} s`);
}

// ── Rapport ────────────────────────────────────────────────────────────

function buildReport(
  states: State[],
  outcomes: Map<State, ImageOutcome>,
  portraits: Record<string, Portrait>,
  overrides: Record<string, Override>,
  unknownOverrides: string[],
  verify: { at: string; results: VerifyResult[] } | undefined,
  generatedAt: string,
  jsonBytes: number,
): string {
  const L: string[] = [];
  const has = (s: State) => !!portraits[s.id];
  const wd = (q?: string) => (q ? `[${q}](https://www.wikidata.org/wiki/${q})` : '—');
  const fr = (t?: string) => (t ? `[${escapeCell(t)}](https://fr.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))})` : '—');
  const table = (head: string[], rows: string[][]) => {
    if (!rows.length) {
      L.push('_Aucune._', '');
      return;
    }
    L.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
    for (const r of rows) L.push(`| ${r.join(' | ')} |`);
    L.push('');
  };
  const byCat = (a: State, b: State) =>
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sorted = [...states].sort(byCat);

  L.push('# Portraits libres — rapport de génération', '');
  L.push(`Généré par \`scripts/portraits/build.ts\` · données du ${generatedAt} · \`apps/web/public/portraits.json\` : ${(jsonBytes / 1024).toFixed(1)} Ko.`, '');
  L.push('Images uniquement issues de Wikimedia Commons, licences acceptées : domaine public, CC0, CC BY, CC BY-SA (toutes versions).', '');
  L.push('Corriger une correspondance : `scripts/portraits/overrides.json` (voir l’en-tête de `build.ts`), puis relancer le script (les requêtes déjà faites sont en cache).', '');

  // Couverture
  L.push('## Couverture', '');
  const cats = CATEGORY_ORDER.filter((c) => states.some((s) => s.category === c));
  for (const c of new Set(states.map((s) => s.category))) if (!cats.includes(c)) cats.push(c);
  const rows: string[][] = [];
  let tot = 0;
  let totP = 0;
  for (const c of cats) {
    const inCat = states.filter((s) => s.category === c);
    const n = inCat.filter(has).length;
    tot += inCat.length;
    totP += n;
    rows.push([c, String(inCat.length), String(n), `${((100 * n) / inCat.length).toFixed(1)} %`]);
  }
  rows.push(['**total**', `**${tot}**`, `**${totP}**`, `**${((100 * totP) / tot).toFixed(1)} %**`]);
  table(['catégorie', 'identités', 'portraits', 'couverture'], rows);

  // Sources et licences
  const srcCount: Record<string, number> = {};
  const licCount: Record<string, number> = {};
  for (const [s, o] of outcomes) {
    if (!o.chosen || !portraits[s.id]) continue;
    srcCount[o.chosen.source] = (srcCount[o.chosen.source] ?? 0) + 1;
    const fam = portraits[s.id].l.replace(/\s+\d.*$/, '').replace(/^PD.*$/i, 'Public domain');
    licCount[fam] = (licCount[fam] ?? 0) + 1;
  }
  L.push('## Sources et licences', '');
  table(
    ['source de l’image', 'portraits'],
    Object.entries(srcCount).sort().map(([k, v]) => [k === 'P18' ? 'Wikidata P18' : k === 'pageimage' ? 'image de page frwiki' : 'override', String(v)]),
  );
  table(['licence (famille)', 'portraits'], Object.entries(licCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => [escapeCell(k), String(v)]));

  const counts = {
    none: states.filter((s) => s.fail === 'none').length,
    suspicious: states.filter((s) => s.fail === 'suspicious').length,
    notFound: states.filter((s) => s.fail === 'not-found' || s.fail === 'section').length,
    disambig: states.filter((s) => s.fail === 'disambiguation').length,
  };
  const noImage = sorted.filter((s) => !s.fail && candidatesFor(s).length === 0);
  const licenseRejected = sorted.filter((s) => {
    const o = outcomes.get(s);
    return !s.fail && o && !o.portrait && o.rejections.length > 0 && o.rejections.some((r) => r.license);
  });
  const imageRejected = sorted.filter((s) => {
    const o = outcomes.get(s);
    return !s.fail && o && !o.portrait && o.rejections.length > 0 && !o.rejections.some((r) => r.license);
  });
  const DIRECT = ['nom', 'nom complet', 'nom sans précision', 'override', 'override (qid)', 'override (fichier)'];
  const reviewReasons = (s: State): string[] => {
    if (!has(s)) return [];
    const o = outcomes.get(s)!;
    const reviewed = !!(s.override?.accept || s.override?.file);
    return [
      s.via && !DIRECT.includes(s.via) ? `via ${s.via}` : '',
      s.typeVerdict?.verdict === 'verify' ? s.typeVerdict.reason : '',
      !reviewed && !REAL_CATEGORIES.has(s.category) && !imageMentionsSubject(s, o.chosen?.info)
        ? 'l’image (nom, catégories Commons) ne cite pas le personnage : acteur hors rôle, créateur, objet ?'
        : '',
    ].filter(Boolean);
  };
  const verifyKept = sorted.filter((s) => reviewReasons(s).length > 0);

  L.push('## Récapitulatif des listes', '');
  table(
    ['liste', 'nombre'],
    [
      ['Correspondance suspecte (exclue)', String(counts.suspicious)],
      ['À vérifier (portrait conservé)', String(verifyKept.length)],
      ['Article introuvable', String(counts.notFound)],
      ['Homonymie non résolue', String(counts.disambig)],
      ['Aucune image libre', String(noImage.length)],
      ['Image rejetée', String(imageRejected.length)],
      ['Licence rejetée', String(licenseRejected.length)],
      ['Exclu par override', String(counts.none)],
    ],
  );

  if (unknownOverrides.length) {
    L.push('## Overrides orphelins', '', 'Ces clés de `overrides.json` ne correspondent à aucune identité :', '');
    for (const k of unknownOverrides) L.push(`- \`${k}\``);
    L.push('');
  }

  L.push('## Correspondance suspecte (exclue)', '');
  L.push('Le sujet trouvé n’a pas la bonne nature (œuvre au lieu du personnage, lieu, autre personne…). Aucun portrait émis. Corriger avec `frwiki`/`qid`, ou `accept: true` si la correspondance est en fait bonne.', '');
  table(
    ['id', 'nom', 'article trouvé', 'Wikidata', 'description', 'motif'],
    sorted
      .filter((s) => s.fail === 'suspicious')
      .map((s) => [`\`${s.id}\``, escapeCell(s.name), fr(s.wrong?.title), wd(s.wrong?.qid), escapeCell(s.wrong?.desc), escapeCell(s.wrong?.reason)]),
  );

  L.push('## À vérifier (portrait conservé)', '');
  L.push(
    'Correspondance trouvée par repli (page d’homonymie, recherche), de nature inhabituelle, ou image qui ne cite pas le personnage. Le portrait est émis ; le relire, puis corriger (`frwiki`, `file`, `none`) ou valider (`accept: true`, ce qui retire l’entrée de cette liste).',
    '',
  );
  table(
    ['id', 'nom', 'article', 'Wikidata', 'description', 'pourquoi', 'image'],
    verifyKept.map((s) => {
      const o = outcomes.get(s)!;
      const why = reviewReasons(s).join(' ; ');
      return [`\`${s.id}\``, escapeCell(s.name), fr(s.page?.title), wd(s.entity?.id), escapeCell(describe(s.page, s.entity)), escapeCell(why), `[${escapeCell(o.chosen!.key)}](${portraits[s.id].p})`];
    }),
  );

  L.push('## Article introuvable', '');
  table(
    ['id', 'nom', 'titres essayés'],
    sorted
      .filter((s) => s.fail === 'not-found' || s.fail === 'section')
      .map((s) => [`\`${s.id}\``, escapeCell(s.name), escapeCell(s.attempts.map((a) => `${a.title} (${a.outcome})`).join(' ; ') || '—')]),
  );

  L.push('## Homonymie non résolue', '');
  table(
    ['id', 'nom', 'page(s) d’homonymie', 'titres essayés'],
    sorted
      .filter((s) => s.fail === 'disambiguation')
      .map((s) => [`\`${s.id}\``, escapeCell(s.name), s.disambigs.map(fr).join(', '), escapeCell(s.attempts.map((a) => `${a.title} (${a.outcome})`).join(' ; '))]),
  );

  L.push('## Aucune image libre', '');
  L.push('Article et élément Wikidata trouvés, mais ni P18 ni image de page libre.', '');
  table(
    ['id', 'nom', 'article', 'Wikidata', 'description'],
    noImage.map((s) => [`\`${s.id}\``, escapeCell(s.name), fr(s.page?.title), wd(s.entity?.id), escapeCell(describe(s.page, s.entity))]),
  );

  L.push('## Image rejetée', '');
  table(
    ['id', 'nom', 'article', 'fichier(s) et motif'],
    imageRejected.map((s) => [
      `\`${s.id}\``,
      escapeCell(s.name),
      fr(s.page?.title),
      escapeCell(outcomes.get(s)!.rejections.map((r) => `${r.key.replace(/^File:/, '')} [${r.source}] : ${r.reason}`).join(' ; ')),
    ]),
  );

  L.push('## Licence rejetée', '');
  table(
    ['id', 'nom', 'article', 'fichier(s) et motif'],
    licenseRejected.map((s) => [
      `\`${s.id}\``,
      escapeCell(s.name),
      fr(s.page?.title),
      escapeCell(outcomes.get(s)!.rejections.map((r) => `${r.key.replace(/^File:/, '')} [${r.source}] : ${r.reason}`).join(' ; ')),
    ]),
  );

  L.push('## Exclu par override', '');
  table(
    ['id', 'nom', 'note'],
    sorted.filter((s) => s.fail === 'none').map((s) => [`\`${s.id}\``, escapeCell(s.name), escapeCell(overrides[s.id]?.note ?? '')]),
  );

  L.push('## Vérification des URL de miniatures', '');
  if (!verify) L.push('_Pas encore exécutée (`--verify`)._', '');
  else {
    const ok = verify.results.filter((r) => r.ok).length;
    const ids = new Set(verify.results.map((r) => r.id));
    L.push(
      `Dernière exécution : ${verify.at} — ${ids.size} portraits tirés au hasard, ${verify.results.length} requêtes HEAD (120 px et 250 px) : **${ok}/${verify.results.length}** en 200 avec \`access-control-allow-origin: *\`.`,
      '',
    );
    const bad = verify.results.filter((r) => !r.ok);
    if (bad.length) table(['id', 'URL', 'statut', 'ACAO'], bad.map((r) => [`\`${r.id}\``, escapeCell(r.url), String(r.status), escapeCell(r.acao ?? '—')]));
  }

  L.push('## Tous les portraits', '');
  L.push('<details><summary>Liste complète (id → fichier, licence, auteur)</summary>', '');
  table(
    ['id', 'article', 'source', 'fichier', 'licence', 'auteur'],
    sorted
      .filter(has)
      .map((s) => {
        const o = outcomes.get(s)!;
        const p = portraits[s.id];
        return [`\`${s.id}\``, fr(s.page?.title), o.chosen!.source, `[${escapeCell(o.chosen!.key.replace(/^File:/, ''))}](${p.p})`, escapeCell(p.l), escapeCell(p.a)];
      }),
  );
  L.push('</details>', '');
  return L.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
