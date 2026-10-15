// Vérifie la démonstration autonome (demo-dist/) dans un navigateur, sans API.
//   (cd demo-dist && python3 -m http.server 4300) &
//   node e2e/demo.mjs [dossier-de-captures]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.DEMO_URL ?? 'http://127.0.0.1:4300/';
const OUT = process.argv[2] ?? null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : 'ECHEC '} ${label}`);
  if (!ok) failures++;
};
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror ${String(e).slice(0, 300)}`));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
page.on('requestfailed', (r) => errors.push(`requête échouée ${r.url()}`));
page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
// Aucune requête ne doit sortir du dossier de la démonstration.
page.on('request', (r) => {
  if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) errors.push(`requête externe ${r.url()}`);
});
const idle = () => page.waitForTimeout(450);
const shot = async (name, fullPage = false) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) check(false, `${name} : la page déborde de ${overflow} px`);
  if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
};
const role = async (value) => {
  await page.selectOption('#demo-role', value);
  await idle();
  await idle();
};
const text = async () => (await page.innerText('body')).replace(/\s+/g, ' ');

try {
  console.log('\n1. Visiteur');
  await page.goto(BASE);
  await page.waitForSelector('.welcome__cta');
  check((await text()).includes('Obtenons les prix usines, jusqu’à (-60%) en important ensemble.'), 'écran d’accueil et slogan');
  check((await page.locator('.demobar').count()) === 1, 'bandeau de démonstration visible');
  check(await page.locator('.welcome__ship').evaluate((img) => img.complete && img.naturalWidth > 0), 'illustrations chargées');
  await shot('d1-accueil');
  await page.click('.welcome__alt--quiet a');
  await page.waitForSelector('.deal');
  check((await page.locator('.deal').count()) >= 5 && (await page.locator('.deal .deal__cta', { hasText: 'Participer au GroupDeals' }).count()) >= 5, 'liste des offres, chacune avec son bouton « Participer au GroupDeals »');
  // Une photo sur fond blanc (le panneau solaire) est montrée entière ; les autres remplissent leur cadre.
  await page.waitForFunction(() => [...document.querySelectorAll('.deal__media img')].every((i) => i.complete), null, { timeout: 8000 }).catch(() => undefined);
  const fits = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.deal__media img')].map((i) => [i.getAttribute('src').split('/').pop(), getComputedStyle(i).objectFit])));
  check(fits['panneau-550w-480.webp'] === 'contain' && fits['papier-a4-480.webp'] === 'cover', 'photo sur fond blanc montrée entière ; photo avec décor en plein cadre');
  check(await page.locator('.deal img').first().evaluate((img) => img.complete && img.naturalWidth > 0), 'images des produits chargées');
  // Pages légales : liens du pied de page, passages à compléter surlignés.
  await page.locator('.footer__legal a', { hasText: 'Conditions générales' }).click();
  await page.waitForSelector('h1:has-text("Conditions générales d’utilisation et de vente")');
  check((await page.locator('.legal__body section').count()) >= 10 && (await page.locator('.legal__todo').count()) > 0 && (await page.locator('.chips a[aria-current="true"]').innerText()) === 'Conditions générales', 'pages légales : conditions générales, passages à compléter surlignés');
  await page.locator('.chips a', { hasText: 'Mentions légales' }).click();
  await page.waitForSelector('h1:has-text("Mentions légales")');
  check((await text()).includes('édité par GROUPIREX'), 'mentions légales : éditeur GROUPIREX');
  // Page Support : lien du pied de page, email, téléphone et WhatsApp cliquables.
  await page.locator('.footer__legal a', { hasText: 'Support et contact' }).click();
  await page.waitForSelector('.support__row');
  const contacts = await page.locator('.support__value').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  check(JSON.stringify(contacts) === JSON.stringify(['mailto:support@groupirex.com', 'tel:+237621730350', 'https://wa.me/237621730350']), 'page Support : email, téléphone et WhatsApp cliquables');
  await page.locator('.tabbar a', { hasText: 'Partenaires' }).click();
  await page.waitForSelector('#partner-country');
  await page.click('#partner-country');
  await page.waitForSelector('[role=option]');
  check((await page.locator('[role=option] img.flag').count()) === 54, 'menu déroulant : 54 pays d’Afrique avec leur drapeau');
  check(await page.locator('[role=option][data-code=CM] img').evaluate((img) => img.complete && img.naturalWidth > 0), 'drapeaux chargés');
  await page.locator('[role=option][data-code=CM]').click();
  await page.click('form button.btn--primary');
  await page.waitForSelector('article.partner');
  check((await page.textContent('h1')) === 'Cameroun' && (await page.locator('article.partner').count()) === 2, 'partenaires locaux du Cameroun');
  await shot('d2b-partenaires');
  await page.click('#partner-switch');
  await page.locator('[role=option][data-code=SN]').click();
  await idle();
  await idle();
  check((await page.textContent('h1')) === 'Sénégal' && (await page.locator('article.partner').count()) === 1, 'partenaires locaux du Sénégal');
  await page.click('#partner-switch');
  await page.locator('[role=option][data-code=MG]').click();
  await idle();
  await idle();
  check((await page.textContent('h1')) === 'Madagascar' && (await page.locator('.empty').count()) === 1, 'pays non desservi (Madagascar) : page affichée');
  await page.click('.tabbar a:nth-child(2)');
  await page.waitForSelector('.deal');
  await page.fill('.subheader input[type=search]', 'sandales');
  await page.press('.subheader input[type=search]', 'Enter');
  await idle();
  check((await page.locator('.deal .price').first().textContent()).replace(/\s/g, '') === '11500FCFA', 'Cameroun : 11 500 FCFA');
  await page.locator('.subheader select').first().selectOption('SN');
  await idle();
  await idle();
  check((await page.locator('.deal .price').first().textContent()).replace(/\s/g, '') === '12500FCFA', 'Sénégal : 12 500 FCFA');
  await page.locator('.subheader select').first().selectOption('CM');
  await idle();
  await shot('d2-offres');

  console.log('\n2. Inscription');
  await page.click('.header .logo');
  await page.waitForSelector('.welcome__cta');
  await page.click('.welcome__cta');
  await page.waitForSelector('.pill__error');
  check((await page.locator('.pill__error').count()) === 5, 'formulaire vide : 5 champs signalés');
  await page.fill('input[autocomplete=name]', 'Awa Ndiaye');
  await page.tap('#register-country .picker__chevron');
  await page.waitForSelector('[role=option][data-code=CM]');
  check((await page.locator('[role=option]').count()) === 54 && (await page.locator('[role=option] img.flag').count()) === 54, 'inscription : la flèche ouvre la liste des 54 pays d’Afrique, chacun avec son drapeau');
  await page.locator('[role=option][data-code=CM]').tap();
  await page.fill('input[type=email]', 'awa@example.com');
  await page.fill('input[type=tel]', '6 77 00 99 88');
  await page.fill('input[autocomplete=new-password]', 'Motdepasse2026');
  await page.click('.welcome__cta');
  await page.waitForSelector('text=Vérification de votre email');
  // Aucun email ne part de la démonstration : le compte créé peut commander tout de suite, rien à vérifier.
  await page.waitForSelector('.notice--ok');
  check((await text()).includes('Votre adresse est considérée comme vérifiée') && (await page.locator('button', { hasText: 'Renvoyer le lien' }).count()) === 0, 'compte créé : adresse considérée comme vérifiée, aucune étape bloquante');
  await page.click('a.btn--primary');
  await page.waitForSelector('.deal');
  // Accueil : l'univers de l'inscription (carte, bateau, camion, bulles), l'offre vedette, la route en 4 étapes, les catégories en bulles.
  await page.waitForSelector('.hx .live');
  const heroOk = await page.evaluate(() => [...document.querySelectorAll('.hx__slide img')].filter((i) => i.loading !== 'lazy').every((i) => i.complete && i.naturalWidth > 0));
  check(heroOk && (await page.locator('.hx__slide').count()) === 4 && (await page.locator('.hx__dot').count()) === 4, 'accueil : bannière en carrousel (4 images de fond, navigation)');
  check((await page.locator('.how__steps li').count()) === 4 && (await page.locator('.cats .cat img').count()) > 0 && (await page.locator('.band--rose .deal').count()) > 0, 'accueil : route en 4 étapes, catégories en bulles, offres sur la bande rose');

  console.log('\n3. Commande payée en ligne');
  await page.fill('.subheader input[type=search]', 'sandales');
  await page.press('.subheader input[type=search]', 'Enter');
  await idle();
  await page.locator('.deal a').first().click();
  await page.waitForSelector('.price--xl');
  check((await page.locator('.price--xl').textContent()).replace(/\s/g, '') === '11500FCFA', 'fiche : prix unique 11 500 FCFA');
  const qty = page.locator('.stepper input').first();
  await qty.fill('9');
  await idle();
  check(await page.locator('.panel button.btn--primary').isDisabled(), 'quantité 9 sous le minimum de 10 : bouton désactivé');
  await qty.fill('20');
  await idle();
  check((await text()).includes('230 000 FCFA'), 'total 20 × 11 500 = 230 000 FCFA');
  // Carrousel : plusieurs photos et une vidéo, chargées depuis les fichiers de la démonstration.
  const slides = await page.locator('.carousel__slide').count();
  await page.locator('.gallery__thumbs button').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.carousel__count')?.textContent.startsWith('2 /'), null, { timeout: 8000 }).catch(() => undefined);
  const shown = await page.locator('.carousel__slide img').nth(1).evaluate((img) => img.complete && img.naturalWidth > 0);
  check(slides >= 3 && shown && (await page.locator('.carousel__count').textContent()) === `2 / ${slides}` && (await page.locator('.carousel__slide video').count()) === 1, `fiche : carrousel de ${slides - 1} photos et 1 vidéo`);
  // L'espace des photos occupe 75 % de la largeur disponible sur téléphone, et reste carré.
  const frame = await page.evaluate(() => { const t = document.querySelector('.carousel__track').getBoundingClientRect(); return [t.width / document.querySelector('.shots').getBoundingClientRect().width, t.width / t.height]; });
  check(Math.abs(frame[0] - 0.75) < 0.01 && Math.abs(frame[1] - 1) < 0.01, 'fiche : espace des photos à 75 % de la largeur, carré');
  const videoSrc = await page.locator('.carousel__slide video').getAttribute('src');
  const videoStatus = await page.evaluate(async (src) => { const r = await fetch(src); return [r.status, r.headers.get('content-type'), (await r.arrayBuffer()).byteLength]; }, videoSrc);
  check(videoStatus[0] === 200 && videoStatus[2] > 50000, `vidéo du produit présente dans la démonstration (${Math.round(videoStatus[2] / 1024)} ko)`);
  await shot('d3-fiche');
  await page.locator('.panel button.btn--primary').click();
  await page.waitForSelector('table.recap');
  check(!(await page.locator('input[value=OFFICE]').isEnabled().catch(() => false)), 'sous 500 000 FCFA : paiement au bureau indisponible');
  await page.locator('form select').last().selectOption({ index: 1 });
  await page.click('form button.btn--primary');
  await page.waitForSelector('text=Page de paiement de test');
  await shot('d4-paiement');
  await page.click('button.btn--primary');
  await page.waitForSelector('text=Paiement confirmé');
  await page.click('a.btn--primary');
  await page.waitForSelector('text=Suivi de votre commande');
  check((await text()).includes('Payée'), 'commande payée');
  await shot('d5-commande-payee', true);

  console.log('\n4. Réservation au bureau');
  await page.click('.tabbar a:nth-child(2)');
  await page.waitForSelector('.deal');
  await page.fill('.subheader input[type=search]', 'sandales');
  await page.press('.subheader input[type=search]', 'Enter');
  await idle();
  await page.locator('.deal a').first().click();
  await page.waitForSelector('.price--xl');
  await page.locator('.stepper input').first().fill('50');
  await idle();
  await page.locator('.panel button.btn--primary').click();
  await page.waitForSelector('table.recap');
  await page.locator('label.choice', { hasText: 'bureau' }).first().click();
  await idle();
  // Un bureau est proposé d'emblée : le bouton de réservation est actif sans autre geste.
  check(
    (await page.locator('input[name=office]:checked').count()) === 1 && (await page.locator('form > button.btn--primary').isEnabled()) && (await page.locator('form > button.btn--primary').innerText()).trim() === 'Réserver et payer au bureau',
    'paiement au bureau choisi : un bureau est déjà sélectionné et « Réserver et payer au bureau » est actif',
  );
  await page.locator('label.choice', { hasText: 'Douala' }).first().click();
  await idle();
  // Page « Votre commande » : la proforma du devis se télécharge avant de confirmer.
  const [quotePdf] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.locator('button', { hasText: 'Téléchargez votre proforma' }).click()]);
  const quotePath = quotePdf ? await quotePdf.path() : null;
  check(
    quotePdf !== null && /^PF-\d{8}-\d{6}\.pdf$/.test(quotePdf.suggestedFilename()) && fs.readFileSync(quotePath).subarray(0, 5).toString() === '%PDF-' && (await page.locator('table.recap').count()) === 1,
    '« Votre commande » : « Téléchargez votre proforma » remet un PDF, sans quitter la page',
  );
  if (OUT && quotePath) fs.copyFileSync(quotePath, `${OUT}/proforma-avant-commande-demo.pdf`);
  await shot('d6a-votre-commande', true);
  await page.click('form > button.btn--primary');
  await page.waitForSelector('text=Paiement au bureau local');
  check((await page.locator('svg[viewBox]').count()) > 0 && (await text()).includes('RB-'), 'réservation avec QR Code et numéro');
  await shot('d6-reservation', true);
  // La facture se télécharge sans serveur : le PDF est produit dans le navigateur.
  const [invoice] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.locator('button', { hasText: 'Téléchargez votre proforma' }).click()]);
  const invoicePath = invoice ? await invoice.path() : null;
  check(
    invoice !== null && /^PF-.+\.pdf$/.test(invoice.suggestedFilename()) && fs.readFileSync(invoicePath).subarray(0, 5).toString() === '%PDF-' && fs.statSync(invoicePath).size > 3000,
    'facture à présenter au bureau : téléchargée en PDF',
  );
  if (OUT && invoicePath) fs.copyFileSync(invoicePath, `${OUT}/facture-proforma-demo.pdf`);
  // « Précédent » : retour à la page d'où l'on vient (ici, le choix du paiement), puis de nouveau à la commande.
  check((await page.locator('button.back').count()) === 1, 'commande « Précédent » présente');
  await page.click('.tabbar a:nth-child(4)');
  await page.waitForSelector('.orderrow');
  check((await page.locator('.orderrow').count()) === 2, '« Mes commandes » : les deux commandes de l’essai');

  console.log('\n5. Rôles de démonstration');
  await role('paul');
  await page.click('.tabbar a:nth-child(4)');
  await page.waitForSelector('.orderrow');
  check((await page.locator('.orderrow').count()) >= 3, 'client Paul : ses commandes enregistrées');
  await page.locator('.orderrow').first().click();
  await page.waitForSelector('text=Suivi de votre commande');
  await shot('d7-paul-commande', true);
  await page.click('button.back');
  await page.waitForSelector('.orderrow');
  check((await page.locator('.orderrow').count()) >= 3, '« Précédent » ramène à la liste des commandes');

  // Langues : les 57 sont proposées ; une langue sans traduction garde les textes français.
  await page.click('.tabbar a:nth-child(1)');
  await page.waitForSelector('.cat');
  const languageSelect = page.locator('.subheader select').last();
  const languages = await languageSelect.locator('option').count();
  await languageSelect.selectOption('pt');
  await page.waitForFunction(() => document.documentElement.lang === 'pt', null, { timeout: 8000 }).catch(() => undefined);
  check(languages === 57 && (await page.getAttribute('html', 'lang')) === 'pt' && /Participer au GroupDeals/.test(await text()), `langues : ${languages} proposées ; le portugais, pas encore traduit, garde les textes français`);
  await languageSelect.selectOption('fr');

  await ctx.close();
} catch (e) {
  check(false, `interruption : ${String(e).split('\n')[0]}`);
  if (OUT) await page.screenshot({ path: `${OUT}/d-erreur.png`, fullPage: true }).catch(() => undefined);
}

