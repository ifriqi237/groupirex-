// Parcours réel dans un navigateur, contre une API lancée avec le jeu de démonstration.
//   BASE_URL=http://localhost:4000 node e2e/journey.mjs [dossier-de-captures]
// Vérifie de bout en bout : prix unique, MOQ, seuil du bureau, paiement en ligne,
// réservation et encaissement au bureau, back-office.
import { chromium } from 'playwright';
import fs from 'node:fs';

// L'adresse doit être celle de PUBLIC_URL côté API : le retour de paiement y ramène le client.
const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const OUT = process.argv[2] ?? null;
const PASSWORD = 'Groupdeals2026!';
if (OUT) fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : 'ECHEC '} ${label}`);
  if (!ok) failures++;
};
const consoleErrors = [];

async function newPage(browser, mobile = true) {
  const ctx = await browser.newContext({
    locale: 'fr-FR',
    ...(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } }),
  });
  const page = await ctx.newPage();
  // RECORD=fichier.jsonl : consigne les échanges avec l'API (sert à fabriquer la démonstration hors ligne).
  if (process.env.RECORD) {
    page.on('response', async (res) => {
      const url = new URL(res.url());
      if (!url.pathname.startsWith('/api/v1/')) return;
      const req = res.request();
      let body = null;
      try { body = await res.json(); } catch { /* PDF ou réponse vide */ }
      fs.appendFileSync(process.env.RECORD, JSON.stringify({ method: req.method(), path: url.pathname.slice(7) + url.search, auth: !!req.headers().authorization, request: req.postDataJSON?.() ?? null, status: res.status(), body }) + '\n');
    });
  }
  page.on('pageerror', (e) => consoleErrors.push(`pageerror ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    // Les réponses 4xx attendues (connexion refusée, etc.) ne sont pas des erreurs du site.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text().slice(0, 200));
  });
  return page;
}
const shot = async (page, name, fullPage = false) => {
  // Aucune page ne doit déborder en largeur (défilement horizontal sur mobile).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) check(false, `${name} : la page déborde de ${overflow} px en largeur`);
  if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
};
const settle = (page) => page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('.welcome__cta');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await settle(page);
}

