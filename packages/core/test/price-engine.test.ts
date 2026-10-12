import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_CURRENCIES,
  PriceInput,
  computeUnitPrice,
  convert,
  lineTotal,
  parseRate,
  roundUpToStep,
  toPublicPrice,
} from '../src';
import { NOW, codeOf, ctx } from './fixtures';

const sandales = (country: string, shipping: number, currency = 'XAF'): PriceInput => ({
  basePrice: { amount: 10_000, currency: 'XAF' },
  shipping: { countryCode: country, amount: { amount: shipping, currency } },
  countryEnabled: true,
  targetCurrency: currency,
});

describe('Price Engine — critères du §47', () => {
  it('produit 10 000 FCFA + livraison Cameroun 1 500 FCFA = 11 500 FCFA', () => {
    const price = computeUnitPrice(sandales('CM', 1_500), ctx);
    assert.equal(price.unitFinal, 11_500);
    assert.equal(price.currency, 'XAF');
  });

  it('le client ne reçoit qu’un prix : aucune ligne de livraison', () => {
    const publicPrice = toPublicPrice(computeUnitPrice(sandales('CM', 1_500), ctx));
    assert.deepEqual(Object.keys(publicPrice).sort(), ['currency', 'unitPrice']);
    assert.equal(publicPrice.unitPrice, 11_500);
  });

  it('changer de pays recalcule le prix avec le tarif du nouveau pays', () => {
    assert.equal(computeUnitPrice(sandales('CM', 1_500), ctx).unitFinal, 11_500);
    assert.equal(computeUnitPrice(sandales('SN', 2_500, 'XOF'), ctx).unitFinal, 12_500);
  });

  it('récapitulatif : 11 500 × 20 = 230 000, sans autre frais', () => {
    assert.equal(lineTotal(11_500, 20), 230_000);
  });
});

describe('Price Engine — composants internes', () => {
  it('conserve séparément base, livraison, arrondi, taux et date du taux (§17)', () => {
    const price = computeUnitPrice(
      {
        basePrice: { amount: 1_000, currency: 'USD' }, // 10,00 USD
        shipping: { countryCode: 'KE', amount: { amount: 350_000, currency: 'KES' } }, // 3 500 KES
        countryEnabled: true,
        targetCurrency: 'KES',
      },
      ctx,
    );
    assert.equal(price.baseConverted, 130_000); // 1 300,00 KES
    assert.equal(price.shippingConverted, 350_000);
    assert.equal(price.unitFinal, 480_000);
    assert.equal(price.baseConverted + price.shippingConverted + price.roundingAdjustment, price.unitFinal);
    assert.equal(price.ratesUsed.KES.rate, '130');
    assert.equal(price.ratesUsed.KES.asOf, '2026-10-04T06:00:00Z');
    assert.deepEqual(price.baseSource, { amount: 1_000, currency: 'USD' });
  });

  it('arrondit toujours vers le haut au pas de la devise', () => {
    // 3,33 USD -> 1 998 XAF ; + 1 501 de livraison = 3 499 -> 3 500 (pas de 5)
    const price = computeUnitPrice(
      {
        basePrice: { amount: 333, currency: 'USD' },
        shipping: { countryCode: 'CM', amount: { amount: 1_501, currency: 'XAF' } },
        countryEnabled: true,
        targetCurrency: 'XAF',
      },
      ctx,
    );
    assert.equal(price.baseConverted, 1_998);
    assert.equal(price.unitFinal, 3_500);
    assert.equal(price.roundingAdjustment, 1);
  });

  it('la marge de change ne touche que les composants convertis', () => {
    const buffered = { ...ctx, fxBufferBps: 200 };
    const price = computeUnitPrice(
      {
        basePrice: { amount: 1_000, currency: 'USD' }, // 6 000 XAF au taux nu
        shipping: { countryCode: 'CM', amount: { amount: 1_500, currency: 'XAF' } },
        countryEnabled: true,
        targetCurrency: 'XAF',
      },
      buffered,
    );
    assert.equal(price.baseConverted, 6_120); // + 2 %
    assert.equal(price.shippingConverted, 1_500); // même devise : intacte
    assert.equal(price.unitFinal, 7_620);
  });

  it('XAF et XOF sont à parité fixe : Sénégal = 10 000 + 2 500 = 12 500, sans marge de change', () => {
    const pegged = { ...ctx, fxBufferBps: 200, peggedGroups: [['XAF', 'XOF']] };
    assert.equal(computeUnitPrice(sandales('SN', 2_500, 'XOF'), pegged).unitFinal, 12_500);
    // Sans ce réglage, la marge s'appliquerait à la conversion XAF -> XOF.
    assert.equal(computeUnitPrice(sandales('SN', 2_500, 'XOF'), { ...ctx, fxBufferBps: 200 }).unitFinal, 12_700);
  });

  it('un produit en XAF vendu en XAF ne subit aucune marge de change', () => {
    const price = computeUnitPrice(sandales('CM', 1_500), { ...ctx, fxBufferBps: 300 });
    assert.equal(price.unitFinal, 11_500);
  });

  it('calcule la marge estimée à partir des coûts internes', () => {
    const price = computeUnitPrice(
      {
        basePrice: { amount: 10_000, currency: 'XAF' },
        supplierCost: { amount: 1_000, currency: 'USD' }, // 6 000 XAF
        shipping: {
          countryCode: 'CM',
          amount: { amount: 1_500, currency: 'XAF' },
          freightCost: 900,
          customsCost: 300,
        },
        countryEnabled: true,
        targetCurrency: 'XAF',
      },
      ctx,
    );
    assert.equal(price.estimatedUnitMargin, 11_500 - 6_000 - 1_200);
  });

  it('sans coût fournisseur, la marge est inconnue plutôt que fausse', () => {
    assert.equal(computeUnitPrice(sandales('CM', 1_500), ctx).estimatedUnitMargin, null);
  });
});

