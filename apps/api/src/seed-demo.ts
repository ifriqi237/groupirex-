/**
 * Jeu de données de démonstration. Jamais exécuté en production.
 *
 * Les commandes sont créées par les mêmes fonctions que l'API (createOrder,
 * applyPayment) : les compteurs, factures et expéditions sont donc cohérents.
 *
 * ATTENTION : les taux de change ci-dessous sont FICTIFS. Ils servent à faire
 * tourner la démonstration, pas à vendre.
 */

import type { App } from './app';
import { hashPassword } from './lib/crypto';
import { syncTranslations } from './modules/reference';
import { slugify } from './modules/admin-catalog';
import { applyPayment, attachToShipment, createOrder, newPickupCode } from './services/orders';

export const DEMO_PASSWORD = 'Groupdeals2026!';
const DAY = 86_400_000;

const RATES: Record<string, string> = {
  XAF: '600', XOF: '600', NGN: '1500', GHS: '12', KES: '129', TZS: '2600', UGX: '3650', RWF: '1400', ETB: '130', ZAR: '18',
  AOA: '915', MZN: '64', CDF: '2850', GNF: '8650', MAD: '9.8', DZD: '133', TND: '3.1', EGP: '49', CNY: '7.2', EUR: '0.92',
  // Monnaies des pays ouverts par la migration 0018 (valeurs fictives, ordre de grandeur seulement).
  BWP: '13.5', BIF: '2950', CVE: '101', KMF: '455', DJF: '178', ERN: '15', SZL: '18', GMD: '71', LSL: '18', LRD: '190', LYD: '5.4', MGA: '4500',
  MWK: '1735', MUR: '46', MRU: '40', NAD: '18', STN: '22.6', SCR: '14', SLE: '22.5', SOS: '571', SDG: '600', SSP: '4500', ZMW: '26',
};

const hours = { mon: [['08:00', '17:30']], tue: [['08:00', '17:30']], wed: [['08:00', '17:30']], thu: [['08:00', '17:30']], fri: [['08:00', '17:30']], sat: [['09:00', '13:00']] };

interface ProductSeed {
  category: string;
  name: string;
  en: { name: string; description: string };
  description: string;
  features: string[];
  specs: [string, string][];
  origin: string;
  lead: [number, number];
  saleUnit?: 'UNIT' | 'LOT' | 'CARTON' | 'PALLET';
  pieces?: number;
  moq: number;
  base: [number, string];
  compareAt?: number;
  supplier: [number, string];
  image: string;
  /** Photo réelle (apps/web/public/photos/<photo>.webp, préparée par scripts/product-image.py) ; sinon l'illustration. */
  photo?: string;
  /** Vues de détail (<photo>-d1.webp…) et vidéo (<photo>.mp4) du carrousel, produites par scripts/product-gallery.py. */
  details?: number;
  video?: boolean;
  variants?: [string, Record<string, string>, number][];
  /** pays -> [livraison, devise, coût fret, coût douane] */
  shipping: Record<string, [number, string, number, number]>;
}

