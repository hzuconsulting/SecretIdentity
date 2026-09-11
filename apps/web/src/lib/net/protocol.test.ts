import { describe, expect, it } from 'vitest';
import {
  MessageTooLargeError,
  encodeMessage,
  parseClientMessage,
  parseHostMessage,
} from './protocol';

/**
 * Le format de fil.
 *
 * Il paraît trivial et il ne l'est pas : c'est la seule chose qui traverse un
 * canal WebRTC, et sa forme est contrainte par un bug de navigateur. PeerJS
 * envoie du binaire dans ses modes `binary` et `json`, que Safari ne parvient
 * pas à émettre — d'où le mode `raw`, et donc d'où cet encodage à la main.
 *
 * Le premier test est celui qui compte : ce qui part doit être une **chaîne**.
 * Le jour où quelqu'un « simplifiera » en laissant PeerJS sérialiser, iPhone
 * cessera silencieusement de fonctionner, et ce test-là le dira.
 */

describe('encodage', () => {
  it('produit une chaîne, jamais du binaire', () => {
    const encoded = encodeMessage({ t: 'req', id: 1, event: 'game:start', payload: {} });

    expect(typeof encoded).toBe('string');
    expect(encoded).not.toBeInstanceOf(Uint8Array);
    expect(encoded).not.toBeInstanceOf(ArrayBuffer);
  });

  it('refuse un message trop gros au lieu de laisser le canal se fermer', () => {
    // Sans découpage automatique en mode `raw`, un envoi trop gros fait échouer
    // `RTCDataChannel.send`, et PeerJS ferme le canal sur cette erreur.
    const enorme = { t: 'evt', event: 'state:update', payload: 'x'.repeat(100_000) } as const;

    expect(() => encodeMessage(enorme)).toThrow(MessageTooLargeError);
  });

  it('laisse passer une vue de jeu réaliste, très en dessous du plafond', () => {
    const view = {
      t: 'evt' as const,
      event: 'state:update',
      payload: {
        phase: 'GUESSING',
        players: Array.from({ length: 8 }, (_, i) => ({
          id: `player-${i}-0123456789abcdef0123456789abcdef`,
          nickname: `Joueur ${i}`,
          score: i * 3,
          connected: true,
          isHost: i === 0,
        })),
        clueSets: Array.from({ length: 8 }, (_, i) => ({
          label: String.fromCharCode(65 + i),
          iconIds: ['lightning', 'castle', 'dragon', 'crown'],
        })),
        yourHand: Array.from({ length: 12 }, (_, i) => `icone-${i}`),
      },
    };

    const encoded = encodeMessage(view);
    expect(encoded.length).toBeLessThan(10_000);
    expect(parseHostMessage(encoded)).not.toBeNull();
  });
});

describe('aller-retour', () => {
  it('restitue une requête à l’identique', () => {
    const message = {
      t: 'req' as const,
      id: 42,
      event: 'clues:submit',
      payload: { iconIds: ['lightning', 'castle'] },
    };

    expect(parseClientMessage(encodeMessage(message))).toEqual(message);
  });

  it('restitue un acquittement, succès comme échec', () => {
    // `as const` n'est pas cosmétique : sans lui `ok` s'élargit en `boolean` et
    // ne correspond plus à l'union discriminée de `Ack`.
    const succes = { t: 'res', id: 7, ack: { ok: true, data: null } } as const;
    const echec = {
      t: 'res',
      id: 8,
      ack: { ok: false, error: { code: 'NOT_HOST', message: 'Seul l’hôte peut faire ça.' } },
    } as const;

    expect(parseHostMessage(encodeMessage(succes))).toEqual(succes);
    expect(parseHostMessage(encodeMessage(echec))).toEqual(echec);
  });

  it('survit aux accents et aux emoji, qui sont partout dans ce jeu', () => {
    const message = {
      t: 'evt' as const,
      event: 'game:toast',
      payload: { message: 'Zoé est déconnecté·e 🎭', tone: 'warning' },
    };

    expect(parseHostMessage(encodeMessage(message))).toEqual(message);
  });
});

