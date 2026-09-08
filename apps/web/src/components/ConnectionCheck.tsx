'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Outcome } from '@/lib/net/selfTest';

type Status = 'checking' | Outcome;

/**
 * Vérification du transport, avant qu'elle ne coûte une partie.
 *
 * Ce n'est pas un gadget. Le jeu n'a plus de serveur à joindre, mais il a
 * toujours trois conditions à remplir : le navigateur doit savoir faire du
 * WebRTC, le service de mise en relation doit répondre, et le canal de données
 * doit réellement transporter les messages. Les trois échouent silencieusement,
 * et sans ce voyant le joueur ne l'apprendrait qu'après avoir tapé son pseudo et
 * attendu ses amis devant un salon qui ne se remplit pas.
 *
 * Le voyant ne dit ici que l'essentiel ; le détail par étape vit sur
 * `/diagnostic`, vers lequel on ne renvoie que quand il y a lieu.
 */
export function ConnectionCheck() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { runTransportSelfTest } = await import('@/lib/net/selfTest');
      const outcome = await runTransportSelfTest();
      if (!cancelled) setStatus(outcome);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dot =
    status === 'ready' ? 'bg-mint' : status === 'checking' ? 'bg-sun' : 'bg-pink';

  const troubled = status !== 'ready' && status !== 'checking';

  return (
    <div className="flex flex-col items-center gap-1">
      <p
        className="flex items-center justify-center gap-2 text-center text-sm text-muted"
        aria-live="polite"
      >
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot}`}
          aria-hidden="true"
        />
        {LABELS[status]}
      </p>

      {troubled ? (
        <Link
          href="/diagnostic"
          className="inline-flex min-h-[44px] items-center font-display text-xs font-extrabold uppercase tracking-widest text-violet"
        >
          Voir le diagnostic détaillé
        </Link>
      ) : null}
    </div>
  );
}

const LABELS: Record<Status, string> = {
  checking: 'Vérification de la connexion…',
  ready: 'Prêt · aucun serveur nécessaire, les téléphones se parlent directement',
  'no-webrtc': 'Ce navigateur ne gère pas les connexions directes.',
  'no-signaling': 'Service de mise en relation injoignable.',
  'no-channel': 'Le canal ne s’ouvre pas sur cet appareil.',
  'no-data': 'Le canal s’ouvre mais ne transporte rien.',
};
