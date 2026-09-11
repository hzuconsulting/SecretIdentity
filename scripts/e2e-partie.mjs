import { chromium } from 'playwright-core';

/**
 * Une vraie partie, deux navigateurs, de bout en bout.
 *
 * Ce script existe parce que les 196 tests unitaires ne couvraient pas ce qui a
 * réellement cassé. Ils exercent le moteur sur un canal en mémoire ; ils ne
 * peuvent rien dire de WebRTC, de la sérialisation sur le fil, ni de
 * l'établissement d'un canal — c'est-à-dire précisément la couche qui a produit
 * les deux pannes de production.
 *
 * Il n'est pas dans `npm test` : il lui faut un serveur de développement et un
 * vrai Chrome installé. C'est un test qu'on lance avant de déployer un
 * changement de transport, pas à chaque sauvegarde.
 *
 * Usage :
 *   npm run dev                 # dans un terminal
 *   npm run test:e2e            # dans un autre
 *   BASE=https://… npm run test:e2e   # contre le site déployé
 */
const BASE = process.env.BASE ?? 'http://localhost:3000';

/**
 * Saisit une valeur en simulant de vraies frappes.
 *
 * `fill()` ne réveille pas toujours l'état React, et une saisie faite avant
 * l'hydratation est écrasée quand le composant contrôlé prend la main. On tape
 * donc caractère par caractère, et on réessaie jusqu'à ce que la valeur tienne.
 */
async function typeAfterHydration(page, selector, value) {
  const field = page.locator(selector);
  await field.waitFor({ state: 'visible', timeout: 20_000 });

  for (let attempt = 0; attempt < 15; attempt++) {
    await field.click();
    await field.press('ControlOrMeta+a').catch(() => {});
    await field.pressSequentially(value, { delay: 40 });
    await page.waitForTimeout(300);
    if ((await field.inputValue()).toUpperCase() === value.toUpperCase()) return;
    await page.waitForTimeout(500);
  }

  throw new Error(`la saisie de ${selector} n'a pas tenu`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });

// Deux contextes = deux `localStorage` = deux joueurs distincts. C'est la même
// contrainte qu'en test manuel : deux onglets d'une même fenêtre partagent leur
// stockage et seraient vus comme un seul joueur.
const hostCtx = await browser.newContext();
const guestCtx = await browser.newContext();
const host = await hostCtx.newPage();
const guest = await guestCtx.newPage();

const erreurs = [];
for (const [nom, page] of [
  ['HÔTE', host],
  ['INVITÉ', guest],
]) {
  page.on('pageerror', (error) => erreurs.push(`[${nom}] ${error.message}`));
}

try {
  // ── L'hôte crée la partie ────────────────────────────────────
  await host.goto(`${BASE}/creer/`, { waitUntil: 'load' });
  await typeAfterHydration(host, '#pseudo', 'Sarah');
  await host.getByRole('button', { name: /créer la partie/i }).click();

  await host.waitForURL(/\/game\/?\?c=/, { timeout: 45_000 });
  const code = new URL(host.url()).searchParams.get('c');
  console.log(`✓ partie créée · code ${code}`);

  await host.waitForFunction(() => /SARAH/i.test(document.body.innerText), undefined, {
    timeout: 30_000,
  });
  console.log('✓ salon affiché chez l’hôte');

  // ── L'invité rejoint ─────────────────────────────────────────
  await guest.goto(`${BASE}/rejoindre/`, { waitUntil: 'load' });
  await typeAfterHydration(guest, '#code', code);
  await typeAfterHydration(guest, '#pseudo', 'Allan');
  await guest.getByRole('button', { name: /rejoindre la partie/i }).click();

  await guest.waitForURL(/\/game\/?\?c=/, { timeout: 45_000 });
  console.log('✓ invité entré dans la partie');

  // ── La diffusion temps réel, dans les deux sens ──────────────
  await host.waitForFunction(() => /ALLAN/i.test(document.body.innerText), undefined, {
    timeout: 30_000,
  });
  console.log('✓ l’hôte voit l’invité, sans rechargement');

  await guest.waitForFunction(() => /SARAH/i.test(document.body.innerText), undefined, {
    timeout: 30_000,
  });
  console.log('✓ l’invité voit l’hôte');

  // ── La trace technique, des deux côtés ───────────────────────
  for (const [nom, page] of [
    ['hôte', host],
    ['invité', guest],
  ]) {
    await page.goto(`${BASE}/diagnostic/`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => /VRAIES PARTIES TENTÉES/i.test(document.body.innerText),
      undefined,
      { timeout: 45_000 },
    );
    const journal = await page.locator('section').nth(1).innerText();
    console.log(`\n─── journal côté ${nom} ───\n${journal}`);
  }

  if (erreurs.length > 0) {
    throw new Error(`erreurs de page :\n${erreurs.join('\n')}`);
  }

  console.log('\n✓ PARTIE JOUÉE DE BOUT EN BOUT');
} finally {
  await browser.close();
}
