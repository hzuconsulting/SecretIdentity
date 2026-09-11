'use client';

/**
 * Garder l'écran de l'hôte allumé.
 *
 * C'est la fragilité la plus bête et la plus fréquente du pair à pair : le
 * moteur de la partie tourne dans un onglet, et quand l'écran de ce téléphone
 * s'éteint, le système gèle l'onglet. Les minuteurs s'arrêtent, les canaux
 * WebRTC finissent par tomber, et sept personnes regardent un décompte figé
 * parce qu'une huitième a posé son téléphone sur la table.
 *
 * L'API `Screen Wake Lock` demande au système de ne pas éteindre l'écran tant
 * que la page est visible. Elle ne peut rien contre un verrouillage manuel, ni
 * contre un changement d'application — d'où le reste du filet (battement de
 * cœur, reprise, migration).
 *
 * Le verrou est **relâché par le système** à chaque passage en arrière-plan et
 * n'est pas repris tout seul : sans le réabonnement sur `visibilitychange`,
 * il ne tiendrait que jusqu'au premier coup d'œil à une notification.
 *
 * Tout échec est silencieux et sans conséquence. L'API n'existe pas partout,
 * exige un contexte sécurisé, et certains navigateurs la refusent en économie
 * de batterie. Ce n'est qu'un confort : rien ne doit en dépendre.
 */

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;

  const candidate = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return candidate && typeof candidate.request === 'function' ? candidate : null;
}

/** `true` si ce navigateur sait garder l'écran allumé. */
export function supportsWakeLock(): boolean {
  return wakeLockApi() !== null;
}

/**
 * Maintient l'écran allumé jusqu'à l'appel de la fonction rendue.
 *
 * Rend toujours une fonction d'arrêt, même quand le verrou n'a pas pu être
 * obtenu : l'appelant n'a pas à savoir si ça a marché.
 */
export function keepScreenAwake(): () => void {
  const api = wakeLockApi();
  if (api === null || typeof document === 'undefined') return () => {};

  let sentinel: WakeLockSentinelLike | null = null;
  let stopped = false;

  const acquire = (): void => {
    if (stopped || sentinel !== null) return;
    if (document.visibilityState !== 'visible') return;

    void api
      .request('screen')
      .then((granted) => {
        // L'arrêt a pu être demandé pendant l'attente de la promesse.
        if (stopped) {
          void granted.release().catch(() => {});
          return;
        }

        sentinel = granted;
        // Le système relâche le verrou de son côté (écran éteint, onglet caché).
        // On note la perte pour pouvoir le redemander au retour.
        granted.addEventListener('release', () => {
          if (sentinel === granted) sentinel = null;
        });
      })
      .catch(() => {
        // Refus du navigateur : économie de batterie, contexte non sécurisé,
        // geste utilisateur exigé. On s'en passe.
      });
  };

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') acquire();
  };

  document.addEventListener('visibilitychange', onVisible);
  acquire();

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);

    const held = sentinel;
    sentinel = null;
    if (held && !held.released) void held.release().catch(() => {});
  };
}
