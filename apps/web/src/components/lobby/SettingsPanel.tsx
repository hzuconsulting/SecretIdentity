'use client';

import { useState } from 'react';
import {
  DIFFICULTY_OPTIONS,
  MAX_PICTOS,
  STARTING_HAND_CARDS,
  TIMER_OPTIONS,
  TOTAL_ROUNDS,
  formatDifficulty,
  formatTimerOption,
  type Settings,
} from '@identite-secrete/shared';

interface SettingsPanelProps {
  settings: Settings;
  canEdit: boolean;
  onChange: (patch: Partial<Settings>) => Promise<unknown>;
}

/**
 * Paramètres de partie.
 *
 * L'hôte modifie, les autres lisent. Aucun état local des valeurs : on affiche
 * toujours ce que le moteur a renvoyé, et un clic déclenche un aller-retour.
 * C'est ce qui garantit que les six téléphones montrent la même chose.
 */
export function SettingsPanel({ settings, canEdit, onChange }: SettingsPanelProps) {
  const [pending, setPending] = useState<keyof Settings | null>(null);

  async function apply<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (!canEdit || settings[key] === value) return;
    setPending(key);
    await onChange({ [key]: value } as Partial<Settings>);
    setPending(null);
  }

  return (
    <section aria-labelledby="reglages-titre">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2
          id="reglages-titre"
          className="font-display text-sm font-extrabold uppercase tracking-widest"
        >
          Réglages
        </h2>
        {!canEdit ? (
          <p className="text-xs font-semibold text-muted">Seul l’hôte peut les changer</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 rounded-card bg-white p-5 shadow-card">
        <Row
          label="Temps pour poser ses pictos"
          options={TIMER_OPTIONS}
          current={settings.clueSeconds}
          format={formatTimerOption}
          disabled={!canEdit || pending === 'clueSeconds'}
          onSelect={(value) => void apply('clueSeconds', value)}
        />
        <Row
          label="Temps pour voter"
          options={TIMER_OPTIONS}
          current={settings.guessSeconds}
          format={formatTimerOption}
          disabled={!canEdit || pending === 'guessSeconds'}
          onSelect={(value) => void apply('guessSeconds', value)}
        />
        <Row
          label="Difficulté des personnages"
          options={DIFFICULTY_OPTIONS}
          current={settings.difficulty}
          format={formatDifficulty}
          disabled={!canEdit || pending === 'difficulty'}
          onSelect={(value) => void apply('difficulty', value)}
        />

        {/*
          Le reste est fixé par les règles du jeu, pas par le salon. L'afficher
          quand même évite la question « où est passé le nombre de manches ? ».
        */}
        <p className="border-t border-ink/5 pt-3 text-xs font-semibold text-muted">
          Fixé par les règles : {TOTAL_ROUNDS} manches · {STARTING_HAND_CARDS} cartes Picto
          par joueur pour toute la partie · 1 à {MAX_PICTOS} pictogrammes par manche.
        </p>
      </div>
    </section>
  );
}

interface RowProps<T> {
  label: string;
  options: readonly T[];
  current: T;
  format: (value: T) => string;
  disabled: boolean;
  onSelect: (value: T) => void;
}

function Row<T extends string | number | null>({
  label,
  options,
  current,
  format,
  disabled,
  onSelect,
}: RowProps<T>) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-2 font-display text-xs font-extrabold uppercase tracking-widest text-muted">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option === current;
          return (
            <button
              key={String(option)}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onSelect(option)}
              className={[
                'min-h-[44px] rounded-full px-4 font-display text-sm font-extrabold',
                'transition-colors duration-150 disabled:cursor-not-allowed',
                active
                  ? 'bg-violet text-white'
                  : 'bg-violet-light text-violet-dark hover:bg-violet/15 disabled:opacity-60',
              ].join(' ')}
            >
              {format(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
