import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IDENTITIES, IDENTITY_BY_ID } from '@identite-secrete/shared';
import { UNSAFE_CHARS } from './portraits';

/**
 * Les descriptions des personnages (D-89), telles qu'elles partent sur le site.
 *
 * Elles sont écrites à la main : ces tests refusent ce qui ne doit jamais
 * atteindre un joueur — un personnage sans sa ligne, une ligne sans personnage,
 * un texte trop long pour la fiche ou mal formé.
 */

/** Au-delà, la ligne ne tient plus d'un coup d'œil. */
const MAX_LENGTH = 70;

const raw = readFileSync(resolve(__dirname, '../data/descriptions.json'), 'utf-8');
const descriptions = JSON.parse(raw) as Record<string, unknown>;
const entries = Object.entries(descriptions);

describe('descriptions.json', () => {
  it('décrit chaque personnage du catalogue', () => {
    const missing = IDENTITIES.map((identity) => identity.id).filter((id) => !(id in descriptions));
    expect(missing).toEqual([]);
  });

  it("ne décrit que des personnages du catalogue", () => {
    const unknown = entries.map(([id]) => id).filter((id) => !IDENTITY_BY_ID.has(id));
    expect(unknown).toEqual([]);
  });

  it("n'a pas deux fois la même clé", () => {
    const keys = [...raw.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]);
    expect(keys.length).toBe(entries.length);
  });

  it('suit l’ordre du catalogue, pour se relire à côté', () => {
    const order = IDENTITIES.map((identity) => identity.id);
    expect(entries.map(([id]) => id)).toEqual(order);
  });

  it('ne tient que sur une ligne courte et propre', () => {
    const problems = entries.flatMap(([id, text]) => {
      if (typeof text !== 'string' || text.length === 0) return [`${id} : vide`];
      const found: string[] = [];
      if (text.length > MAX_LENGTH) found.push(`${text.length} caractères`);
      if (text !== text.trim() || /\s{2}/.test(text)) found.push('espaces en trop');
      if (new RegExp(UNSAFE_CHARS.source).test(text)) found.push('caractère de contrôle');
      if (/\.$/.test(text)) found.push('point final');
      if (text.includes('"')) found.push('guillemet droit');
      if (text[0] !== text[0]!.toLocaleUpperCase('fr')) found.push('minuscule initiale');
      return found.map((problem) => `${id} : ${problem}`);
    });
    expect(problems).toEqual([]);
  });
});
