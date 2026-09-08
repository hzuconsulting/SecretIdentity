import type { Metadata } from 'next';
import { TransportDiagnostic } from '@/components/TransportDiagnostic';

export const metadata: Metadata = {
  title: 'Diagnostic · Identité Secrète',
};

/**
 * `/diagnostic` — l'écran vers lequel renvoyer quelqu'un dont le jeu ne marche pas.
 *
 * Il n'est lié depuis l'accueil que lorsque le voyant n'est pas au vert : quand
 * tout va bien, il n'a rien à dire.
 */
export default function DiagnosticPage() {
  return <TransportDiagnostic />;
}