// Dans la page publiée, le téléchargement passe par l'hôte (window.claude) : on le simule ici.
const hosted = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 860 } });
const p3 = await hosted.newPage();
await p3.addInitScript(() => {
  window.claude = { use: async (name) => (name === 'downloads' ? { save: async ({ filename, data }) => ((window.__saved = { filename, size: data.size, type: data.type }), { status: 'saved' }) } : null) };
});
try {
  console.log('\n5 bis. Téléchargement dans la page publiée');
  await p3.goto(BASE);
  await p3.waitForSelector('#demo-role');
  await p3.selectOption('#demo-role', 'paul');
  await p3.locator('.header__nav a', { hasText: 'Commandes' }).click();
  await p3.waitForSelector('.orderrow');
  await p3.locator('.orderrow').first().click();
  await p3.waitForSelector('text=Documents');
  await p3.locator('button', { hasText: /Facture|Reçu/ }).first().click();
  await p3.waitForFunction(() => window.__saved, null, { timeout: 15000 }).catch(() => undefined);
  const saved = await p3.evaluate(() => window.__saved ?? null);
  check(saved && /^(FA|PF|RC)-.+\.pdf$/.test(saved.filename) && saved.size > 3000, `le document est remis à l’hôte de la page pour enregistrement${saved ? ` (${saved.filename})` : ''}`);
} catch (e) {
  check(false, `interruption : ${String(e).split('\n')[0]}`);
}
await hosted.close();

