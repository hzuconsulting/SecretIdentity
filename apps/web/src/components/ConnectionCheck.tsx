'use client';

import { useEffect, useState } from 'react';
import type { SelfTestResult } from '@/lib/net/selfTest';

type Status = 'checking' | SelfTestResult;

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
 * La troisième condition mérite son test : un canal peut s'ouvrir sans rien
 * laisser passer, et c'est précisément ce qui arrivait sur iPhone.
 *
 * Les pairs ouverts ici sont jetables, détruits dès le verdict rendu.
 */
export function ConnectionCheck() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { runTransportSelfTest } = await import('@/lib/net/selfTest');
      const result = await runTransportSelfTest();
      if (!cancelled) setStatus(result);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dot =
    status === 'ready' ? 'bg-mint' : status === 'checking' ? 'bg-sun' : 'bg-pink';

  return (
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
  );
}

const LABELS: Record<Status, string> = {
  checking: 'Vérification de la connexion…',
  ready: 'Prêt · aucun serveur nécessaire, les téléphones se parlent directement',
  'no-webrtc':
    'Ce navigateur ne gère pas les connexions directes. Vérifie que l’adresse commence par https, et que le mode isolement n’est pas actif.',
  'no-signaling':
    'Service de mise en relation injoignable — vérifie ta connexion, ou le pare-feu du réseau.',
  'no-datachannel':
    'La connexion s’ouvre mais ne transporte rien. Mets ton navigateur à jour, ou essaie-en un autre.',
};
