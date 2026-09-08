import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DIFFICULTY_OPTIONS,
  HAND_SIZE_OPTIONS,
  MAX_CLUES_OPTIONS,
  ROUNDS_OPTIONS,
  TIMER_OPTIONS,
} from '../constants';
import {
  createGameSchema,
  fail,
  joinGameSchema,
  ok,
  settingsSchema,
  submitCluesSchema,
  updateSettingsSchema,
} from '../events';
import {
  avatarColor,
  formatCountdown,
  secondsRemaining,
  suggestNickname,
} from '../format';

describe('schémas Zod', () => {
  it('nettoie le pseudo et refuse le vide', () => {
    expect(createGameSchema.parse({ nickname: '  Sarah ' }).nickname).toBe('Sarah');
    expect(createGameSchema.safeParse({ nickname: '   ' }).success).toBe(false);
    expect(createGameSchema.safeParse({ nickname: 'x'.repeat(40) }).success).toBe(false);
  });

  it('normalise le code de partie', () => {
    const parsed = joinGameSchema.parse({ code: ' k7p-4q ', nickname: 'Allan' });
    expect(parsed.code).toBe('K7P4Q');
    expect(joinGameSchema.safeParse({ code: 'ABC', nickname: 'Allan' }).success).toBe(false);
  });

  it('accepte les paramètres par défaut', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('accepte toutes les options proposées dans le salon', () => {
    for (const rounds of ROUNDS_OPTIONS) {
      expect(updateSettingsSchema.safeParse({ rounds }).success).toBe(true);
    }
    for (const clueSeconds of TIMER_OPTIONS) {
      expect(updateSettingsSchema.safeParse({ clueSeconds }).success).toBe(true);
    }
    for (const handSize of HAND_SIZE_OPTIONS) {
      expect(updateSettingsSchema.safeParse({ handSize }).success).toBe(true);
    }
    for (const maxClues of MAX_CLUES_OPTIONS) {
      expect(updateSettingsSchema.safeParse({ maxClues }).success).toBe(true);
    }
    for (const difficulty of DIFFICULTY_OPTIONS) {
      expect(updateSettingsSchema.safeParse({ difficulty }).success).toBe(true);
    }
  });

  it('refuse une valeur hors options', () => {
    expect(updateSettingsSchema.safeParse({ rounds: 7 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ clueSeconds: 15 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({}).success).toBe(false);
  });

  it('refuse une sélection d’indices vide', () => {
    expect(submitCluesSchema.safeParse({ iconIds: [] }).success).toBe(false);
    expect(submitCluesSchema.safeParse({ iconIds: ['fire'] }).success).toBe(true);
  });
});

describe('acquittements', () => {
  it('construit des réponses typées', () => {
    expect(ok({ code: 'K7P4Q' })).toEqual({ ok: true, data: { code: 'K7P4Q' } });

    const failure = fail('GAME_FULL');
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error.code).toBe('GAME_FULL');
      expect(failure.error.message.length).toBeGreaterThan(0);
    }
  });
});

describe('helpers d’affichage', () => {
  it('formate le décompte', () => {
    expect(formatCountdown(62)).toBe('01:02');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5)).toBe('00:00');
  });

  it('calcule les secondes restantes, sans passer sous zéro', () => {
    expect(secondsRemaining(10_000, 4_000)).toBe(6);
    expect(secondsRemaining(1_000, 9_000)).toBe(0);
    expect(secondsRemaining(null, 1_000)).toBeNull();
  });

  it('dérive une couleur d’avatar stable', () => {
    expect(avatarColor('player-1')).toBe(avatarColor('player-1'));
    expect(avatarColor('player-1')).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('suggère un pseudo libre', () => {
    expect(suggestNickname('Sarah', new Set())).toBe('Sarah');
    expect(suggestNickname('Sarah', new Set(['sarah']))).toBe('Sarah2');
    expect(suggestNickname('Sarah', new Set(['sarah', 'sarah2']))).toBe('Sarah3');
  });
});
