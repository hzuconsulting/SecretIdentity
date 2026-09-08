'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { DiagnosticReport, DiagnosticStep } from '@/lib/net/selfTest';
import { Button } from '@/components/ui/Button';

/**
 * Diagnostic du transport, affiché en clair.
 *
 * Il existe pour une raison précise : un joueur sur iPhone n'a pas de console,
 * et personne ne peut inspecter son téléphone à distance depuis un PC. Sans
 * cette page, la seule information remontante est « ça ne marche pas », et on
 * corrige à l'aveugle — ce qui a déjà coûté un aller-retour de trop.
 *
 * D'où le parti pris : montrer l'étape qui échoue et son détail technique, avec
 * un bouton pour tout copier d'un geste.
 */
export function TransportDiagnostic() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setReport(null);
    const { runTransportDiagnostic } = await import('@/lib/net/selfTest');
    setReport(await runTransportDiagnostic());
    setRunning(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(asText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-10">
      <div>
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center font-display text-sm font-extrabold uppercase tracking-widest text-violet"
        >
          ← Accueil
        </Link>
        <h1 className="mt-2 font-display text-4xl font-black uppercase leading-none tracking-tight">
          Diagnostic
        </h1>
        <p className="mt-2 text-base font-semibold text-muted">
          Cet appareil se connecte à lui-même et fait passer un message, comme pendant une
          partie.
        </p>
      </div>

      <section className="rounded-card bg-white p-5 shadow-card">
        {running || !report ? (
          <p className="py-4 text-center font-display text-sm font-extrabold uppercase tracking-widest text-muted">
            Test en cours…
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {report.steps.map((step) => (
              <StepRow key={step.key} step={step} />
            ))}
          </ol>
        )}
      </section>

      {report ? (
        <>
          <p className="rounded-tile bg-white/60 p-4 text-sm font-semibold text-muted">
            {VERDICTS[report.outcome]}
          </p>

          <details className="rounded-tile bg-white/60 p-4 text-sm text-muted">
            <summary className="cursor-pointer font-display text-xs font-extrabold uppercase tracking-widest">
              Contexte technique
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs">
              {report.environment}
            </pre>
          </details>
        </>
      ) : null}

      <div className="mt-auto flex flex-col gap-3">
        <Button onClick={() => void copy()} variant="soft" size="md" disabled={!report}>
          {copied ? 'Copié !' : 'Copier le rapport'}
        </Button>
        <Button onClick={() => void run()} variant="ghost" size="md" disabled={running}>
          Relancer le test
        </Button>
      </div>

      <p className="text-xs text-muted">
        Ce test se fait en boucle sur cet appareil : il ne traverse aucun réseau. Certains
        navigateurs refusent de se connecter à eux-mêmes tout en marchant très bien entre
        deux téléphones — si l’étape « ouverture du canal » échoue, tente quand même une
        vraie partie avant d’en conclure quelque chose.
      </p>
    </main>
  );
}

function StepRow({ step }: { step: DiagnosticStep }) {
  const mark = step.status === 'ok' ? '✓' : step.status === 'failed' ? '✗' : '·';
  const tone =
    step.status === 'ok'
      ? 'text-mint'
      : step.status === 'failed'
        ? 'text-pink'
        : 'text-muted/50';

  return (
    <li className="flex gap-3">
      <span className={`font-display text-lg font-black leading-6 ${tone}`} aria-hidden="true">
        {mark}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-sm font-extrabold uppercase tracking-wide">
          {step.label}
          <span className="sr-only">
            {step.status === 'ok' ? ' : réussi' : step.status === 'failed' ? ' : échec' : ' : non testé'}
          </span>
        </span>
        <span className="block break-words text-xs text-muted">{step.detail}</span>
      </span>
    </li>
  );
}

const VERDICTS: Record<DiagnosticReport['outcome'], string> = {
  ready: 'Tout fonctionne sur cet appareil. Si une partie échoue quand même, c’est le réseau qui sépare les joueurs — mets tout le monde sur le même Wi-Fi.',
  'no-webrtc':
    'Ce navigateur ne fait pas de WebRTC. Vérifie que l’adresse commence par https, et que le mode isolement d’iOS n’est pas actif.',
  'no-signaling':
    'Le service de mise en relation ne répond pas. C’est ta connexion ou le pare-feu du réseau, pas le jeu.',
  'no-channel':
    'Les pairs se trouvent mais le canal ne s’ouvre jamais. C’est une piste réseau (ICE) — et c’est aussi le cas où la boucle locale ment : tente une vraie partie avant de conclure.',
  'no-data':
    'Le canal s’ouvre mais rien ne le traverse. C’est le navigateur qui n’écrit pas sur le canal — le cas le plus grave, et celui qui demande une correction du jeu.',
};

function asText(report: DiagnosticReport): string {
  const lines = report.steps.map(
    (step) =>
      `${step.status === 'ok' ? 'OK  ' : step.status === 'failed' ? 'ÉCHEC' : '—   '} ${step.label} : ${step.detail}`,
  );

  return [`Verdict : ${report.outcome}`, '', ...lines, '', report.environment].join('\n');
}
