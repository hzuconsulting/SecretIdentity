import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, MIN_PLAYERS } from '../constants';
import { formatDuration, formatTimerOption } from '../format';
import { autoClueSeconds, autoGuessSeconds, resolveTimer } from '../phaseTiming';

describe('durées « Auto »', () => {
  it('donnent 1 min 30 pour poser comme pour voter à trois joueurs', () => {
    expect(autoClueSeconds(3)).toBe(90);
    expect(autoGuessSeconds(3)).toBe(90);
  });

  it('à deux, gardent 1 min 30 pour poser mais raccourcissent le vote : un seul boîtier', () => {
    expect(MIN_PLAYERS).toBe(2);
    expect(autoClueSeconds(2)).toBe(90);
    expect(autoGuessSeconds(2)).toBe(65);
  });

  it('croissent avec le nombre de joueurs, le vote plus vite que la pose', () => {
    for (let players = MIN_PLAYERS; players < MAX_PLAYERS; players++) {
      expect(autoClueSeconds(players + 1)).toBeGreaterThanOrEqual(autoClueSeconds(players));
      expect(autoGuessSeconds(players + 1)).toBeGreaterThan(autoGuessSeconds(players));
      expect(autoGuessSeconds(players + 1) - autoGuessSeconds(players)).toBeGreaterThan(
        autoClueSeconds(players + 1) - autoClueSeconds(players),
      );
    }
    // À huit : sept boîtiers à lire, plus de trois minutes et demie.
    expect(autoGuessSeconds(MAX_PLAYERS)).toBe(215);
  });

  it('restent des multiples de 5 s, pour s’afficher proprement', () => {
    for (let players = MIN_PLAYERS; players <= MAX_PLAYERS; players++) {
      expect(autoClueSeconds(players) % 5).toBe(0);
      expect(autoGuessSeconds(players) % 5).toBe(0);
    }
  });

  it('ne tombent jamais sous leur plancher', () => {
    // Poser : même durée qu'à trois. Voter : au moins un boîtier à lire.
    expect(autoClueSeconds(1)).toBe(autoClueSeconds(3));
    expect(autoGuessSeconds(1)).toBe(autoGuessSeconds(2));
  });
});

describe('resolveTimer', () => {
  it('calcule « Auto » selon la phase et le nombre de joueurs', () => {
    expect(resolveTimer('auto', 'clue', 5)).toBe(autoClueSeconds(5));
    expect(resolveTimer('auto', 'guess', 5)).toBe(autoGuessSeconds(5));
  });

  it('laisse une valeur fixe, ou l’absence de limite, telle quelle', () => {
    expect(resolveTimer(120, 'guess', 8)).toBe(120);
    expect(resolveTimer(null, 'clue', 3)).toBeNull();
  });
});

describe('affichage des durées', () => {
  it('passe aux minutes dès 60 s', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(90)).toBe('1 min 30');
    expect(formatDuration(215)).toBe('3 min 35');
    expect(formatDuration(305)).toBe('5 min 05');
  });

  it('nomme les options spéciales du salon', () => {
    expect(formatTimerOption('auto')).toBe('Auto');
    expect(formatTimerOption(null)).toBe('Sans limite');
    expect(formatTimerOption(180)).toBe('3 min');
  });
});
