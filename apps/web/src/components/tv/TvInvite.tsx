'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { tvUrl } from './tvLink';

/**
 * « Afficher sur la télé » — comment brancher un écran de suivi.
 *
 * Ce panneau s'ouvre depuis le menu d'une partie en cours, sur le téléphone
 * d'un joueur. Il n'ouvre donc **pas** l'écran de suivi : l'ouvrir ici
 * remplacerait la partie de celui qui l'a touché par un écran où il ne peut
 * plus jouer. Il donne l'adresse, à copier, à partager, ou à taper sur l'autre
 * appareil — c'est le seul geste qui a du sens depuis ici.
 */
export function TvInvite({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const url = tvUrl(code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Presse-papier refusé (contexte non sécurisé, permission iOS) :
      // l'adresse est affichée en toutes lettres juste au-dessus.
      setCopied(false);
    }
  }

  async function share() {
    const payload = {
      title: 'Identité Secrète',
      text: `Suis la partie ${code} en direct`,
      url,
    };

    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share(payload);
        return;
      } catch {
        // Partage annulé ou refusé : on retombe sur le presse-papier.
      }
    }
    await copy();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card bg-white p-5 shadow-card">
        <p className="text-center text-4xl" aria-hidden="true">
          📺
        </p>
        <p className="mt-2 text-center text-base font-semibold text-ink">
          Ouvre cette adresse sur une télé, un ordinateur ou une tablette : elle affiche le
          score, le temps restant et les personnages, en grand. On regarde sans jouer — la
          page n’occupe aucune place à table et ne montre le numéro de personne.
        </p>

        <p className="mt-4 select-all break-all rounded-tile bg-violet-light px-4 py-3 text-center font-display text-sm font-extrabold text-violet-dark">
          {url}
        </p>

        <div className="mt-4 flex gap-2">
          <Button variant="soft" size="md" onClick={() => void copy()}>
            {copied ? 'Copié !' : 'Copier'}
          </Button>
          <Button variant="accent" size="md" onClick={() => void share()}>
            Partager
          </Button>
        </div>

        <p className="mt-3 text-center text-sm text-muted">
          Plus court à taper à la main&nbsp;: va sur <strong>/tv</strong> et entre le code{' '}
          <strong className="tracking-widest">{code}</strong>.
        </p>
      </div>
    </div>
  );
}
