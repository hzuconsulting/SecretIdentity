import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IDENTITY_BY_ID } from '@identite-secrete/shared';

/**
 * Le fichier des portraits, tel qu'il part sur le site.
 *
 * Il est généré hors ligne (`npm run portraits`) depuis Wikidata et Commons, puis
 * corrigé à la main : rien ne garantit qu'une relance ou une retouche le laisse
 * propre. Ces tests le relisent sans réseau et refusent ce qui ne doit jamais
 * atteindre un joueur — une photo sous licence non libre, une clé qui ne
 * correspond à aucun personnage, une adresse de vignette qui ne mènerait nulle part.
 */

interface PortraitEntry {
  f: string;
  h: string;
  a: string;
  l: string;
  u?: string;
  p: string;
  i: string;
}

const file = resolve(__dirname, '../../public/portraits.json');
const imagesDir = resolve(__dirname, '../../public/portraits');
const data = JSON.parse(readFileSync(file, 'utf-8')) as {
  v: number;
  generatedAt: string;
  portraits: Record<string, PortraitEntry>;
};
const entries = Object.entries(data.portraits);

/**
 * Domaine public, CC0, CC BY, CC BY-SA — et rien d'autre. Les clauses NC (pas
 * d'usage commercial) et ND (pas de modification : une vignette recadrée en rond
 * en est une) sont refusées, comme la GFDL seule, qui exigerait de joindre son
 * texte intégral.
 */
function isFreeLicense(license: string): boolean {
  const l = license.trim();
  if (/\b(NC|ND)\b/i.test(l) || /GFDL|GNU/i.test(l)) return false;
  return (
    /^(public domain|domaine public)\b/i.test(l) ||
    /^PD\b/i.test(l) ||
    /^CC0\b/i.test(l) ||
    /^CC BY(-SA)?( \d(\.\d)?)?\b/i.test(l)
  );
}

describe('portraits.json', () => {
  it('porte la version de format attendue par le client', () => {
    expect(data.v).toBe(1);
    expect(Number.isNaN(Date.parse(data.generatedAt))).toBe(false);
  });

  it("n'a de portrait que pour des personnages du catalogue", () => {
    const unknown = entries.map(([id]) => id).filter((id) => !IDENTITY_BY_ID.has(id));
    expect(unknown).toEqual([]);
  });

  it("couvre une bonne part du catalogue (sinon la génération s'est mal passée)", () => {
    expect(entries.length).toBeGreaterThan(IDENTITY_BY_ID.size / 3);
  });

  it("n'emploie que des licences libres", () => {
    const rejected = entries.filter(([, p]) => !isFreeLicense(p.l)).map(([id, p]) => `${id}: ${p.l}`);
    expect(rejected).toEqual([]);
  });

  it('refuse bien ce que la liste blanche doit refuser', () => {
    for (const l of ['CC BY-NC-SA 4.0', 'CC BY-ND 2.0', 'GFDL', 'Fair use', '']) {
      expect(isFreeLicense(l)).toBe(false);
    }
    for (const l of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain', 'PD-US']) {
      expect(isFreeLicense(l)).toBe(true);
    }
  });

  it('crédite un auteur, en texte brut', () => {
    const bad = entries.filter(([, p]) => !p.a.trim() || /[<>]/.test(p.a)).map(([id]) => id);
    expect(bad).toEqual([]);
  });

  it("ne donne que des images matricielles, sans chemin caché dans le nom", () => {
    const bad = entries
      .filter(([, p]) => /[/\\?#\s]/.test(p.f) || !/\.(jpe?g|png|webp|gif)$/i.test(p.f))
      .map(([id, p]) => `${id}: ${p.f}`);
    expect(bad).toEqual([]);
  });

  it('range chaque fichier dans le répertoire de hachage que Commons lui donne', () => {
    // Commons range un fichier sous md5(nom)[0] / md5(nom)[0..2]. Une erreur ici
    // donnerait une vignette 404, et donc une initiale à la place d'un visage.
    const bad = entries
      .filter(([, p]) => {
        const md5 = createHash('md5').update(decodeURIComponent(p.f), 'utf8').digest('hex');
        return p.h !== `${md5[0]}/${md5.slice(0, 2)}`;
      })
      .map(([id, p]) => `${id}: ${p.h} ${p.f}`);
    expect(bad).toEqual([]);
  });

  it('livre une photo pour chaque entrée, et aucune photo orpheline', () => {
    // Une entrée sans fichier donnerait une image cassée, rattrapée par
    // l'initiale ; un fichier sans entrée alourdirait le site pour rien.
    const expected = new Set(entries.map(([id, p]) => `${id}.${p.i}.webp`));
    const onDisk = new Set(readdirSync(imagesDir));
    expect([...expected].filter((name) => !onDisk.has(name))).toEqual([]);
    expect([...onDisk].filter((name) => !expected.has(name))).toEqual([]);
  });

  it("garde des photos légères (c'est tout le site qui les transporte)", () => {
    const heavy = readdirSync(imagesDir)
      .map((name) => ({ name, size: readFileSync(resolve(imagesDir, name)).length }))
      .filter(({ size }) => size > 30_000)
      .map(({ name, size }) => `${name}: ${size}`);
    expect(heavy).toEqual([]);
  });

  it('pointe vers des pages Commons et des licences en https', () => {
    const bad = entries
      .filter(
        ([, p]) =>
          !p.p.startsWith('https://commons.wikimedia.org/') ||
          (p.u !== undefined && !/^https?:\/\//.test(p.u)),
      )
      .map(([id]) => id);
    expect(bad).toEqual([]);
  });
});
