import { afterEach, describe, expect, it } from 'vitest';
import { loadDescriptions, resetDescriptionsCache, toDescriptionMap } from './descriptions';

/**
 * Les descriptions des personnages (D-89) : ce qui est gardé du fichier, et
 * qu'il n'est chargé qu'une fois par page.
 */

describe('lecture des descriptions', () => {
  it('garde les paires texte → texte', () => {
    const descriptions = toDescriptionMap({
      'mickey-mouse': 'Souris mascotte de Disney',
      simba: '  Lionceau du Roi lion  ',
    });
    expect(descriptions.get('mickey-mouse')).toBe('Souris mascotte de Disney');
    expect(descriptions.get('simba')).toBe('Lionceau du Roi lion');
  });

  it('écarte ce qui n’est pas un texte, et les textes vides', () => {
    const descriptions = toDescriptionMap({ a: 42, b: null, c: '   ', d: { x: 1 }, e: 'Ok' });
    expect([...descriptions.keys()]).toEqual(['e']);
  });

  it.each([[null], [[]], ['texte'], [42], [undefined]])('ne garde rien de %j', (raw) => {
    expect(toDescriptionMap(raw).size).toBe(0);
  });
});

describe('chargement', () => {
  afterEach(() => resetDescriptionsCache());

  it('charge le fichier une seule fois par page', async () => {
    const [first, second] = await Promise.all([loadDescriptions(), loadDescriptions()]);
    const third = await loadDescriptions();

    expect(first.get('mickey-mouse')).toBeTruthy();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});
