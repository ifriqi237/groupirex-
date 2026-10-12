import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AFRICAN_COUNTRIES, africanCountry } from '../src/africa';

describe('Pays d’Afrique (annuaire des partenaires locaux)', () => {
  it('54 pays, sans doublon, chacun avec un code à deux lettres et ses deux noms', () => {
    assert.equal(AFRICAN_COUNTRIES.length, 54);
    assert.equal(new Set(AFRICAN_COUNTRIES.map((c) => c.code)).size, 54);
    for (const c of AFRICAN_COUNTRIES) {
      assert.match(c.code, /^[A-Z]{2}$/);
      assert.ok(c.fr.length > 2 && c.en.length > 2, c.code);
    }
  });

  it('la liste est rangée par ordre alphabétique français', () => {
    const names = AFRICAN_COUNTRIES.map((c) => c.fr);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'fr')));
  });

  it('recherche par code, sans tenir compte de la casse ; un pays hors d’Afrique est inconnu', () => {
    assert.equal(africanCountry('cm')?.fr, 'Cameroun');
    assert.equal(africanCountry('BW')?.en, 'Botswana');
    assert.equal(africanCountry('FR'), undefined);
  });
});
