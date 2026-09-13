import { useSyncExternalStore } from 'react';

/**
 * Une donnée chargée une seule fois par page, à la première demande, puis
 * gardée en mémoire — les portraits (D-85), les descriptions (D-89).
 *
 * Le premier composant qui s'y abonne déclenche le chargement ; les suivants
 * partagent la même promesse. Au rendu statique, la valeur n'existe pas
 * encore : la page part sans elle, et l'hydratation ne diverge pas.
 */
export interface LazyStore<T> {
  /** La valeur, chargée une seule fois. Ne rejette jamais si `fetchValue` ne rejette pas. */
  load(): Promise<T>;
  /** Oublie la valeur chargée. Réservé aux tests. */
  reset(): void;
  /** La valeur, ou `null` tant qu'elle n'est pas arrivée. */
  useValue(): T | null;
}

/**
 * `fetchValue` ne doit **jamais** rejeter : un échec rend une valeur de repli,
 * et ce repli est gardé — on ne relance pas la requête à chaque composant.
 */
export function createLazyStore<T>(fetchValue: () => Promise<T>): LazyStore<T> {
  let pending: Promise<T> | null = null;
  let loaded: T | null = null;
  const listeners = new Set<() => void>();

  function load(): Promise<T> {
    if (!pending) {
      pending = fetchValue().then((value) => {
        loaded = value;
        for (const listener of listeners) listener();
        return value;
      });
    }
    return pending;
  }

  function reset(): void {
    pending = null;
    loaded = null;
    listeners.clear();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    // S'abonner, c'est avoir besoin de la valeur : le premier composant
    // affiché déclenche le chargement, les suivants partagent la même requête.
    void load();
    return () => {
      listeners.delete(listener);
    };
  }

  const getSnapshot = () => loaded;
  const getServerSnapshot = () => null;

  function useValue(): T | null {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  }

  return { load, reset, useValue };
}