const browser = await chromium.launch();
try {
  /* ---------------------------------------------------------------- */
  console.log('\n1. Visiteur : accueil, prix par pays');
  const visitor = await newPage(browser);
  await visitor.goto(BASE);
  await settle(visitor);
  check((await visitor.innerText('h1')).replace(/\s+/g, ' ').includes('Obtenons les prix usines, jusqu’à (-60%) en important ensemble.'), 'accueil visiteur : le slogan est affiché');
  check((await visitor.locator('.welcome__form .pill').count()) === 5, 'accueil visiteur : formulaire d’inscription (nom, pays, email, WhatsApp, mot de passe)');
  check((await visitor.locator('.tabbar, .header').count()) === 0, 'accueil visiteur : écran plein cadre, sans en-tête ni barre d’onglets');
  check((await visitor.textContent('.pill__prefix .num')) === '+237', 'indicatif par défaut : +237');
  await shot(visitor, '01-accueil-mobile');
  await visitor.click('.welcome__alt--quiet a');
  await visitor.waitForURL(/\/deals/);
  check((await visitor.locator('.tabbar a').count()) === 6, 'les offres restent visibles sans compte ; barre de navigation inférieure : 6 entrées');
  // Partenaires locaux : on choisit son pays dans un menu déroulant, puis un clic affiche ses partenaires.
  await visitor.locator('.tabbar a', { hasText: 'Partenaires' }).click();
  await visitor.waitForSelector('#partner-country');
  await visitor.click('#partner-country');
  await visitor.waitForSelector('[role=option]');
  check((await visitor.locator('[role=option]').count()) === 54, 'le menu déroulant propose les 54 pays d’Afrique');
  check((await visitor.locator('[role=option] img.flag').count()) === 54, 'chaque pays est accompagné de son drapeau');
  await visitor.locator('[role=option][data-code=ZW]').scrollIntoViewIfNeeded();
  check(await visitor.locator('[role=option][data-code=ZW] img').evaluate((img) => img.complete && img.naturalWidth > 0), 'les images des drapeaux se chargent (Zimbabwe, en fin de liste)');
  await visitor.locator('[role=option][data-code=CM]').click();
  check((await visitor.innerText('#partner-country')).trim() === 'Cameroun', 'le pays choisi s’affiche avec son drapeau');
  await visitor.click('form button.btn--primary');
  await visitor.waitForSelector('article.partner');
  check((await visitor.textContent('h1')) === 'Cameroun' && (await visitor.locator('article.partner').count()) === 2, 'partenaires locaux : le Cameroun affiche ses 2 partenaires');
  check(/Douala/.test(await visitor.innerText('main')) && /Yaoundé/.test(await visitor.innerText('main')), 'partenaires regroupés par ville (Douala, Yaoundé)');
  await shot(visitor, '01b-partenaires-cameroun');
  await visitor.click('#partner-switch');
  await visitor.locator('[role=option][data-code=ML]').click();
  await visitor.waitForSelector('.empty');
  check((await visitor.textContent('h1')) === 'Mali' && /paiement en ligne reste disponible/.test(await visitor.innerText('.empty')), 'pays desservi sans partenaire : message clair plutôt qu’une page vide');
  await visitor.click('#partner-switch');
  await visitor.locator('[role=option][data-code=BW]').click();
  await visitor.waitForFunction(() => document.querySelector('h1')?.textContent === 'Botswana');
  check(/Pas encore de partenaire dans ce pays/.test(await visitor.innerText('.empty')), 'pays ouvert sans partenaire (Botswana) : la page le dit');
  await visitor.goto(`${BASE}/deals?q=sandales`);
  await settle(visitor);
  const card = visitor.locator('.deal').first();
  check((await card.locator('.price').textContent()).replace(/\s/g, '') === '11500FCFA', 'Cameroun : la carte affiche 11 500 FCFA');
  check(!/livraison/i.test(await card.innerText()), 'aucune mention de livraison sur la carte');
  await visitor.locator('.subheader select').first().selectOption('SN');
  await visitor.waitForFunction(() => document.querySelector('.deal .price')?.textContent.replace(/\s/g, '') === '12500FCFA', null, { timeout: 8000 }).catch(() => undefined);
  check((await visitor.locator('.deal .price').first().textContent()).replace(/\s/g, '') === '12500FCFA', 'en choisissant le Sénégal, le prix devient 12 500 FCFA');
  await shot(visitor, '02-offres-senegal');
  await visitor.locator('.subheader select').nth(1).selectOption('en');
  await visitor.waitForFunction(() => /Ends in/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => undefined);
  const english = await visitor.innerText('body');
  check(/Ends in/.test(english) && !/Se termine dans/.test(english), 'en anglais, les cartes affichent « Ends in »');
  check((await visitor.getAttribute('html', 'lang')) === 'en', 'la langue de la page est déclarée (lang="en")');
  await shot(visitor, '02b-offres-anglais');
  // Toutes les langues officielles d'Afrique sont proposées. Une langue sans traduction se choisit : les textes restent en français.
  const languageSelect = visitor.locator('.subheader select').nth(1);
  check((await languageSelect.locator('option').count()) === 57, 'le sélecteur propose les 57 langues officielles d’Afrique');
  await languageSelect.selectOption('sw');
  await visitor.waitForFunction(() => /Se termine dans/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => undefined);
  check(
    /Kiswahili (is not translated yet|n’est pas encore traduit)/.test(await visitor.innerText('.toasts')) && /Se termine dans/.test(await visitor.innerText('body')),
    'kiswahili, pas encore traduit : un message le dit et les textes restent en français',
  );
  await languageSelect.selectOption('ar');
  await visitor.waitForFunction(() => document.documentElement.lang === 'ar', null, { timeout: 8000 }).catch(() => undefined);
  check((await visitor.getAttribute('html', 'lang')) === 'ar' && (await visitor.getAttribute('html', 'dir')) === 'ltr', 'arabe, pas encore traduit : la page reste de gauche à droite');
  // Commande « Précédent » : retour à la page d'où l'on vient ; sans page précédente, un niveau au-dessus ; absente de l'accueil.
  await visitor.goto(`${BASE}/deals`);
  await settle(visitor);
  await visitor.locator('.deal a').first().click();
  await visitor.waitForURL(/\/deals\/.+/);
  await visitor.click('button.back');
  await visitor.waitForURL((u) => u.pathname === '/deals', { timeout: 8000 }).catch(() => undefined);
  check(new URL(visitor.url()).pathname === '/deals', '« Précédent » ramène à la page d’où l’on vient');
  await visitor.goto(`${BASE}/partners/CM`);
  await settle(visitor);
  await visitor.click('button.back');
  await visitor.waitForURL((u) => u.pathname === '/partners', { timeout: 8000 }).catch(() => undefined);
  const upOneLevel = new URL(visitor.url()).pathname === '/partners';
  await visitor.goto(`${BASE}/`);
  await settle(visitor);
  check(upOneLevel && (await visitor.locator('button.back').count()) === 0, 'page ouverte directement : « Précédent » remonte d’un niveau ; il est absent de l’accueil');
  await visitor.close();

  /* ---------------------------------------------------------------- */
  console.log('\n2. Inscription, vérification de l’email');
  const email = `e2e-${Date.now()}@groupdeals.test`;
  const buyer = await newPage(browser);
  await buyer.goto(BASE);
  await settle(buyer);
  await buyer.click('.welcome__cta');
  await buyer.waitForSelector('.pill__error');
  check((await buyer.locator('.pill__error').count()) === 5, 'formulaire vide : chacun des 5 champs est signalé');
  await buyer.fill('input[autocomplete=name]', 'Élise Ngono');
  check((await buyer.locator('.pill__error').count()) === 4, 'corriger un champ efface son message d’erreur');
  check(await buyer.locator('.welcome__legal a[href="/legal/conditions"]').isVisible(), 'inscription : lien vers les conditions générales et la politique de confidentialité');
  // Choix du pays : la flèche ouvre le menu, chaque pays a son drapeau.
  await buyer.click('#register-country .picker__chevron');
  await buyer.waitForSelector('[role=option][data-code=SN]');
  // Les drapeaux se chargent à l'ouverture de la liste : on attend celui du Sénégal.
  await buyer.waitForFunction(() => { const i = document.querySelector('[role=option][data-code=SN] img.flag'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => undefined);
  const flags = await buyer.locator('[role=option] img.flag').count();
  const options = await buyer.locator('[role=option]').count();
  check(options === 54 && flags === options && (await buyer.locator('[role=option][data-code=SN] img.flag').evaluate((img) => img.complete && img.naturalWidth > 0)), `inscription : la flèche ouvre la liste des pays, chacun avec son drapeau (${options})`);
  await buyer.locator('[role=option][data-code=SN]').click();
  check((await buyer.textContent('.pill__prefix .num')) === '+221' && (await buyer.textContent('#register-country')).includes('Sénégal'), 'l’indicatif suit le pays choisi (Sénégal : +221)');
  await buyer.click('#register-country');
  await buyer.locator('[role=option][data-code=CM]').click();
  await buyer.fill('input[type=email]', email);
  await buyer.fill('input[type=tel]', '6 77 00 99 88');
  await buyer.fill('input[autocomplete=new-password]', PASSWORD);
  await buyer.click('.pill__action');
  check((await buyer.getAttribute('input[autocomplete=new-password]', 'type')) === 'text', 'l’œil affiche le mot de passe');
  const [registerResponse] = await Promise.all([buyer.waitForResponse((r) => r.url().endsWith('/auth/register')), buyer.click('.welcome__cta')]);
  const registered = await registerResponse.json();
  check(registerResponse.status() === 201, 'compte créé');
  check(registered.user.firstName === 'Élise' && registered.user.lastName === 'Ngono' && registered.user.whatsapp === '+237677009988', 'le champ Nom donne prénom et nom ; le numéro reçoit son indicatif');
  await buyer.waitForURL(/verify-email/);
  await shot(buyer, '03-verification-email');

  // Sans email vérifié, la commande est bloquée.
  // L'adresse d'une offre porte le mois de son ouverture : on la demande à l'API plutôt que de l'écrire en dur.
  const slug = (await (await fetch(`${BASE}/api/v1/group-deals?q=sandales`, { headers: { 'X-Country': 'CM' } })).json()).items[0].slug;
  await buyer.goto(`${BASE}/checkout/${slug}?items=`);
  await settle(buyer);
  await buyer.goto(`${BASE}/deals/${slug}`);
  await settle(buyer);
  await buyer.locator('.panel button.btn--primary').click();
  await buyer.waitForURL(/checkout/);
  await buyer.waitForSelector('table.recap');
  check(await buyer.locator('text=Vérifiez votre adresse email pour commander.').isVisible(), 'email non vérifié : commande bloquée avec explication');
  check(await buyer.locator('form button.btn--primary').isDisabled(), 'le bouton de paiement est désactivé');
  // Hors production, aucun email ne part : la page propose le lien (absent en production).
  check(typeof registered.debug?.verifyToken === 'string', 'hors production, l’API renvoie le lien de vérification');
  // La page « Votre commande » dit pourquoi le bouton est grisé et permet de vérifier l'adresse sur place.
  await buyer.locator('button', { hasText: 'Vérifier mon adresse email' }).click();
  await buyer.waitForSelector('text=Vérifiez votre adresse email pour commander.', { state: 'detached', timeout: 8000 }).catch(() => undefined);
  // Paiement en ligne : il reste à choisir le bureau de retrait, et la page le dit sous le bouton.
  const hinted = await buyer.locator('text=Choisissez votre bureau de retrait pour continuer.').isVisible();
  await buyer.locator('form select').last().selectOption({ index: 1 });
  check(
    hinted && (await buyer.locator('form button.btn--primary').isEnabled()) && !(await buyer.locator('text=Vérifiez votre adresse email pour commander.').isVisible()),
    '« Vérifier mon adresse email » : adresse vérifiée sur place ; le bouton de paiement se débloque une fois le bureau de retrait choisi',
  );

  /* ---------------------------------------------------------------- */
  console.log('\n3. Fiche produit : prix unique, MOQ, total calculé par le serveur');
  await buyer.goto(`${BASE}/deals/${slug}`);
  await settle(buyer);
  check((await buyer.locator('.price--xl').textContent()).replace(/\s/g, '') === '11500FCFA', 'prix GROUPDEALS : 11 500 FCFA');
  await buyer.locator('.variant .stepper input').first().fill('9');
  await buyer.waitForSelector('.notice--warn');
  check((await buyer.locator('.notice--warn').first().innerText()).includes('Commande minimum : 10'), 'quantité 9 : le minimum de 10 est rappelé');
  check(await buyer.locator('.panel button.btn--primary').isDisabled(), 'quantité 9 : « Participer » est désactivé');
  await buyer.locator('.variant .stepper input').first().fill('20');
  await buyer.waitForFunction(() => /230\s?000/.test(document.querySelector('.panel')?.textContent ?? ''), null, { timeout: 8000 });
  check(true, 'quantité 20 : total 230 000 FCFA');
  // Carrousel : plusieurs photos et une vidéo du produit, que l'on fait défiler.
  const slides = await buyer.locator('.carousel__slide').count();
  await buyer.locator('.carousel__nav--next').click();
  await buyer.waitForFunction(() => document.querySelector('.carousel__count')?.textContent.startsWith('2 /'), null, { timeout: 8000 }).catch(() => undefined);
  const second = await buyer.locator('.carousel__count').textContent();
  await buyer.locator('.carousel__info button').click();
  await buyer.waitForFunction((n) => document.querySelector('.carousel__count')?.textContent.startsWith(`${n} /`), slides, { timeout: 8000 }).catch(() => undefined);
  check(
    slides >= 3 && (await buyer.locator('.carousel__slide img').count()) >= 2 && (await buyer.locator('.carousel__slide video').count()) === 1 && second === `2 / ${slides}` && (await buyer.locator('.carousel__count').textContent()) === `${slides} / ${slides}`,
    `fiche : carrousel de ${slides - 1} photos et 1 vidéo, qui défile jusqu’à la vidéo`,
  );
  await shot(buyer, '04-fiche-produit', true);

  /* ---------------------------------------------------------------- */
  console.log('\n4. Commande et paiement en ligne');
  await buyer.locator('.panel button.btn--primary').click();
  await buyer.waitForURL(/checkout/);
  await buyer.waitForSelector('table.recap');
  const recap = await buyer.locator('table.recap').innerText();
  check(/11\s?500/.test(recap) && /230\s?000/.test(recap), 'récapitulatif : 11 500 × 20 = 230 000');
  check(!/livraison/i.test(recap), 'aucune ligne « frais de livraison » dans le récapitulatif');
  check((await buyer.locator('input[name=method]').count()) === 1, 'total < 500 000 FCFA : le bureau local n’est pas proposé');
  check(await buyer.locator('text=Le paiement au bureau local est proposé à partir de').isVisible(), 'le seuil du bureau est expliqué');
  await shot(buyer, '05-commande-en-ligne', true);
  await buyer.selectOption('form select', { index: 1 });
  await buyer.click('form button.btn--primary');
  await buyer.waitForURL(/sandbox\/pay/);
  await buyer.waitForSelector('.price--xl');
  check((await buyer.locator('.price--xl').textContent()).replace(/\s/g, '') === '230000FCFA', 'page de paiement : 230 000 FCFA');
  await buyer.click('button.btn--primary');
  await buyer.waitForURL(/payment\/return/);
  await buyer.waitForSelector('.notice--ok');
  check((await buyer.locator('.notice--ok').innerText()).includes('Paiement confirmé'), 'retour de paiement : confirmé par le serveur');
  await shot(buyer, '06-paiement-confirme');
  await buyer.click('a.btn--primary');
  await buyer.waitForURL(/\/orders\//);
  await buyer.waitForSelector('ol.steps');
  check((await buyer.locator('.badge').first().innerText()) === 'Payée', 'commande : payée');
  check((await buyer.locator('ol.steps li').count()) === 9, 'suivi : 9 étapes affichées');
  check(await buyer.locator('text=Facture').first().isVisible(), 'la facture est disponible');
  await shot(buyer, '07-commande-payee', true);
  const [download] = await Promise.all([buyer.waitForEvent('download', { timeout: 10000 }).catch(() => null), buyer.locator('section button.btn--ghost').first().click()]);
  check(download !== null && /^FA-\d{4}-\d{8}\.pdf$/.test(download.suggestedFilename()), 'la facture PDF se télécharge');

  /* ---------------------------------------------------------------- */
  console.log('\n5. Commande à 500 000 FCFA et plus : paiement au bureau');
  await buyer.goto(`${BASE}/deals/${slug}`);
  await settle(buyer);
  await buyer.locator('.variant .stepper input').first().fill('50');
  await buyer.waitForFunction(() => /575\s?000/.test(document.querySelector('.panel')?.textContent ?? ''), null, { timeout: 8000 });
  await buyer.locator('.panel button.btn--primary').click();
  await buyer.waitForURL(/checkout/);
  await buyer.waitForSelector('table.recap');
  check((await buyer.locator('input[name=method]').count()) === 2, 'total 575 000 FCFA : le bureau local est proposé');
  await buyer.locator('label.choice', { hasText: 'Payer au bureau local' }).click();
  await buyer.waitForSelector('input[name=office]');
  check((await buyer.locator('input[name=office]').count()) === 2, 'les bureaux du Cameroun sont listés (Douala, Yaoundé)');
  // Un bureau est proposé d'emblée : « Réserver et payer au bureau » est utilisable sans autre geste, et le client peut changer de bureau.
  await buyer.waitForFunction(() => !!document.querySelector('input[name=office]:checked'), null, { timeout: 5000 }).catch(() => undefined);
  const reserve = buyer.locator('form > button.btn--primary');
  const ready = (await buyer.locator('input[name=office]:checked').count()) === 1 && (await reserve.isEnabled()) && (await reserve.innerText()).trim() === 'Réserver et payer au bureau';
  await buyer.locator('label.choice', { hasText: 'Yaoundé' }).click();
  const moved = /Yaoundé/.test(await buyer.locator('label.choice:has(input[name=office]:checked)').innerText());
  await buyer.locator('label.choice', { hasText: 'Douala' }).click();
  check(ready && moved && (await reserve.isEnabled()), 'paiement au bureau choisi : un bureau est déjà sélectionné, le bouton « Réserver et payer au bureau » est actif, et l’on peut changer de bureau');
  // Page « Votre commande » : la proforma se télécharge avant de confirmer, sans créer de commande.
  const [quotePdf] = await Promise.all([buyer.waitForEvent('download', { timeout: 10000 }).catch(() => null), buyer.locator('button', { hasText: 'Téléchargez votre proforma' }).click()]);
  const quotePath = quotePdf ? await quotePdf.path() : null;
  check(
    quotePdf !== null && /^PF-\d{8}-\d{6}\.pdf$/.test(quotePdf.suggestedFilename()) && fs.readFileSync(quotePath).subarray(0, 5).toString() === '%PDF-' && /checkout/.test(buyer.url()),
    '« Votre commande » : le bouton « Téléchargez votre proforma » remet un PDF, sans quitter la page',
  );
  if (OUT && quotePath) fs.copyFileSync(quotePath, `${OUT}/proforma-avant-commande.pdf`);
  await shot(buyer, '08-choix-bureau', true);
  await buyer.click('form > button.btn--primary');
  await buyer.waitForURL(/\/orders\//);
  await buyer.waitForSelector('.qr svg');
  const reservation = (await buyer.locator('dl.kv dd').first().innerText()).trim();
  check(/^RB-\d{4}-\d{8}$/.test(reservation), `réservation créée : ${reservation}`);
  check(await buyer.locator('.qr svg').isVisible(), 'QR Code affiché');
  // La facture qui permet de payer au bureau se télécharge depuis la réservation.
  const [proforma] = await Promise.all([buyer.waitForEvent('download', { timeout: 10000 }).catch(() => null), buyer.locator('button', { hasText: 'Téléchargez votre proforma' }).click()]);
  const proformaPath = proforma ? await proforma.path() : null;
  check(
    proforma !== null && /^PF-\d{4}-\d{8}\.pdf$/.test(proforma.suggestedFilename()) && fs.readFileSync(proformaPath).subarray(0, 5).toString() === '%PDF-',
    'la facture proforma à présenter au bureau se télécharge (PDF)',
  );
  if (OUT && proformaPath) fs.copyFileSync(proformaPath, `${OUT}/facture-proforma.pdf`);
  await shot(buyer, '09-reservation-bureau', true);

  /* ---------------------------------------------------------------- */
  console.log('\n6. Agent du bureau : recherche, encaissement, reçu');
  const agent = await newPage(browser, false);
  await login(agent, 'agent.douala@groupdeals.test');
  await agent.goto(`${BASE}/agent`);
  await agent.waitForSelector('table.table');
  await agent.fill('input[aria-label="Rechercher une réservation"]', reservation);
  await agent.waitForFunction((n) => document.querySelectorAll('table.table tbody tr').length === 1 && document.querySelector('table.table tbody').textContent.includes(n), reservation, { timeout: 8000 });
  await agent.click('table.table tbody button.link');
  await agent.waitForSelector('.modal .price--xl');
  check((await agent.locator('.modal .price--xl').textContent()).replace(/\s/g, '') === '575000FCFA', 'montant attendu : 575 000 FCFA');
  check((await agent.locator('.modal input[type=number], .modal input[inputmode=decimal]').count()) === 0, 'aucun champ ne permet à l’agent de modifier le montant');
  await shot(agent, '10-agent-reservation');
  await agent.locator('.modal button.btn--primary').click();
  await agent.locator('.modal .panel button.btn--primary').click();
  await agent.waitForSelector('.modal .badge--green');
  check((await agent.locator('.modal .badge--green').first().innerText()) === 'Encaissée', 'réservation encaissée');
  check(await agent.locator('.modal button', { hasText: 'Imprimer le reçu' }).isVisible(), 'le reçu est proposé');
  await shot(agent, '11-agent-encaisse');
  await agent.goto(`${BASE}/admin/products`);
  await settle(agent);
  check(await agent.locator('text=Accès réservé au personnel').isVisible(), 'l’agent n’a pas accès au back-office');
  await agent.close();

  await buyer.reload();
  await buyer.waitForSelector('ol.steps');
  check((await buyer.locator('.badge').first().innerText()) === 'Payée', 'côté client : la commande est payée');
  check(await buyer.locator('button', { hasText: 'Reçu de paiement' }).isVisible(), 'côté client : le reçu est disponible');
  await buyer.goto(`${BASE}/orders`);
  await buyer.waitForSelector('.orderrow');
  check((await buyer.locator('.orderrow').count()) === 2, '« Mes commandes » : 2 commandes');
  await shot(buyer, '12-mes-commandes');

  /* ---------------------------------------------------------------- */
  console.log('\n7. Matching');
  await buyer.goto(`${BASE}/matching`);
  await buyer.waitForSelector('article.panel');
  const first = buyer.locator('article.panel').first();
  await first.locator('button.btn--navy').click();
  await buyer.locator('.modal button.btn--primary').click();
  await first.locator('.badge--green').waitFor();
  check((await first.locator('button.btn--navy').count()) === 0, 'après « Je veux aussi ce produit », le bouton disparaît : un seul intérêt possible');
  await shot(buyer, '13-matching', true);
  await buyer.close();

  /* ---------------------------------------------------------------- */
  console.log('\n8. Back-office : chaque écran se charge sans erreur');
  const admin = await newPage(browser, false);
  await login(admin, 'superadmin@groupdeals.test');
  const screens = ['/admin', '/admin/deals', '/admin/products', '/admin/categories', '/admin/matching', '/admin/orders', '/admin/payments', '/admin/payments?tab=refunds',
    '/admin/logistics', '/admin/offices', '/admin/analytics', '/admin/users', '/admin/currencies', '/admin/currencies?tab=countries', '/admin/languages', '/admin/languages?lang=en', '/admin/settings', '/admin/audit', '/admin/audit?tab=outbox'];
  for (const path of screens) {
    await admin.goto(BASE + path);
    await settle(admin);
    const errors = await admin.locator('.notice--error').count();
    const hasContent = (await admin.locator('.bo__main h1').count()) === 1;
    check(errors === 0 && hasContent, `${path}`);
    if (OUT && ['/admin', '/admin/deals', '/admin/logistics', '/admin/currencies', '/admin/audit'].includes(path)) await shot(admin, `20-admin${path.replace(/[/?=]/g, '-')}`, true);
  }
  // Fiche produit : prix par pays
  await admin.goto(`${BASE}/admin/products`);
  await admin.waitForSelector('table.table a');
  await admin.locator('table.table a', { hasText: 'Sandales' }).click();
  await admin.waitForSelector('.tabs');
  await admin.locator('.tab', { hasText: 'Prix par pays' }).click();
  await admin.waitForSelector('table.table');
  const cm = admin.locator('table.table tbody tr', { hasText: 'Cameroun' });
  check(/11\s?500/.test(await cm.innerText()), 'prix par pays : Cameroun 11 500 FCFA');
  check(/10\s?000 FCFA \+ 1\s?500 FCFA/.test(await cm.innerText()), 'le back-office montre les composants : 10 000 + 1 500');
  await shot(admin, '21-admin-prix-par-pays', true);
  // Logistique : valider une étape
  await admin.goto(`${BASE}/admin/logistics`);
  await admin.waitForSelector('table.table a');
  await admin.locator('table.table tbody tr', { hasText: 'Sénégal' }).locator('a').click();
  await admin.waitForSelector('ol.steps');
  await admin.locator('ol.steps button.btn--primary').click();
  await admin.waitForFunction(() => document.querySelectorAll('ol.steps li[data-state=done]').length === 6, null, { timeout: 8000 });
  check(true, 'logistique : étape 6 validée pour le lot Sénégal');
  await shot(admin, '22-admin-expedition', true);
  // Campagne à décider
  await admin.goto(`${BASE}/admin/deals?status=NEEDS_DECISION`);
  await admin.waitForSelector('table.table tbody tr');
  await admin.locator('table.table button.btn--primary').first().click();
  await admin.waitForSelector('.modal');
  await shot(admin, '23-admin-decision');
  check((await admin.locator('.modal input[name=decision]').count()) === 3, 'fin de campagne : trois décisions possibles (prolonger, confirmer, annuler)');
  await admin.close();
} finally {
  await browser.close();
}

if (consoleErrors.length) {
  console.log('\nErreurs JavaScript relevées dans le navigateur :');
  for (const e of [...new Set(consoleErrors)]) console.log('  ' + e);
  failures += consoleErrors.length;
}
console.log(failures ? `\n${failures} échec(s)` : '\nParcours complet réussi');
process.exit(failures ? 1 : 0);