describe('validation de l’enveloppe', () => {
  it('rejette ce qui n’est pas une chaîne JSON exploitable', () => {
    for (const raw of [null, undefined, 42, {}, new Uint8Array([1, 2]), '', '{pas du json']) {
      expect(parseClientMessage(raw), String(raw)).toBeNull();
      expect(parseHostMessage(raw), String(raw)).toBeNull();
    }
  });

  it('rejette une enveloppe mal formée', () => {
    // L'hôte reçoit ces octets de navigateurs qu'il ne contrôle pas : tout ce
    // qui ne ressemble pas exactement à une requête doit tomber ici, avant
    // d'atteindre le moteur.
    const rejets = [
      JSON.stringify({ t: 'evt', event: 'x' }),
      JSON.stringify({ t: 'req', id: 'un', event: 'game:start' }),
      JSON.stringify({ t: 'req', id: Number.NaN, event: 'game:start' }),
      JSON.stringify({ t: 'req', id: 1 }),
      JSON.stringify({ t: 'req', id: 1, event: 'x'.repeat(65) }),
    ];

    for (const raw of rejets) expect(parseClientMessage(raw), raw).toBeNull();
  });

  it('rejette un acquittement sans verdict', () => {
    expect(parseHostMessage(JSON.stringify({ t: 'res', id: 1 }))).toBeNull();
    expect(parseHostMessage(JSON.stringify({ t: 'res', id: 1, ack: {} }))).toBeNull();
    expect(parseHostMessage(JSON.stringify({ t: 'res', id: 1, ack: { ok: 'oui' } }))).toBeNull();
  });

  it('accepte un événement sans payload', () => {
    expect(parseHostMessage(JSON.stringify({ t: 'evt', event: 'connect' }))).toEqual({
      t: 'evt',
      event: 'connect',
      payload: undefined,
    });
  });
});

/**
 * Le battement de cœur.
 *
 * Il est au niveau du transport, et pas au niveau du jeu, pour une raison
 * précise : il ne doit traverser ni la table d'événements du moteur, ni les
 * schémas Zod, ni le limiteur de débit. Un battement n'est pas une action du
 * joueur, et le compter comme telle ferait exclure pour abus un joueur qui ne
 * fait que rester connecté.
 */
describe('battement de cœur', () => {
  it('fait l’aller-retour ping/pong', () => {
    const ping = { t: 'ping' as const, at: 1_700_000_000_000 };
    const pong = { t: 'pong' as const, at: 1_700_000_000_000 };

    expect(parseClientMessage(encodeMessage(ping))).toEqual(ping);
    expect(parseHostMessage(encodeMessage(pong))).toEqual(pong);
  });

  it('ne coûte que quelques dizaines d’octets', () => {
    // Envoyé toutes les cinq secondes à chaque joueur : la taille compte.
    expect(encodeMessage({ t: 'ping', at: Date.now() }).length).toBeLessThan(40);
  });

  it('tolère un horodatage absent ou fantaisiste', () => {
    // `at` ne sert qu'au journal : une valeur douteuse ne doit pas faire
    // rejeter le battement, sinon un pair à l'horloge cassée passerait pour mort.
    for (const at of [undefined, 'hier', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseClientMessage(JSON.stringify({ t: 'ping', at }))).toEqual({ t: 'ping', at: 0 });
      expect(parseHostMessage(JSON.stringify({ t: 'pong', at }))).toEqual({ t: 'pong', at: 0 });
    }
  });

  it('ne confond pas un battement avec une requête', () => {
    const ping = parseClientMessage(encodeMessage({ t: 'ping', at: 1 }));

    // Le discriminant est ce qui protège `dispatch` : un battement ne doit
    // jamais atteindre le moteur sous l'apparence d'un événement vide.
    expect(ping?.t).toBe('ping');
    expect(ping).not.toHaveProperty('event');
  });
});

describe('garde en réception', () => {
  it('refuse une chaîne démesurée sans tenter de l’analyser', () => {
    // Le plafond d'émission ne protège que de nos propres bugs. Celui-ci
    // protège d'un pair détraqué : `JSON.parse` sur plusieurs mégaoctets fige
    // l'onglet avant même qu'on ait pu refuser le message.
    const enorme = JSON.stringify({ t: 'evt', event: 'x', payload: 'y'.repeat(200_000) });

    expect(parseHostMessage(enorme)).toBeNull();
    expect(parseClientMessage(enorme)).toBeNull();
  });
});