const PRODUCTS: ProductSeed[] = [
  {
    category: 'mode-femme', name: 'Sandales en cuir tressé', image: 'sandales', photo: 'sandales-cuir', details: 2, video: true,
    en: { name: 'Braided leather sandals', description: 'Handmade braided leather sandals with a cushioned sole. Sold by the pair.' },
    description: 'Sandales en cuir tressé à la main, semelle amortie, finition soignée. Vendues à la paire.',
    features: ['Cuir véritable, tressage main', 'Semelle antidérapante amortie', 'Boîte individuelle'],
    specs: [['Matière', 'Cuir pleine fleur'], ['Semelle', 'Caoutchouc TPR'], ['Pointures', '37 à 41']],
    origin: 'Chine — Guangzhou', lead: [35, 50], moq: 10, base: [10_000, 'XAF'], compareAt: 16_000, supplier: [950, 'USD'],
    variants: [['Camel / 38', { couleur: 'Camel', pointure: '38' }, 0], ['Camel / 40', { couleur: 'Camel', pointure: '40' }, 0], ['Noir / 38', { couleur: 'Noir', pointure: '38' }, 0], ['Noir / 40', { couleur: 'Noir', pointure: '40' }, 0]],
    shipping: { CM: [1_500, 'XAF', 900, 300], SN: [2_500, 'XOF', 1_500, 500], CI: [2_300, 'XOF', 1_400, 450], KE: [75_000, 'KES', 42_000, 14_000], NG: [350_000, 'NGN', 200_000, 70_000] },
  },
  {
    category: 'mode-homme', name: 'Chemise en wax manches courtes', image: 'chemise', photo: 'chemise-wax', details: 2, video: true,
    en: { name: 'Short-sleeve wax print shirt', description: 'Men\'s short-sleeve shirt in 100% cotton wax print. Assorted patterns.' },
    description: 'Chemise homme manches courtes en wax 100 % coton. Motifs assortis, coupe droite.',
    features: ['100 % coton', 'Couleurs grand teint', 'Coupe droite confortable'],
    specs: [['Matière', 'Coton wax 140 g/m²'], ['Tailles', 'M, L, XL'], ['Entretien', 'Lavage 30 °C']],
    origin: 'Chine — Shaoxing', lead: [30, 45], moq: 12, base: [650, 'USD'], compareAt: 1_100, supplier: [410, 'USD'],
    variants: [['Taille M', { taille: 'M' }, 0], ['Taille L', { taille: 'L' }, 0], ['Taille XL', { taille: 'XL' }, 30]],
    shipping: { CM: [700, 'XAF', 420, 150], SN: [900, 'XOF', 520, 180], CI: [850, 'XOF', 500, 170], NG: [180_000, 'NGN', 100_000, 40_000], GH: [1_400, 'GHS', 800, 300] },
  },
  {
    category: 'mode-enfant', name: 'Ensemble enfant 3 pièces', image: 'enfant', photo: 'ensemble-enfant', details: 3, video: true,
    en: { name: 'Kids 3-piece set', description: 'T-shirt, shorts and cap set in soft cotton for children aged 4 to 8.' },
    description: 'Ensemble t-shirt, short et casquette en coton doux, pour enfants de 4 à 8 ans.',
    features: ['Coton peigné doux', 'Élastique à la taille', 'Imprimés sans phtalates'],
    specs: [['Matière', 'Coton 95 %, élasthanne 5 %'], ['Âges', '4, 6 et 8 ans']],
    origin: 'Chine — Zhili', lead: [30, 45], moq: 20, base: [2_800, 'CNY'], compareAt: 4_600, supplier: [1_900, 'CNY'],
    variants: [['4 ans', { âge: '4 ans' }, 0], ['6 ans', { âge: '6 ans' }, 0], ['8 ans', { âge: '8 ans' }, 150]],
    shipping: { CM: [600, 'XAF', 350, 120], SN: [800, 'XOF', 460, 160], CI: [750, 'XOF', 440, 150], KE: [26_000, 'KES', 15_000, 5_000] },
  },
  {
    category: 'papier', name: 'Papier A4 80 g — carton de 5 ramettes', image: 'papier', photo: 'papier-a4', details: 3, video: true,
    en: { name: 'A4 paper 80 gsm — box of 5 reams', description: 'White multipurpose A4 paper, 80 gsm, 500 sheets per ream. Sold by the box of 5 reams.' },
    description: 'Papier blanc multifonction A4, 80 g/m², 500 feuilles par ramette. Vendu par carton de 5 ramettes.',
    features: ['Blancheur CIE 161', 'Compatible laser et jet d\'encre', 'Carton de 5 ramettes (2 500 feuilles)'],
    specs: [['Format', 'A4 — 210 × 297 mm'], ['Grammage', '80 g/m²'], ['Conditionnement', '5 ramettes par carton']],
    origin: 'Indonésie', lead: [40, 55], saleUnit: 'CARTON', pieces: 5, moq: 20, base: [9_500, 'XAF'], compareAt: 13_500, supplier: [1_180, 'USD'],
    shipping: { CM: [1_900, 'XAF', 1_300, 300], GA: [2_400, 'XAF', 1_600, 400], SN: [2_600, 'XOF', 1_700, 450], CI: [2_500, 'XOF', 1_650, 420] },
  },
  {
    category: 'energie-solaire', name: 'Panneau solaire 550 W monocristallin', image: 'panneau', photo: 'panneau-550w', details: 2, video: true,
    en: { name: '550 W monocrystalline solar panel', description: 'Half-cut monocrystalline PERC panel, 550 W, 21.3% efficiency, 25-year performance warranty.' },
    description: 'Panneau monocristallin PERC demi-cellules, 550 W, rendement 21,3 %, garantie de performance 25 ans.',
    features: ['144 demi-cellules PERC', 'Cadre aluminium anodisé', 'Garantie produit 12 ans'],
    specs: [['Puissance', '550 Wc'], ['Rendement', '21,3 %'], ['Dimensions', '2278 × 1134 × 35 mm'], ['Poids', '28 kg']],
    origin: 'Chine — Jiangsu', lead: [40, 60], moq: 4, base: [7_800, 'USD'], compareAt: 11_500, supplier: [6_100, 'USD'],
    shipping: { CM: [8_000, 'XAF', 5_500, 1_500], SN: [11_000, 'XOF', 7_500, 2_000], CI: [10_500, 'XOF', 7_200, 1_900], KE: [220_000, 'KES', 150_000, 40_000], NG: [2_600_000, 'NGN', 1_800_000, 500_000] },
  },
  {
    category: 'energie-solaire', name: 'Kit solaire 3 kVA — onduleur et batterie lithium', image: 'kit', photo: 'kit-solaire', details: 2, video: true,
    en: { name: '3 kVA solar kit — inverter and lithium battery', description: 'Hybrid 3 kVA inverter with a 5 kWh LiFePO4 battery. Powers a home or a small shop.' },
    description: 'Onduleur hybride 3 kVA et batterie LiFePO4 5 kWh. Alimente une maison ou une petite boutique.',
    features: ['Onduleur hybride MPPT 80 A', 'Batterie LiFePO4 5 kWh, 6 000 cycles', 'Écran et suivi Wi-Fi'],
    specs: [['Puissance', '3 kVA / 2 400 W'], ['Batterie', '51,2 V — 100 Ah'], ['Garantie', '5 ans']],
    origin: 'Chine — Shenzhen', lead: [45, 60], moq: 1, base: [64_000, 'USD'], compareAt: 92_000, supplier: [51_000, 'USD'],
    shipping: { CM: [45_000, 'XAF', 32_000, 8_000], SN: [58_000, 'XOF', 40_000, 10_000], CI: [55_000, 'XOF', 38_000, 9_500] },
  },
  {
    category: 'gadgets', name: 'Écouteurs Bluetooth 5.3 — lot de 10', image: 'ecouteurs', photo: 'ecouteurs-bluetooth', details: 2, video: true,
    en: { name: 'Bluetooth 5.3 earbuds — pack of 10', description: 'True wireless earbuds with charging case, 24 h battery life. Sold in packs of 10.' },
    description: 'Écouteurs sans fil avec boîtier de charge, 24 h d\'autonomie. Vendus par lot de 10.',
    features: ['Bluetooth 5.3', 'Boîtier de charge USB-C', 'Autonomie 6 h + 18 h'],
    specs: [['Autonomie', '24 h avec boîtier'], ['Charge', 'USB-C'], ['Conditionnement', '10 pièces par lot']],
    origin: 'Chine — Shenzhen', lead: [25, 40], saleUnit: 'LOT', pieces: 10, moq: 2, base: [4_200, 'USD'], compareAt: 7_000, supplier: [3_100, 'USD'],
    shipping: { CM: [1_800, 'XAF', 1_100, 400], SN: [2_400, 'XOF', 1_400, 500], CI: [2_300, 'XOF', 1_350, 480], NG: [450_000, 'NGN', 260_000, 90_000], KE: [42_000, 'KES', 25_000, 8_000] },
  },
  {
    category: 'gadgets', name: 'Lampe solaire portable 3 modes', image: 'lampe',
    en: { name: 'Portable solar lamp, 3 modes', description: 'Rechargeable solar LED lamp with USB output to charge a phone.' },
    description: 'Lampe LED solaire rechargeable, sortie USB pour recharger un téléphone.',
    features: ['3 intensités', 'Sortie USB 5 V', 'Résiste à la pluie (IP65)'],
    specs: [['Batterie', '4 000 mAh'], ['Autonomie', 'Jusqu\'à 18 h']],
    origin: 'Chine — Ningbo', lead: [30, 45], moq: 30, base: [310, 'USD'], compareAt: 520, supplier: [215, 'USD'],
    shipping: { CM: [350, 'XAF', 200, 80], SN: [450, 'XOF', 260, 100] },
  },
  {
    category: 'mode-femme', name: 'Sac à main bandoulière', image: 'sac', photo: 'sac-bandouliere', details: 3, video: true,
    en: { name: 'Crossbody handbag', description: 'Grained faux-leather crossbody handbag with an adjustable strap.' },
    description: 'Sac à main en simili cuir grainé, bandoulière réglable, fermeture zippée.',
    features: ['Bandoulière réglable', 'Poche intérieure zippée', 'Doublure renforcée'],
    specs: [['Matière', 'Simili cuir grainé'], ['Dimensions', '26 × 18 × 9 cm']],
    origin: 'Chine — Baigou', lead: [30, 45], moq: 15, base: [5_400, 'XOF'], compareAt: 8_500, supplier: [520, 'USD'],
    shipping: { CM: [900, 'XAF', 500, 200], SN: [1_100, 'XOF', 620, 240], CI: [1_050, 'XOF', 600, 230] },
  },
  {
    category: 'gadgets', name: 'Batterie externe 20 000 mAh', image: 'powerbank',
    en: { name: '20,000 mAh power bank', description: 'Fast-charge 22.5 W power bank with two USB-A ports and one USB-C port.' },
    description: 'Batterie externe charge rapide 22,5 W, deux ports USB-A et un port USB-C.',
    features: ['Charge rapide 22,5 W', 'Écran de niveau', '3 ports'],
    specs: [['Capacité', '20 000 mAh'], ['Poids', '420 g']],
    origin: 'Chine — Shenzhen', lead: [25, 40], moq: 10, base: [680, 'USD'], compareAt: 1_050, supplier: [500, 'USD'],
    shipping: { CM: [500, 'XAF', 300, 120], SN: [650, 'XOF', 380, 150] },
  },
];

