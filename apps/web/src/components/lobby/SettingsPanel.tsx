'use client';

import { useState } from 'react';
import {
  DIFFICULTY_OPTIONS,
  HAND_SIZE_OPTIONS,
  MAX_CLUES_OPTIONS,
  ROUNDS_OPTIONS,
  TIMER_OPTIONS,
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
 * toujours ce que le serveur a renvoyé, et un clic déclenche un aller-retour.
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
          label="Manches"
          options={ROUNDS_OPTIONS}
          current={settings.rounds}
          format={(value) => String(value)}
          disabled={!canEdit || pending === 'rounds'}
          onSelect={(value) => void apply('rounds', value)}
        />
        <Row
          label="Temps pour les indices"
          options={TIMER_OPTIONS}
          current={settings.clueSeconds}
          format={formatTimerOption}
          disabled={!canEdit || pending === 'clueSeconds'}
          onSelect={(value) => void apply('clueSeconds', value)}
        />
        <Row
          label="Temps pour deviner"
          options={TIMER_OPTIONS}
          current={settings.guessSeconds}
          format={formatTimerOption}
          disabled={!canEdit || pending === 'guessSeconds'}
          onSelect={(value) => void apply('guessSeconds', value)}
        />
        <Row
          label="Icônes par main"
          options={HAND_SIZE_OPTIONS}
          current={settings.handSize}
          format={(value) => String(value)}
          disabled={!canEdit || pending === 'handSize'}
          onSelect={(value) => void apply('handSize', value)}
        />
        <Row
          label="Indices maximum"
          options={MAX_CLUES_OPTIONS}
          current={settings.maxClues}
          format={(value) => String(value)}
          disabled={!canEdit || pending === 'maxClues'}
          onSelect={(value) => void apply('maxClues', value)}
        />
        <Row
          label="Difficulté"
          options={DIFFICULTY_OPTIONS}
          current={settings.difficulty}
          format={formatDifficulty}
          disabled={!canEdit || pending === 'difficulty'}
          onSelect={(value) => void apply('difficulty', value)}
        />
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
