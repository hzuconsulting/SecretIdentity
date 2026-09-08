'use client';

import { useEffect, useState } from 'react';

type Status = 'checking' | 'ready' | 'no-webrtc' | 'no-signaling';

/**
 * Vérification du transport, avant qu'elle ne coûte une partie.
 *
 * Ce n'est pas un gadget. Le jeu n'a plus de serveur à joindre, mais il a
 * toujours deux conditions à remplir : le navigateur doit savoir faire du
 * WebRTC, et le service de mise en relation doit répondre. Les deux échouent
 * silencieusement — un navigateur trop ancien, un réseau d'entreprise qui filtre
 * — et sans ce voyant, le joueur ne l'apprendrait qu'après avoir tapé son pseudo
 * et attendu ses amis.
 *
 * Le pair ouvert ici est jetable : il est détruit dès la réponse obtenue, et
 * n'a rien à voir avec celui d'une partie.
 */
export function ConnectionCheck() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { openPeer, supportsWebRtc } = await import('@/lib/net/peer');

      if (!supportsWebRtc()) {
        if (!cancelled) setStatus('no-webrtc');
        return;
      }

      try {
        const peer = await openPeer();
        peer.destroy();
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('no-signaling');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dot =
    status === 'ready' ? 'bg-mint' : status === 'checking' ? 'bg-sun' : 'bg-pink';

  const label =
    status === 'ready'
      ? 'Prêt · aucun serveur nécessaire, les téléphones se parlent directement'
      : status === 'checking'
        ? 'Vérification de la connexion…'
        : status === 'no-webrtc'
          ? 'Ce navigateur ne gère pas les connexions directes. Essaie Chrome, Firefox ou Safari à jour.'
          : 'Service de mise en relation injoignable — vérifie ta connexion, ou le pare-feu du réseau.';

  return (
    <p
      className="flex items-center justify-center gap-2 text-center text-sm text-muted"
      aria-live="polite"
    >
      <span
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot}`}
        aria-hidden="true"
      />
      {label}
    </p>
  );
}