export async function seedDemo(app: App): Promise<void> {
  if (app.config.env === 'production') throw new Error('Le jeu de démonstration ne peut pas être chargé en production.');
  const already = await app.db.one(`SELECT 1 FROM users WHERE email = 'superadmin@groupdeals.test'`);
  if (already) {
    app.log.info('seed', { skipped: 'déjà chargé' });
    return;
  }
  await syncTranslations(app);
  const db = app.db;
  const realNow = new Date();
  const hash = await hashPassword(DEMO_PASSWORD);

  /* ---- Réglages de démonstration ---- */
  await db.query(`UPDATE settings SET value = '0' WHERE key = 'pricing.max_rate_age_hours'`); // les taux fictifs n'expirent pas
  await db.query(`INSERT INTO settings (key, value) VALUES ('reporting.currency', '"XAF"') ON CONFLICT (key) DO NOTHING`);
  await db.query(`UPDATE settings SET value = '5' WHERE key = 'matching.alert_threshold'`);
  await db.query(`UPDATE settings SET value = '1440' WHERE key = 'orders.online_hold_minutes'`); // 24 h pour payer en ligne, le temps d'une démonstration
  for (const asOf of [new Date(realNow.getTime() - 90 * DAY), new Date(realNow.getTime() - 3_600_000)]) {
    for (const [currency, rate] of Object.entries(RATES)) {
      await db.query(`INSERT INTO exchange_rates (currency_code, rate, as_of, source) VALUES ($1, $2, $3, 'DÉMO — valeur fictive')`, [currency, rate, asOf]);
    }
  }
  app.reference.invalidate();

  /* ---- Utilisateurs ---- */
  const users: Record<string, string> = {};
  const addUser = async (key: string, email: string, first: string, last: string, country: string, whatsapp: string, roles: string[], lang = 'fr') => {
    const u = await db.one(
      `INSERT INTO users (email, password_hash, first_name, last_name, country_code, whatsapp, language_code, email_verified_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [email, hash, first, last, country, whatsapp, lang, realNow, new Date(realNow.getTime() - Math.floor(Math.random() * 60) * DAY)],
    );
    for (const role of ['CUSTOMER', ...roles]) await db.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)`, [u!.id, role]);
    users[key] = u!.id;
  };
  await addUser('super', 'superadmin@groupdeals.test', 'Nadia', 'Fotso', 'CM', '+237690000001', ['SUPER_ADMIN']);
  await addUser('admin', 'admin@groupdeals.test', 'Serge', 'Etoundi', 'CM', '+237690000002', ['ADMIN']);
  await addUser('logistics', 'logistique@groupdeals.test', 'Brice', 'Ngassa', 'CM', '+237690000003', ['LOGISTICS_MANAGER']);
  await addUser('finance', 'finance@groupdeals.test', 'Clarisse', 'Mbella', 'CM', '+237690000004', ['FINANCE_MANAGER']);
  await addUser('moderator', 'moderation@groupdeals.test', 'Yves', 'Tchana', 'CM', '+237690000005', ['MODERATOR']);
  await addUser('managerDouala', 'bureau.douala@groupdeals.test', 'Solange', 'Ekambi', 'CM', '+237690000006', ['OFFICE_MANAGER']);
  await addUser('agentDouala', 'agent.douala@groupdeals.test', 'Patrick', 'Moukoko', 'CM', '+237690000007', ['OFFICE_AGENT']);
  await addUser('agentDakar', 'agent.dakar@groupdeals.test', 'Fatou', 'Diop', 'SN', '+221770000008', ['OFFICE_AGENT']);
  await addUser('paul', 'paul@groupdeals.test', 'Paul', 'Mbarga', 'CM', '+237677000011', []);
  await addUser('awa', 'awa@groupdeals.test', 'Awa', 'Ndiaye', 'SN', '+221770000012', []);
  await addUser('grace', 'grace@groupdeals.test', 'Grace', 'Wanjiru', 'KE', '+254712000013', [], 'en');
  await addUser('chinedu', 'chinedu@groupdeals.test', 'Chinedu', 'Okafor', 'NG', '+2348030000014', [], 'en');
  await addUser('aminata', 'aminata@groupdeals.test', 'Aminata', 'Koné', 'CI', '+2250700000015', []);
  await addUser('jean', 'jean@groupdeals.test', 'Jean', 'Biyong', 'CM', '+237677000016', []);
  await addUser('mariama', 'mariama@groupdeals.test', 'Mariama', 'Sow', 'SN', '+221770000017', []);
  await addUser('esther', 'esther@groupdeals.test', 'Esther', 'Ndongo', 'CM', '+237677000018', []);

  /* ---- Bureaux ---- */
  const offices: Record<string, string> = {};
  const addOffice = async (key: string, country: string, name: string, city: string, address: string, phone: string, tz: string, lat: number, lng: number) => {
    const o = await db.one(
      `INSERT INTO local_offices (country_code, name, city, address, phone, whatsapp, email, opening_hours, timezone, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [country, name, city, address, phone, `${slugify(city)}@groupdeals.test`, JSON.stringify(hours), tz, lat, lng],
    );
    offices[key] = o!.id;
  };
  await addOffice('douala', 'CM', 'GROUPDEALS Douala Akwa', 'Douala', 'Boulevard de la Liberté, Akwa', '+237233000101', 'Africa/Douala', 4.0483, 9.7043);
  await addOffice('yaounde', 'CM', 'GROUPDEALS Yaoundé Centre', 'Yaoundé', 'Avenue Kennedy, Centre-ville', '+237222000102', 'Africa/Douala', 3.8667, 11.5167);
  await addOffice('dakar', 'SN', 'GROUPDEALS Dakar Plateau', 'Dakar', 'Avenue Georges Pompidou, Plateau', '+221338000103', 'Africa/Dakar', 14.6708, -17.4381);
  await addOffice('abidjan', 'CI', 'GROUPDEALS Abidjan Plateau', 'Abidjan', 'Boulevard de la République, Plateau', '+2252720000104', 'Africa/Abidjan', 5.3237, -4.0168);
  await addOffice('nairobi', 'KE', 'GROUPDEALS Nairobi CBD', 'Nairobi', 'Moi Avenue, CBD', '+254202000105', 'Africa/Nairobi', -1.2833, 36.8219);
  await addOffice('lagos', 'NG', 'GROUPDEALS Lagos Ikeja', 'Lagos', 'Obafemi Awolowo Way, Ikeja', '+2341200000106', 'Africa/Lagos', 6.6018, 3.3515);
  await db.query(`INSERT INTO local_office_agents (office_id, user_id, position) VALUES ($1, $2, 'MANAGER'), ($1, $3, 'AGENT'), ($4, $5, 'AGENT')`, [
    offices.douala, users.managerDouala, users.agentDouala, offices.dakar, users.agentDakar,
  ]);

  /* ---- Catalogue ---- */
  const productIds: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const cat = await db.one(`SELECT id FROM categories WHERE slug = $1`, [p.category]);
    const row = await db.one(
      `INSERT INTO products (category_id, slug, name, description, features, specifications, origin_country, lead_time_days_min, lead_time_days_max,
                             sale_unit, pieces_per_sale_unit, moq, base_price_amount, base_price_currency, compare_at_amount,
                             supplier_cost_amount, supplier_cost_currency, i18n, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [cat!.id, slugify(p.name), p.name, p.description, JSON.stringify(p.features), JSON.stringify(p.specs.map(([label, value]) => ({ label, value }))),
       p.origin, p.lead[0], p.lead[1], p.saleUnit ?? 'UNIT', p.pieces ?? 1, p.moq, p.base[0], p.base[1], p.compareAt ?? null,
       p.supplier[0], p.supplier[1], JSON.stringify({ en: p.en }), users.admin],
    );
    productIds[p.image] = row!.id;
    if (p.photo) {
      await db.query(`INSERT INTO product_media (product_id, kind, url, thumbnail_url, alt, sort_order) VALUES ($1, 'IMAGE', $2, $3, $4, 0)`, [
        row!.id, `/photos/${p.photo}.webp`, `/photos/${p.photo}-480.webp`, p.name,
      ]);
      // Carrousel : les vues de détail, puis la vidéo (son aperçu est la photo du produit).
      for (let n = 1; n <= (p.details ?? 0); n++) {
        await db.query(`INSERT INTO product_media (product_id, kind, url, thumbnail_url, alt, sort_order) VALUES ($1, 'IMAGE', $2, $3, $4, $5)`, [
          row!.id, `/photos/${p.photo}-d${n}.webp`, `/photos/${p.photo}-d${n}-480.webp`, `${p.name} — détail ${n}`, n,
        ]);
      }
      if (p.video) {
        await db.query(`INSERT INTO product_media (product_id, kind, url, thumbnail_url, alt, sort_order) VALUES ($1, 'VIDEO', $2, $3, $4, $5)`, [
          row!.id, `/photos/${p.photo}.mp4`, `/photos/${p.photo}-480.webp`, `${p.name} — vidéo`, (p.details ?? 0) + 1,
        ]);
      }
    } else {
      await db.query(`INSERT INTO product_media (product_id, kind, url, thumbnail_url, alt, sort_order) VALUES ($1, 'IMAGE', $2, $2, $3, 0), ($1, 'IMAGE', $4, $4, $3, 1)`, [
        row!.id, `/demo/${p.image}.svg`, p.name, `/demo/${p.image}-2.svg`,
      ]);
    }
    for (const [i, [label, attributes, delta]] of (p.variants ?? []).entries()) {
      await db.query(`INSERT INTO product_variants (product_id, sku, label, attributes, price_delta_amount, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`, [
        row!.id, `${p.image.toUpperCase()}-${i + 1}`, label, JSON.stringify(attributes), delta, i,
      ]);
    }
    for (const [country, [amount, currency, freight, customs]] of Object.entries(p.shipping)) {
      await db.query(`INSERT INTO product_countries (product_id, country_code) VALUES ($1, $2)`, [row!.id, country]);
      await db.query(
        `INSERT INTO shipping_rates (product_id, country_code, amount, currency_code, freight_cost, customs_cost, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row!.id, country, amount, currency, freight, customs, users.admin, new Date(realNow.getTime() - 80 * DAY)],
      );
    }
  }

  // Illustrations provisoires, sauf pour les catégories qui ont déjà leur image.
  await db.query(`UPDATE categories SET image_url = '/demo/cat-' || slug || '.svg' WHERE image_url IS NULL`);

  /* ---- Campagnes ---- */
  const dealIds: Record<string, string> = {};
  const addDeal = async (key: string, startDays: number, endDays: number, target: number, opts: { max?: number; featured?: boolean; status?: string } = {}) => {
    const p = PRODUCTS.find((x) => x.image === key)!;
    const startsAt = new Date(realNow.getTime() + startDays * DAY);
    const row = await db.one(
      `INSERT INTO group_deals (product_id, slug, stored_status, base_price_amount, base_price_currency, compare_at_amount, target_quantity,
                                min_quantity, max_quantity, starts_at, ends_at, is_featured, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$10) RETURNING id`,
      [productIds[key], `${slugify(p.name)}-${startsAt.toISOString().slice(0, 7)}`, opts.status ?? 'PUBLISHED', p.base[0], p.base[1], p.compareAt ?? null,
       target, p.moq, opts.max ?? null, startsAt, new Date(realNow.getTime() + endDays * DAY), !!opts.featured, users.admin],
    );
    dealIds[key] = row!.id;
  };
  await addDeal('sandales', -6, 9, 2_000, { featured: true });
  await addDeal('chemise', -8, 4, 1_200);
  await addDeal('enfant', -3, 12, 1_500);
  await addDeal('papier', -12, 1.5, 800, { featured: true });
  await addDeal('panneau', -5, 15, 400, { max: 600, featured: true });
  await addDeal('kit', -4, 20, 60);
  await addDeal('ecouteurs', -9, 6, 500);
  await addDeal('lampe', -50, -22, 1_500);      // terminée et confirmée plus bas
  await addDeal('sac', 3, 17, 900);             // à venir
  await addDeal('powerbank', -20, -1, 2_000);   // terminée sans atteindre l'objectif : décision à prendre

  /* ---- Commandes ---- */
  let n = 0;
  const order = async (
    user: string, deal: string, items: [number | null, number][], opts: { method?: 'ONLINE' | 'OFFICE'; office?: string; pickup?: string; pay?: boolean; at?: number } = {},
  ): Promise<string> => {
    const variantRows = await db.all(`SELECT id FROM product_variants WHERE product_id = $1 ORDER BY sort_order`, [productIds[deal]]);
    app.clock.offsetMs = (opts.at ?? 0) * DAY;
    try {
      const { orderId } = await createOrder(app, {
        userId: users[user],
        dealId: dealIds[deal],
        items: items.map(([v, quantity]) => ({ variantId: v === null ? null : variantRows[v].id, quantity })),
        paymentMethod: opts.method ?? 'ONLINE',
        officeId: opts.office ? offices[opts.office] : null,
        pickupOfficeId: opts.pickup ? offices[opts.pickup] : null,
        idempotencyKey: `seed-${++n}`,
      });
      if (opts.pay ?? true) {
        if (opts.method === 'OFFICE') {
          await applyPayment(app, orderId, { provider: 'OFFICE', channel: 'CASH', agentId: users.agentDouala });
        } else {
          const o = await db.one(`SELECT tx_ref, total_amount, currency_code FROM orders WHERE id = $1`, [orderId]);
          const c = await app.reference.currency(o!.currency_code);
          await applyPayment(app, orderId, {
            provider: 'SANDBOX',
            verification: { providerId: `seed-${n}`, status: 'successful', reference: o!.tx_ref, amountMajor: o!.total_amount / 10 ** c.decimals, currency: o!.currency_code },
          });
        }
      }
      return orderId;
    } finally {
      app.clock.offsetMs = 0;
    }
  };

  // Sandales : plusieurs pays, plusieurs variantes
  await order('paul', 'sandales', [[0, 120], [2, 180]], { pickup: 'douala', at: -5 });
  await order('awa', 'sandales', [[1, 200], [3, 150]], { pickup: 'dakar', at: -4 });
  await order('aminata', 'sandales', [[0, 260]], { pickup: 'abidjan', at: -3 });
  await order('grace', 'sandales', [[2, 90], [3, 110]], { pickup: 'nairobi', at: -2 });
  await order('chinedu', 'sandales', [[1, 130]], { pickup: 'lagos', at: -1 });
  await order('esther', 'sandales', [[0, 20]], { pickup: 'yaounde', pay: false });                      // en attente de paiement en ligne
  await order('jean', 'sandales', [[2, 50]], { method: 'OFFICE', office: 'douala', pay: false });       // réservation bureau à encaisser

  await order('paul', 'chemise', [[0, 60], [1, 120], [2, 60]], { pickup: 'douala', at: -6 });
  await order('mariama', 'chemise', [[1, 300]], { pickup: 'dakar', at: -5 });
  await order('chinedu', 'chemise', [[0, 240], [2, 190]], { pickup: 'lagos', at: -3 });

  await order('awa', 'enfant', [[0, 80], [1, 80]], { pickup: 'dakar', at: -2 });
  await order('grace', 'enfant', [[1, 140]], { pickup: 'nairobi', at: -1 });

  await order('jean', 'papier', [[null, 310]], { pickup: 'douala', at: -9 });
  await order('aminata', 'papier', [[null, 220]], { pickup: 'abidjan', at: -6 });
  await order('mariama', 'papier', [[null, 190]], { pickup: 'dakar', at: -2 });

  await order('paul', 'panneau', [[null, 60]], { method: 'OFFICE', office: 'douala', at: -4 });        // payée au bureau
  await order('awa', 'panneau', [[null, 44]], { pickup: 'dakar', at: -3 });
  await order('chinedu', 'panneau', [[null, 90]], { pickup: 'lagos', at: -2 });
  await order('esther', 'panneau', [[null, 24]], { method: 'OFFICE', office: 'yaounde', pay: false }); // réservation bureau en attente

  await order('aminata', 'kit', [[null, 6]], { pickup: 'abidjan', at: -3 });
  await order('jean', 'kit', [[null, 9]], { pickup: 'douala', at: -1 });

  await order('grace', 'ecouteurs', [[null, 70]], { pickup: 'nairobi', at: -7 });
  await order('paul', 'ecouteurs', [[null, 110]], { pickup: 'douala', at: -5 });
  await order('mariama', 'ecouteurs', [[null, 95]], { pickup: 'dakar', at: -2 });

  await order('paul', 'powerbank', [[null, 300]], { pickup: 'douala', at: -15 });
  await order('awa', 'powerbank', [[null, 420]], { pickup: 'dakar', at: -10 });

  // Lampe : campagne passée, confirmée, expéditions en cours
  const lamp1 = await order('paul', 'lampe', [[null, 600]], { pickup: 'douala', at: -45 });
  const lamp2 = await order('esther', 'lampe', [[null, 400]], { pickup: 'yaounde', at: -40 });
  const lamp3 = await order('awa', 'lampe', [[null, 700]], { pickup: 'dakar', at: -35 });
  const lamp4 = await order('jean', 'lampe', [[null, 150]], { pickup: 'douala', at: -30 });
  const decidedAt = new Date(realNow.getTime() - 21 * DAY);
  await db.query(`UPDATE group_deals SET stored_status = 'COMPLETED', decided_at = $2, decided_by = $3 WHERE id = $1`, [dealIds.lampe, decidedAt, users.admin]);
  for (const [id, country] of [[lamp1, 'CM'], [lamp2, 'CM'], [lamp3, 'SN'], [lamp4, 'CM']] as const) await attachToShipment(db, id, dealIds.lampe, country, decidedAt);

  const advance = async (country: string, upTo: number, startDaysAgo: number) => {
    const s = await db.one(`SELECT id FROM shipments WHERE deal_id = $1 AND country_code = $2`, [dealIds.lampe, country]);
    for (let step = 1; step <= upTo; step++) {
      await db.query(`INSERT INTO logistics_tracking (shipment_id, step, status, actor_id, occurred_at) VALUES ($1, $2, 'VALIDATED', $3, $4)`, [
        s!.id, step, users.logistics, new Date(realNow.getTime() - (startDaysAgo - step * 2.5) * DAY),
      ]);
    }
    await db.query(`UPDATE shipments SET current_step = $2 WHERE id = $1`, [s!.id, upTo]);
    return s!.id as string;
  };
  // Cameroun : lot dédouané, deux commandes prêtes au retrait, une déjà retirée
  const cm = await advance('CM', 7, 20);
  await db.query(
    `UPDATE shipments SET vessel_name = 'MSC AURORA', vessel_imo = '9839272', container_number = 'MSCU7654321', bill_of_lading = 'MEDUGZ123456',
            departure_port = 'Ningbo', arrival_port = 'Douala' WHERE id = $1`,
    [cm],
  );
  for (const id of [lamp1, lamp2, lamp4]) {
    await db.query(`UPDATE orders SET pickup_step = 8, pickup_code = $2 WHERE id = $1`, [id, newPickupCode()]);
    await db.query(`INSERT INTO logistics_tracking (order_id, step, status, actor_id, occurred_at) VALUES ($1, 8, 'VALIDATED', $2, $3)`, [id, users.logistics, new Date(realNow.getTime() - 2 * DAY)]);
  }
  await db.query(`UPDATE orders SET pickup_step = 9, picked_up_at = $2 WHERE id = $1`, [lamp4, new Date(realNow.getTime() - DAY)]);
  await db.query(`INSERT INTO logistics_tracking (order_id, step, status, actor_id, occurred_at) VALUES ($1, 9, 'VALIDATED', $2, $3)`, [lamp4, users.agentDouala, new Date(realNow.getTime() - DAY)]);
  // Sénégal : navire en mer
  const sn = await advance('SN', 5, 18);
  await db.query(
    `UPDATE shipments SET vessel_name = 'CMA CGM KRIBI', vessel_imo = '9450648', container_number = 'CMAU1234567', bill_of_lading = 'NGB0987654',
            departure_port = 'Ningbo', arrival_port = 'Dakar', eta = $2, vessel_position = $3 WHERE id = $1`,
    [sn, new Date(realNow.getTime() + 9 * DAY), JSON.stringify({ latitude: -32.4, longitude: 14.8, progressPercent: 68, updatedAt: realNow.toISOString(), source: 'MANUAL' })],
  );

  /* ---- Matching ---- */
  const cats = Object.fromEntries((await db.all(`SELECT slug, id FROM categories`)).map((c) => [c.slug, c.id]));
  const addMatching = async (user: string, title: string, description: string, category: string, qty: number, status: string, interested: [string, number | null][]) => {
    const u = await db.one(`SELECT country_code FROM users WHERE id = $1`, [users[user]]);
    const m = await db.one(
      `INSERT INTO matching_requests (user_id, title, description, category_id, country_code, desired_quantity, status, moderated_by, moderated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [users[user], title, description, cats[category], u!.country_code, qty, status, status === 'PENDING_REVIEW' ? null : users.moderator, status === 'PENDING_REVIEW' ? null : realNow],
    );
    for (const [who, q] of interested) {
      await db.query(`INSERT INTO matching_interests (request_id, user_id, quantity) VALUES ($1, $2, $3)`, [m!.id, users[who], q]);
    }
    await db.query(
      `UPDATE matching_requests SET interest_count = $2, total_quantity = $3, threshold_alerted_at = CASE WHEN $2 >= 5 THEN now() END WHERE id = $1`,
      [m!.id, interested.length, interested.reduce((s, [, q]) => s + (q ?? 0), 0)],
    );
  };
  await addMatching('paul', 'Panneaux solaires 550 W bifaciaux', 'Je recherche des panneaux bifaciaux 550 W pour équiper plusieurs boutiques à Douala.', 'energie-solaire', 40, 'PUBLISHED',
    [['awa', 20], ['jean', 12], ['aminata', 30], ['esther', 8], ['chinedu', 50], ['mariama', 16]]);
  await addMatching('awa', 'Tissu bazin riche, rouleaux de 10 mètres', 'Bazin riche qualité supérieure, coloris variés, pour revente à Dakar.', 'mode-femme', 100, 'PUBLISHED', [['mariama', 60], ['aminata', 40], ['paul', null]]);
  await addMatching('grace', 'Cahiers scolaires 200 pages', 'Exercise books for the January school term, 200 pages, A4.', 'papier', 5000, 'PUBLISHED', [['chinedu', 3000], ['jean', 1500]]);
  await addMatching('jean', 'Ventilateurs solaires rechargeables 16 pouces', 'Ventilateurs sur batterie avec panneau, pour les coupures de courant.', 'gadgets', 60, 'PENDING_REVIEW', []);
  await addMatching('esther', 'Baskets enfant lumineuses', 'Pointures 28 à 34, plusieurs couleurs.', 'mode-enfant', 80, 'PENDING_REVIEW', []);

  /* ---- Favoris et mesures d'audience ---- */
  for (const [u, p] of [['paul', 'panneau'], ['paul', 'kit'], ['awa', 'sandales'], ['grace', 'ecouteurs'], ['esther', 'sandales'], ['jean', 'papier']]) {
    await db.query(`INSERT INTO favorites (user_id, product_id) VALUES ($1, $2)`, [users[u], productIds[p]]);
  }
  const views: [string, number][] = [['sandales', 640], ['panneau', 510], ['chemise', 330], ['papier', 280], ['ecouteurs', 260], ['kit', 190], ['enfant', 170]];
  for (const [deal, count] of views) {
    await db.query(
      `INSERT INTO analytics_events (type, entity_type, entity_id, country_code, created_at)
       SELECT 'deal_view', 'deal', $1, (ARRAY['CM','SN','CI','KE','NG'])[1 + (g % 5)], now() - (g % 28) * interval '1 day' FROM generate_series(1, $2) g`,
      [dealIds[deal], count],
    );
  }
  // Les notifications de la démonstration sont marquées envoyées pour ne pas inonder le journal.
  await db.query(`UPDATE notification_outbox SET status = 'SENT', sent_at = now()`);
  app.log.info('seed', { users: Object.keys(users).length, products: PRODUCTS.length, deals: Object.keys(dealIds).length, orders: n });
}
