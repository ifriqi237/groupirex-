import { DEFAULT_CURRENCIES, DealState, PriceContext } from '../src';

export const NOW = new Date('2026-10-04T12:00:00Z');

/** Taux d'exemple : unités de devise pour 1 USD. XAF et XOF partagent la même parité. */
export const ctx: PriceContext = {
  referenceCurrency: 'USD',
  currencies: DEFAULT_CURRENCIES,
  rates: {
    XAF: { rate: '600', asOf: '2026-10-04T06:00:00Z', source: 'TEST' },
    XOF: { rate: '600', asOf: '2026-10-04T06:00:00Z', source: 'TEST' },
    KES: { rate: '130', asOf: '2026-10-04T06:00:00Z', source: 'TEST' },
    NGN: { rate: '1500', asOf: '2026-10-04T06:00:00Z', source: 'TEST' },
    CNY: { rate: '7.2', asOf: '2026-10-04T06:00:00Z', source: 'TEST' },
  },
  fxBufferBps: 0,
  now: NOW,
};

export function deal(overrides: Partial<DealState> = {}): DealState {
  return {
    storedStatus: 'PUBLISHED',
    startsAt: new Date('2026-10-01T00:00:00Z'),
    endsAt: new Date('2026-10-20T00:00:00Z'),
    targetQuantity: 1000,
    maxQuantity: null,
    paidQuantity: 100,
    heldQuantity: 0,
    ...overrides,
  };
}

/** Exécute `fn` et renvoie le code de la DomainError levée, ou null. */
export function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? `UNEXPECTED:${String(e)}`;
  }
}