describe('Price Engine — erreurs', () => {
  it('pays non couvert', () => {
    assert.equal(
      codeOf(() => computeUnitPrice({ ...sandales('CM', 1_500), countryEnabled: false }, ctx)),
      'COUNTRY_NOT_COVERED',
    );
  });

  it('livraison non paramétrée', () => {
    assert.equal(
      codeOf(() => computeUnitPrice({ ...sandales('CM', 1_500), shipping: null }, ctx)),
      'SHIPPING_RATE_MISSING',
    );
  });

  it('taux de change absent', () => {
    assert.equal(
      codeOf(() =>
        computeUnitPrice(
          {
            basePrice: { amount: 1_000, currency: 'USD' },
            shipping: { countryCode: 'GH', amount: { amount: 5_000, currency: 'GHS' } },
            countryEnabled: true,
            targetCurrency: 'GHS',
          },
          ctx,
        ),
      ),
      'FX_RATE_MISSING',
    );
  });

  it('taux de change périmé', () => {
    const stale = { ...ctx, maxRateAgeHours: 24, now: new Date('2026-10-10T00:00:00Z') };
    assert.equal(
      codeOf(() =>
        computeUnitPrice(
          {
            basePrice: { amount: 1_000, currency: 'USD' },
            shipping: { countryCode: 'CM', amount: { amount: 1_500, currency: 'XAF' } },
            countryEnabled: true,
            targetCurrency: 'XAF',
          },
          stale,
        ),
      ),
      'FX_RATE_STALE',
    );
  });

  it('un taux frais passe le contrôle d’âge', () => {
    const fresh = { ...ctx, maxRateAgeHours: 24, now: NOW };
    assert.equal(
      computeUnitPrice(
        {
          basePrice: { amount: 1_000, currency: 'USD' },
          shipping: { countryCode: 'CM', amount: { amount: 1_500, currency: 'XAF' } },
          countryEnabled: true,
          targetCurrency: 'XAF',
        },
        fresh,
      ).unitFinal,
      7_500,
    );
  });
});

describe('Money', () => {
  it('convertit exactement, sans flottant', () => {
    const c = DEFAULT_CURRENCIES;
    // 10,00 USD -> CNY à 7,2 = 72,00
    assert.equal(convert({ amount: 1_000, from: c.USD, to: c.CNY, fromRate: '1', toRate: '7.2' }), 7_200);
    // 72,00 CNY -> XAF : 72 / 7,2 × 600 = 6 000
    assert.equal(convert({ amount: 7_200, from: c.CNY, to: c.XAF, fromRate: '7.2', toRate: '600' }), 6_000);
    // XAF -> XOF à parité
    assert.equal(convert({ amount: 12_345, from: c.XAF, to: c.XOF, fromRate: '600', toRate: '600' }), 12_345);
  });

  it('0,1 + 0,2 : le piège classique ne se produit pas', () => {
    const c = DEFAULT_CURRENCIES;
    // 0,30 USD à 655,957 = 196,7871 -> 197 XAF
    assert.equal(convert({ amount: 30, from: c.USD, to: c.XAF, fromRate: '1', toRate: '655.957' }), 197);
  });

  it('refuse les taux invalides', () => {
    assert.throws(() => parseRate('0'));
    assert.throws(() => parseRate('-1'));
    assert.throws(() => parseRate('abc'));
    assert.throws(() => parseRate('1.123456789'));
    assert.equal(parseRate('655.957'), 65_595_700_000n);
  });

  it('arrondi au pas supérieur', () => {
    assert.equal(roundUpToStep(11_500, 5), 11_500);
    assert.equal(roundUpToStep(11_501, 5), 11_505);
    assert.equal(roundUpToStep(0, 5), 0);
  });
});
