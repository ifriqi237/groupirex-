import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { TestEnv, createUser, participate, payOnline, setRates, startEnv } from './helpers';

/** Nouvelles catégories : Matériaux de construction, Agro-alimentaire, Abonnements. */
describe('Catégories Matériaux de construction, Agro-alimentaire, Abonnements', () => {
  let env: TestEnv;
  let admin: { token: string };
  let cm: { token: string };
  const deals: Record<string, string> = {};

  /** Produit + tarifs + campagne publiée dans la catégorie donnée. */
  async function offer(slug: string, name: string, base: number, shipping: number, moq: number) {
    const cats = (await env.api('GET', '/admin/categories', { token: admin.token })).body.categories;
    const cat = cats.find((c: any) => c.slug === slug);
    assert.ok(cat, `catégorie ${slug} présente`);
    const product = await env.api('POST', '/admin/products', {
      token: admin.token,
      body: { categoryId: cat.id, name, description: 'Produit de test', moq, basePrice: { amount: base, currency: 'XAF' } },
    });
    assert.equal(product.status, 201, JSON.stringify(product.body));
    const rates = await env.api('PUT', `/admin/products/${product.body.id}/shipping-rates`, {
      token: admin.token, body: { rates: [{ countryCode: 'CM', amount: shipping, currency: 'XAF', enabled: true }] },
    });
    assert.equal(rates.status, 200, JSON.stringify(rates.body));
    const now = env.app.clock.now().getTime();
    const deal = await env.api('POST', '/admin/deals', {
      token: admin.token,
      body: { productId: product.body.id, targetQuantity: 500, startsAt: new Date(now - 3_600_000).toISOString(), endsAt: new Date(now + 10 * 86_400_000).toISOString() },
    });
    assert.equal(deal.status, 201, JSON.stringify(deal.body));
    assert.equal((await env.api('POST', `/admin/deals/${deal.body.id}/publish`, { token: admin.token })).status, 200);
    return deal.body.id as string;
  }

  before(async () => {
    env = await startEnv();
    admin = await createUser(env, { roles: ['SUPER_ADMIN'] });
    await setRates(env, admin.token);
    cm = await createUser(env, { country: 'CM' });
    deals.materiaux = await offer('materiaux-construction', 'Ciment CPJ 42,5 — sac de 50 kg', 4_800, 700, 20);
    deals.agro = await offer('agro-alimentaire', 'Riz parfumé — sac de 25 kg', 13_000, 1_000, 5);
    // Un abonnement n'est pas expédié : tarif de livraison à 0.
    deals.abo = await offer('abonnements', 'Abonnement Internet 4G — 1 mois', 15_000, 0, 1);
  });
  after(async () => env.close());
  beforeEach(() => env.app.rateLimiter.reset());

  it('les trois catégories sont visibles sur le site, avec illustration et traduction', async () => {
    const fr = (await env.api('GET', '/categories')).body.categories;
    for (const [slug, name] of [['materiaux-construction', 'Matériaux de construction'], ['agro-alimentaire', 'Agro-alimentaire'], ['abonnements', 'Abonnements']]) {
      const c = fr.find((x: any) => x.slug === slug);
      assert.equal(c.name, name);
      assert.match(c.imageUrl, /^\/categories\/.+\.webp$/);
      assert.equal(c.activeDeals, 1, 'une offre en cours comptée');
    }
    const en = (await env.api('GET', '/categories', { headers: { 'Accept-Language': 'en' } })).body.categories;
    assert.equal(en.find((x: any) => x.slug === 'agro-alimentaire').name, 'Food & agriculture');
    const home = (await env.api('GET', '/home', { token: cm.token })).body;
    assert.ok(home.categories.some((c: any) => c.slug === 'abonnements'), 'présentes sur l’accueil');
  });

  it('le filtre par catégorie ne montre que les offres de cette catégorie', async () => {
    for (const [slug, id] of [['materiaux-construction', deals.materiaux], ['agro-alimentaire', deals.agro], ['abonnements', deals.abo]]) {
      const items = (await env.api('GET', `/group-deals?category=${slug}`, { token: cm.token })).body.items;
      assert.deepEqual(items.map((d: any) => d.id), [id]);
      assert.equal(items[0].product.category.slug, slug);
    }
    const search = (await env.api('GET', '/group-deals?q=ciment', { token: cm.token })).body.items;
    assert.deepEqual(search.map((d: any) => d.id), [deals.materiaux]);
  });

  it('prix, commande et paiement fonctionnent comme pour les autres catégories', async () => {
    const detail = (await env.api('GET', `/group-deals/${deals.materiaux}`, { token: cm.token })).body.deal;
    assert.equal(detail.price.amount, 5_500, 'prix de base + livraison');
    assert.equal(detail.product.category.name, 'Matériaux de construction');
    const abo = (await env.api('GET', `/group-deals/${deals.abo}`, { token: cm.token })).body.deal;
    assert.equal(abo.price.amount, 15_000, 'abonnement : pas de frais de livraison');
    const order = await participate(env, cm.token, deals.agro, 5);
    assert.equal(order.status, 201);
    assert.equal(order.body.order.total.amount, 70_000);
    await payOnline(env, cm.token, order.body.order.id);
    const paid = (await env.api('GET', `/group-deals/${deals.agro}`, { token: cm.token })).body.deal;
    assert.equal(paid.progress.ordered, 5);
  });
});
