import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITIES } from '@identite-secrete/shared';
import {
  loadPortraits,
  parsePortraitsFile,
  portraitUrl,
  resetPortraitsCache,
} from './portraits';

/**
 * Les portraits des personnages.
 *
 * `portraits.json` est servi à côté du site, mais rien ne garantit ce qu'il
 * contient le jour où on le lit : un fichier d'une autre version, une entrée
 * trafiquée, une adresse qui sortirait de Commons. Ces tests fixent ce qui en
 * est gardé, l'adresse des vignettes, et qu'une seule requête part par page.
 */

/** Une entrée valide ; les surcharges peuvent la rendre invalide, champs inconnus compris. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    f: 'Tom_Hanks_TIFF_2019.jpg',
    h: 'a/ab',
    a: 'Gage Skidmore',
    l: 'CC BY-SA 3.0',
    u: 'https://creativecommons.org/licenses/by-sa/3.0',
    p: 'https://commons.wikimedia.org/wiki/File:Tom_Hanks_TIFF_2019.jpg',
    ...overrides,
  };
}

function file(portraits: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { v: 1, generatedAt: '2026-09-13T10:00:00.000Z', portraits, ...overrides };
}

describe('lecture du fichier', () => {
  it('garde les entrées valides', () => {
    const noLicenseUrl = entry({ f: 'Marie_Curie_c1920.png', h: '7/7e' });
    delete noLicenseUrl.u;

    const portraits = parsePortraitsFile(
      file({
        'tom-hanks': entry(),
        'marie-curie': noLicenseUrl,
        'emmanuel-macron': entry({ f: 'Emmanuel_Macron_%282017%29.JPG', h: 'f/f0' }),
      }),
    );

    expect(portraits.size).toBe(3);
    expect(portraits.get('tom-hanks')).toEqual(entry());
    expect(portraits.get('marie-curie')?.u).toBeUndefined();
    expect(portraits.get('emmanuel-macron')?.f).toBe('Emmanuel_Macron_%282017%29.JPG');
  });

  it.each([
    ['une autre version', file({ 'tom-hanks': entry() }, { v: 2 })],
    ['un champ inconnu dans l’enveloppe', file({ 'tom-hanks': entry() }, { extra: true })],
    ['une liste au lieu d’un objet', file({}, { portraits: [entry()] })],
    ['sans liste', { v: 1, generatedAt: 'x' }],
    ['un tableau', [entry()]],
    ['null', null],
    ['une chaîne', 'portraits'],
  ])('ne garde rien d’un fichier invalide : %s', (_label, raw) => {
    expect(parsePortraitsFile(raw).size).toBe(0);
  });

  it.each([
    ['un répertoire de hachage qui remonte', { h: '../..' }],
    ['un répertoire de hachage en majuscules', { h: 'A/AB' }],
    ['un répertoire de hachage trop long', { h: 'a/abc' }],
    ['un nom de fichier avec une barre', { f: '../../evil.jpg' }],
    ['un nom de fichier avec une requête', { f: 'x.jpg?y=1.jpg' }],
    ['un nom de fichier avec une ancre', { f: 'x.jpg#.jpg' }],
    ['un nom de fichier avec un schéma', { f: 'javascript:alert(1).jpg' }],
    ['un nom de fichier avec une URL complète', { f: 'https://evil.example/x.jpg' }],
    ['une barre encodée', { f: '..%2F..%2Fevil.jpg' }],
    ['un caractère de contrôle encodé', { f: 'x%0Ay.jpg' }],
    ['un échappement mal formé', { f: 'x%zzy.jpg' }],
    ['des espaces', { f: 'Tom Hanks.jpg' }],
    ['un fichier caché', { f: '..jpg' }],
    ['un SVG, dont la vignette change de nom', { f: 'Logo.svg' }],
    ['un TIFF, dont la vignette change de nom', { f: 'Photo.tif' }],
    ['un nom de fichier qui n’est pas une chaîne', { f: 42 }],
    ['une page qui n’est pas sur Commons', { p: 'https://evil.example/wiki/File:x.jpg' }],
    ['une page qui imite Commons', { p: 'https://commons.wikimedia.org.evil.example/x' }],
    ['une page en http', { p: 'http://commons.wikimedia.org/wiki/File:x.jpg' }],
    ['une page en javascript:', { p: 'javascript:alert(1)' }],
    ['une page avec identifiants', { p: 'https://user:pw@commons.wikimedia.org/wiki/File:x.jpg' }],
    ['une licence en javascript:', { u: 'javascript:alert(1)' }],
    ['une licence en data:', { u: 'data:text/html,<script>alert(1)</script>' }],
    ['un auteur vide', { a: '   ' }],
    ['un auteur démesuré', { a: 'x'.repeat(1_000) }],
    ['une licence vide', { l: '' }],
    ['un champ en plus', { html: '<img src=x onerror=alert(1)>' }],
  ])('écarte une entrée avec %s, et garde les autres', (_label, patch) => {
    const portraits = parsePortraitsFile(file({ bad: entry(patch), 'tom-hanks': entry() }));
    expect(portraits.has('bad')).toBe(false);
    expect(portraits.has('tom-hanks')).toBe(true);
  });

  it.each([['../x'], ['Tom-Hanks'], ['tom_hanks'], ['-tom'], ['tom--hanks'], ['a'.repeat(81)]])(
    'écarte l’identifiant de personnage %s',
    (identityId) => {
      expect(parsePortraitsFile(file({ [identityId]: entry() })).size).toBe(0);
    },
  );

  it('accepte tous les identifiants du catalogue', () => {
    const portraits = Object.fromEntries(IDENTITIES.map((identity) => [identity.id, entry()]));
    expect(parsePortraitsFile(file(portraits)).size).toBe(IDENTITIES.length);
  });

  it('ne se laisse pas polluer par une clé __proto__', () => {
    const raw = JSON.parse(
      `{"v":1,"generatedAt":"x","portraits":{"__proto__":${JSON.stringify(entry())}}}`,
    );
    expect(parsePortraitsFile(raw).size).toBe(0);
    expect(({} as Record<string, unknown>).f).toBeUndefined();
  });

  it('retire de l’auteur les caractères de contrôle et de forçage de sens', () => {
    const rlo = String.fromCharCode(0x202e);
    const bell = String.fromCharCode(7);
    const portraits = parsePortraitsFile(file({ 'tom-hanks': entry({ a: `${rlo}Gage${bell} Skidmore ` }) }));
    expect(portraits.get('tom-hanks')?.a).toBe('Gage Skidmore');
  });

  it('refuse un fichier démesuré', () => {
    const portraits: Record<string, unknown> = {};
    for (let index = 0; index < 5_001; index++) portraits[`p-${index}`] = entry();
    expect(parsePortraitsFile(file(portraits)).size).toBe(0);
  });
});

describe('adresse des vignettes', () => {
  it('suit le schéma des vignettes Commons, nom de fichier inséré tel quel', () => {
    const tom = { f: 'Tom_Hanks_TIFF_2019.jpg', h: 'a/ab' };
    expect(portraitUrl(tom, 120)).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tom_Hanks_TIFF_2019.jpg/120px-Tom_Hanks_TIFF_2019.jpg',
    );
    expect(portraitUrl(tom, 250)).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tom_Hanks_TIFF_2019.jpg/250px-Tom_Hanks_TIFF_2019.jpg',
    );

    const encoded = { f: 'Emmanuel_Macron_%282017%29.jpg', h: 'f/f0' };
    expect(portraitUrl(encoded, 120)).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Emmanuel_Macron_%282017%29.jpg/120px-Emmanuel_Macron_%282017%29.jpg',
    );
  });

  it('reste sur upload.wikimedia.org pour toute entrée acceptée', () => {
    const portraits = parsePortraitsFile(file({ 'tom-hanks': entry() }));
    const url = new URL(portraitUrl(portraits.get('tom-hanks')!, 120));
    expect(url.origin).toBe('https://upload.wikimedia.org');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });
});

describe('chargement', () => {
  beforeEach(() => {
    resetPortraitsCache();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    resetPortraitsCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lit le fichier du site, une seule fois par page', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(file({ 'tom-hanks': entry() }))));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([loadPortraits(), loadPortraits()]);
    const third = await loadPortraits();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/portraits.json', expect.anything());
    expect(first.get('tom-hanks')?.h).toBe('a/ab');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it.each([
    ['un réseau coupé', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['un fichier absent', async () => new Response('Not found', { status: 404 })],
    ['un fichier illisible', async () => new Response('{pas du json')],
    ['un fichier d’une autre version', async () => new Response(JSON.stringify(file({}, { v: 9 })))],
  ])('rend une liste vide sur %s, sans lever d’erreur', async (_label, impl) => {
    const fetchMock = vi.fn(impl);
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadPortraits()).resolves.toEqual(new Map());
    // L'échec est gardé : pas de nouvelle requête à chaque personnage affiché.
    await loadPortraits();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('survit à un fetch qui lève de façon synchrone', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('synchrone');
    });
    await expect(loadPortraits()).resolves.toEqual(new Map());
  });
});
