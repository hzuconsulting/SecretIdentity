/**
 * Les portraits, rapatriés à côté du site.
 *
 *   node scripts/portraits/images.mjs [--cache-dir=DIR]
 *
 * Lancé après `build.ts` (c'est ce que fait `npm run portraits`). Pour chaque
 * entrée de `apps/web/public/portraits.json`, il télécharge une fois la
 * vignette Commons, la recadre au carré, la réduit et l'écrit en WebP dans
 * `apps/web/public/portraits/<id>.<empreinte>.webp`. L'empreinte est ajoutée à
 * l'entrée (champ `i`).
 *
 * Pourquoi ne pas charger les vignettes chez Wikimedia pendant la partie : une
 * soirée, ce sont plusieurs téléphones sur le même wifi, donc la même adresse,
 * qui demandent huit photos à chaque manche — de quoi se faire répondre 429.
 * Servies avec le site, elles arrivent comme le reste, et aucun téléphone de
 * joueur ne contacte un tiers.
 *
 * Le nom porte l'empreinte du contenu : une photo changée change d'adresse, et
 * le service worker peut garder les anciennes sans jamais servir une photo
 * périmée.
 *
 * Politesse Wikimedia : User-Agent descriptif, une requête par seconde au plus,
 * recul sur 429/503. Les originaux sont gardés en cache : une relance ne
 * télécharge que les photos nouvelles ou changées.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// `sharp` arrive avec Next (optimisation d'images) : pas de dépendance de plus.
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PUBLIC = path.join(ROOT, 'apps/web/public');
const JSON_FILE = path.join(PUBLIC, 'portraits.json');
const OUT_DIR = path.join(PUBLIC, 'portraits');

/** Côté du carré livré : la grande carte l'affiche à 96 px, soit 192 sur un écran 2×. */
const SIZE = 192;
const QUALITY = 72;
/** Largeur standard de vignette Commons : elle existe déjà en cache chez Wikimedia. */
const SOURCE_WIDTH = 250;

const USER_AGENT =
  'IdentiteSecretePortraits/1.0 (offline thumbnail fetch for a party game; https://github.com/hzuconsulting/SecretIdentity)';

const cacheArg = process.argv.find((a) => a.startsWith('--cache-dir='));
const CACHE_DIR = path.join(
  cacheArg?.slice('--cache-dir='.length) ??
    process.env.PORTRAITS_CACHE_DIR ??
    path.join(os.tmpdir(), 'identite-secrete-portraits-cache'),
  'thumbs',
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (data) => createHash('sha1').update(data).digest('hex');

let lastRequest = 0;

/** Une vignette Commons, depuis le cache ou le réseau (≤ 1 requête/s). */
async function source(entry) {
  const cached = path.join(CACHE_DIR, `${sha1(entry.f)}-${SOURCE_WIDTH}`);
  try {
    return await fs.readFile(cached);
  } catch {
    // Pas encore téléchargée.
  }

  const url = `https://upload.wikimedia.org/wikipedia/commons/thumb/${entry.h}/${entry.f}/${SOURCE_WIDTH}px-${entry.f}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastRequest + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();

    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.ok) {
      const data = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(cached, data);
      return data;
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000 * 2 ** attempt;
      console.log(`  … ${response.status}, nouvel essai dans ${Math.round(delay / 1000)} s`);
      await sleep(delay);
      continue;
    }
    throw new Error(`HTTP ${response.status} ${url}`);
  }
  throw new Error(`abandon après plusieurs refus : ${url}`);
}

async function main() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const data = JSON.parse(await fs.readFile(JSON_FILE, 'utf8'));
  const ids = Object.keys(data.portraits);
  const keep = new Set();
  const failed = [];
  let written = 0;

  for (const [n, id] of ids.entries()) {
    const entry = data.portraits[id];
    try {
      const original = await source(entry);
      const { width = 1, height = 1, orientation = 1 } = await sharp(original).metadata();
      const tall = orientation >= 5 ? width > height : height > width;
      const webp = await sharp(original)
        .rotate()
        // Photo en hauteur — une personne, souvent en pied : on garde le haut,
        // où est la tête. L'« attention » s'y accrochait aux vêtements colorés
        // et coupait les visages. En largeur, elle trouve bien le sujet dans
        // la scène.
        .resize(SIZE, SIZE, { fit: 'cover', position: tall ? 'north' : sharp.strategy.attention })
        .webp({ quality: QUALITY, effort: 6 })
        .toBuffer();

      const i = sha1(webp).slice(0, 10);
      const name = `${id}.${i}.webp`;
      keep.add(name);
      entry.i = i;

      const target = path.join(OUT_DIR, name);
      const exists = await fs.stat(target).then(() => true, () => false);
      if (!exists) {
        await fs.writeFile(target, webp);
        written++;
      }
    } catch (error) {
      // Sans image livrée, pas d'entrée : le personnage garde son initiale.
      console.warn(`  ✗ ${id} : ${error.message}`);
      failed.push(id);
      delete data.portraits[id];
    }
    if ((n + 1) % 50 === 0) console.log(`${n + 1}/${ids.length}`);
  }

  // Les photos qui ne correspondent plus à aucune entrée s'en vont.
  let removed = 0;
  for (const name of await fs.readdir(OUT_DIR)) {
    if (!keep.has(name)) {
      await fs.unlink(path.join(OUT_DIR, name));
      removed++;
    }
  }

  await fs.writeFile(JSON_FILE, JSON.stringify(data));

  const sizes = await Promise.all([...keep].map((name) => fs.stat(path.join(OUT_DIR, name)).then((s) => s.size)));
  const total = sizes.reduce((a, b) => a + b, 0);
  console.log(
    `${keep.size} portraits → apps/web/public/portraits/ (${(total / 1024 / 1024).toFixed(1)} Mo, ` +
      `${(total / keep.size / 1024).toFixed(1)} Ko en moyenne) · ${written} écrits · ${removed} retirés` +
      (failed.length ? ` · ${failed.length} échecs : ${failed.join(', ')}` : ''),
  );
}

await main();
