'use client';

import { MAX_NICKNAME_LENGTH } from '@identite-secrete/shared';

interface NicknameFieldProps {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  id?: string;
}

export function NicknameField({
  value,
  onChange,
  autoFocus = false,
  id = 'pseudo',
}: NicknameFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block font-display text-xs font-extrabold uppercase tracking-widest text-muted"
      >
        Ton pseudo
      </label>
      <input
        id={id}
        name="nickname"
        type="text"
        value={value}
        autoFocus={autoFocus}
        autoComplete="nickname"
        maxLength={MAX_NICKNAME_LENGTH}
        placeholder="Sarah"
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[56px] w-full rounded-tile bg-white px-4 font-display text-xl font-extrabold shadow-tile placeholder:font-semibold placeholder:text-muted/50"
      />
      <p className="mt-1.5 text-xs text-muted">
        {MAX_NICKNAME_LENGTH} caractères maximum. Il sera visible par tout le monde.
      </p>
    </div>
  );
}