// Publiée sans le droit d'enregistrer des fichiers, la démonstration ne prétend pas avoir téléchargé.
const inFrame = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 860 } });
const p4 = await inFrame.newPage();
try {
  await p4.setContent(`<iframe src="${BASE}" style="width:100%;height:820px;border:0"></iframe>`);
  const f = p4.frameLocator('iframe');
  await f.locator('#demo-role').selectOption('paul');
  await f.locator('.header__nav a', { hasText: 'Commandes' }).click();
  await f.locator('.orderrow').first().click();
  await f.locator('button', { hasText: /Facture|Reçu/ }).first().click();
  await f.locator('.toast').first().waitFor({ timeout: 15000 });
  check(/si le PDF ne s’est pas enregistré/.test(await f.locator('.toasts').innerText()), 'dans un cadre sans droit d’enregistrement : le message le dit, sans annoncer un téléchargement réussi');
} catch (e) {
  check(false, `interruption : ${String(e).split('\n')[0]}`);
}
await inFrame.close();

// Écrans du personnel, sur ordinateur.
const desk = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 860 } });
const p2 = await desk.newPage();
p2.on('pageerror', (e) => errors.push(`pageerror ${String(e).slice(0, 300)}`));
p2.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
p2.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
try {
  console.log('\n6. Back-office et espace bureau');
  await p2.goto(BASE);
  await p2.waitForSelector('#demo-role');
  await p2.selectOption('#demo-role', 'admin');
  await p2.waitForSelector('.bo__nav');
  await p2.waitForSelector('text=Chiffre d’affaires');
  if (OUT) await p2.screenshot({ path: `${OUT}/d8-admin.png` });
  const links = await p2.locator('.bo__nav a').count();
  let opened = 0;
  for (let i = 0; i < links; i++) {
    const link = p2.locator('.bo__nav a').nth(i);
    const label = (await link.innerText()).trim();
    if (/Retour au site|Se déconnecter|Espace bureau/.test(label)) continue;
    await link.click();
    await p2.waitForTimeout(500);
    const body = await p2.innerText('.bo__main');
    const bad = /Une erreur est survenue|introuvable|Cette page n’existe pas/.test(body) || body.trim().length < 20;
    if (bad) check(false, `back-office « ${label} » ne s’affiche pas`);
    else opened++;
  }
  check(opened >= 15, `back-office : ${opened} rubriques s’affichent`);
  await p2.locator('.bo__nav a', { hasText: 'Logistique' }).click();
  await p2.locator('table a').first().click();
  await p2.waitForSelector('text=Étapes du lot');
  await p2.locator('ol.steps button.btn--primary').click();
  await p2.waitForSelector('text=cette action n’est pas enregistrée');
  check(true, 'action du personnel : message « non enregistrée » au lieu d’un faux succès');
  if (OUT) await p2.screenshot({ path: `${OUT}/d9-admin-action.png` });
  await p2.selectOption('#demo-role', 'agent');
  await p2.waitForSelector('text=GROUPDEALS Douala Akwa');
  await p2.locator('table button.link').first().click();
  await p2.waitForSelector('.modal >> text=Montant à encaisser');
  check((await p2.innerText('.modal')).includes('RB-'), 'agent : fiche d’une réservation');
  if (OUT) await p2.screenshot({ path: `${OUT}/d10-agent.png` });
} catch (e) {
  check(false, `interruption : ${String(e).split('\n')[0]}`);
  if (OUT) await p2.screenshot({ path: `${OUT}/d-erreur-bureau.png`, fullPage: true }).catch(() => undefined);
}
await browser.close();

check(errors.length === 0, `aucune erreur de console ni requête en échec${errors.length ? ' : ' + [...new Set(errors)].slice(0, 6).join(' | ') : ''}`);
console.log(failures ? `\n${failures} vérification(s) en échec` : '\nDémonstration vérifiée');
process.exit(failures ? 1 : 0);
