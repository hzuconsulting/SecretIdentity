import { chromium } from 'playwright-core';

/**
 * Une manche complète, quatre navigateurs : exclusion par l'hôte, plateau de 8,
 * main de 10 cartes, pose vert/rouge, vote nominatif, décompte.
 */
const BASE = process.env.BASE ?? 'http://localhost:3000';

async function typeAfterHydration(page, selector, value) {
  const field = page.locator(selector);
  await field.waitFor({ state: 'visible', timeout: 60_000 });
  for (let attempt = 0; attempt < 15; attempt++) {
    await field.click();
    await field.press('ControlOrMeta+a').catch(() => {});
    await field.pressSequentially(value, { delay: 30 });
    await page.waitForTimeout(250);
    if ((await field.inputValue()).toUpperCase() === value.toUpperCase()) return;
    await page.waitForTimeout(400);
  }
  throw new Error(`la saisie de ${selector} n'a pas tenu`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });
const erreurs = [];

async function newPlayer(nom) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => erreurs.push(`[${nom}] ${e.message}`));
  return page;
}

const ok = (m) => console.log(`\u2713 ${m}`);

try {
  const host = await newPlayer('Sarah');
  const allan = await newPlayer('Allan');
  const malo = await newPlayer('Malo');
  const zoe = await newPlayer('Zoe');

  // -- Creation + jointures ------------------------------------
  await host.goto(`${BASE}/creer/`, { waitUntil: 'load' });
  await typeAfterHydration(host, '#pseudo', 'Sarah');
  await host.getByRole('button', { name: /créer la partie/i }).click();
  await host.waitForURL(/\/game\/?\?c=/, { timeout: 45_000 });
  const code = new URL(host.url()).searchParams.get('c');
  ok(`partie creee - code ${code}`);

  for (const [page, nickname] of [[allan, 'Allan'], [malo, 'Malo'], [zoe, 'Zoe']]) {
    await page.goto(`${BASE}/rejoindre/`, { waitUntil: 'load' });
    await typeAfterHydration(page, '#code', code);
    await typeAfterHydration(page, '#pseudo', nickname);
    await page.getByRole('button', { name: /rejoindre la partie/i }).click();
    await page.waitForURL(/\/game\/?\?c=/, { timeout: 45_000 });
  }
  await host.waitForFunction(() => /ZOE/i.test(document.body.innerText), undefined, {
    timeout: 30_000,
  });
  ok('salon a 4 joueurs');

  // -- Exclusion par l'hote ------------------------------------
  await host.getByRole('button', { name: /Exclure Zoe/i }).click();
  await host.waitForTimeout(300);
  await host.getByRole('button', { name: /^Exclure$/ }).click();

  await zoe.waitForFunction(() => /exclu/i.test(document.body.innerText), undefined, {
    timeout: 20_000,
  });
  ok("l'exclue voit son ecran d'exclusion");

  await host.waitForFunction(() => !/ZOE/i.test(document.body.innerText), undefined, {
    timeout: 20_000,
  });
  ok("l'exclue a disparu du salon");

  await zoe.goto(`${BASE}/rejoindre/`, { waitUntil: 'load' });
  await typeAfterHydration(zoe, '#code', code);
  await typeAfterHydration(zoe, '#pseudo', 'Zoe');
  await zoe.getByRole('button', { name: /rejoindre la partie/i }).click();
  await zoe.waitForFunction(() => /exclu/i.test(document.body.innerText), undefined, {
    timeout: 20_000,
  });
  ok('son retour sous le meme pseudo est refuse');

  // -- Lancement -----------------------------------------------
  const players = [host, allan, malo];
  await host.getByRole('button', { name: /lancer la partie/i }).click();

  for (const page of players) {
    await page.getByRole('heading', { name: /Ta carte Mystère/i }).waitFor({ timeout: 30_000 });
    const cases = await page.locator('section[aria-labelledby="plateau-titre"] li').count();
    if (cases !== 8) throw new Error(`plateau de ${cases} personnages, attendu 8`);
  }
  ok('plateau de 8 personnages chez les 3 joueurs');

  // -- Remplissage du boitier ----------------------------------
  for (const page of players) {
    await page.getByRole('heading', { level: 1, name: /^Ton boîtier$/i }).waitFor({
      timeout: 30_000,
    });

    const faces = page.getByRole('button', { name: /appuie pour poser/i });
    const count = await faces.count();
    // 10 cartes de 4 pictogrammes (deux par face).
    if (count !== 40) throw new Error(`${count} pictogrammes en main, attendu 40 (10 cartes)`);

    await faces.nth(0).click();
    await page.getByRole('radio', { name: /n’est pas représentatif/i }).click();
    // Le 6ᵉ bouton : second pictogramme du recto de la *deuxième* carte. Les
    // quatre premiers appartiennent à la même carte, et y taper changerait
    // simplement de pictogramme au lieu d'en poser un second.
    await faces.nth(5).click();

    await page.getByRole('button', { name: /valider mon boîtier/i }).click();
    await page.getByRole('button', { name: /^Confirmer$/ }).click();
  }
  ok('boitiers remplis (un picto vert, un rouge) et valides');

  // -- Vote ----------------------------------------------------
  for (const page of players) {
    await page.getByRole('heading', { name: /Qui est qui/i }).waitFor({ timeout: 30_000 });

    const selects = page.locator('select[id^="vote-"]');
    const n = await selects.count();
    if (n !== 2) throw new Error(`${n} bulletins, attendu 2`);

    const options = await selects.nth(0).locator('option').count();
    if (options !== 9) throw new Error(`${options} options, attendu 9 (8 numeros + invite)`);

    await selects.nth(0).selectOption('1');
    await selects.nth(1).selectOption('2');
    await page.getByRole('button', { name: /valider mes votes/i }).click();
  }
  ok('votes nominatifs sur 8 numeros, envoyes');

  // -- Decompte ------------------------------------------------
  for (const page of players) {
    await page.getByRole('heading', { name: /Révélation/i }).waitFor({ timeout: 30_000 });
  }
  ok('revelation affichee');

  // Tout le monde voit le dépouillement des votes, une fois la révélation finie.
  for (const page of players) {
    await page.getByRole('button', { name: /tout révéler/i }).click().catch(() => {});
    await page.getByText(/Ce que les autres ont voté/i).first().waitFor({ timeout: 30_000 });
  }
  ok('le detail des votes est affiche a chacun');

  // Pas de minuteur : on attend bien plus longtemps que l'ancienne echeance,
  // et personne ne bouge de la revelation.
  await host.getByRole('button', { name: /^Manche suivante$/i }).waitFor({ timeout: 20_000 });
  await host.waitForTimeout(12_000);
  for (const page of players) {
    await page.getByRole('heading', { name: /Révélation/i }).waitFor({ timeout: 2_000 });
  }
  ok('la revelation reste affichee sans minuteur');

  // Seul l'hote a le bouton ; les autres attendent.
  for (const page of [allan, malo]) {
    if ((await page.getByRole('button', { name: /^Manche suivante$/i }).count()) !== 0) {
      throw new Error('un invite voit le bouton de manche suivante');
    }
    await page.getByText(/L’hôte lancera la manche suivante/i).waitFor({ timeout: 5_000 });
  }
  ok("seul l'hote peut lancer la manche suivante");

  await host.getByRole('button', { name: /^Manche suivante$/i }).click();
  for (const page of players) {
    await page.getByRole('heading', { name: /Ta carte Mystère/i }).waitFor({ timeout: 30_000 });
  }
  ok("l'hote a lance la manche 2");

  await host.getByRole('heading', { level: 1, name: /^Ton boîtier$/i }).waitFor({
    timeout: 30_000,
  });
  const cartes = await host.getByRole('button', { name: /appuie pour poser/i }).count();
  if (cartes !== 32) throw new Error(`${cartes / 4} cartes en main, attendu 8`);
  ok('la main est passee de 10 a 8 cartes');

  // -- Rester dans la partie ----------------------------------
  // Le code reste visible en jeu : c'est ce qui permet a un absent de revenir.
  const spacedCode = code.split('').join(' ');
  await malo
    .getByRole('button', { name: new RegExp(`Code de la partie : ${spacedCode}`) })
    .waitFor({ timeout: 10_000 });
  ok('le code est visible en cours de partie');

  // Les regles s'ouvrent par-dessus la partie : on la retrouve en les fermant.
  await malo.getByRole('button', { name: /^Règles$/ }).first().click();
  await malo.getByRole('dialog').waitFor({ timeout: 5_000 });
  await malo.keyboard.press('Escape');
  await malo.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5_000 });
  await malo
    .getByRole('heading', { level: 1, name: /^Ton boîtier$/i })
    .waitFor({ timeout: 5_000 });
  ok('les regles s’ouvrent et se ferment sans quitter la partie');

  // Quitter en pleine partie garde la place ; l'accueil propose d'y revenir.
  await malo.getByRole('button', { name: /Menu de la partie/ }).click();
  await malo.getByRole('button', { name: /Quitter la partie/ }).click();
  await malo.getByRole('button', { name: /^Quitter$/ }).click();
  await malo.waitForURL((url) => !url.pathname.includes('/game'), { timeout: 20_000 });
  await host.waitForFunction(() => /sa place l.attend/i.test(document.body.innerText), undefined, {
    timeout: 15_000,
  });
  ok("Malo quitte la partie, l'hote voit que sa place l'attend");

  await malo.goto(`${BASE}/`, { waitUntil: 'load' });
  await malo.getByRole('link', { name: /Revenir/ }).first().click();
  await malo
    .getByRole('heading', { level: 1, name: /^Ton boîtier$/i })
    .waitFor({ timeout: 30_000 });
  const handBack = await malo.getByRole('button', { name: /appuie pour poser/i }).count();
  if (handBack !== 32) throw new Error(`${handBack / 4} cartes au retour, attendu 8`);
  ok('Malo revient depuis l’accueil, dans la meme manche, avec sa main');

  if (erreurs.length > 0) throw new Error(`erreurs de page :\n${erreurs.join('\n')}`);
  console.log('\nOK - MANCHE COMPLETE, REGLES DU LIVRET RESPECTEES');
} finally {
  await browser.close();
}
