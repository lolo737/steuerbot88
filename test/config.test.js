import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getYearConfig, UnsupportedYearError, eligibleYears, ledgerOfDoubt, GLOBAL, TAX_YEARS, g } from '../js/config.js';

test('getYearConfig returns plain values for a configured year', () => {
  const c = getYearConfig(2022);
  assert.equal(c.year, 2022);
  assert.equal(c.arbeitnehmerPauschbetrag, 1200);
  assert.equal(c.commute.upperRate, 0.38);
  assert.deepEqual(c.unverified.sort(), ['arbeitnehmerPauschbetrag', 'commute', 'homeoffice']);
});

test('getYearConfig accepts string years and differs per year', () => {
  assert.equal(getYearConfig('2021').commute.upperRate, 0.35);
  assert.equal(getYearConfig(2023).homeoffice.cap, 1260);
  assert.equal(getYearConfig(2021).homeoffice.cap, 600);
});

test('getYearConfig throws UnsupportedYearError for unknown years', () => {
  assert.throws(() => getYearConfig(1988), UnsupportedYearError);
  assert.throws(() => getYearConfig('banana'), UnsupportedYearError);
});

test('eligibleYears: newest first, bounded by window and plan', () => {
  assert.deepEqual(eligibleYears(2026, 4), [2025, 2024, 2023, 2022]);
  assert.deepEqual(eligibleYears(2026, 2), [2025, 2024]);
  assert.deepEqual(eligibleYears(2026, 9), [2025, 2024, 2023, 2022]); // clamped to filing window
  assert.deepEqual(eligibleYears(2027, 4), [2026 in TAX_YEARS ? 2026 : null, 2025, 2024, 2023].filter(Boolean));
});

test('every config value is flagged verify: true (nothing is confirmed yet)', () => {
  for (const item of Object.values(GLOBAL)) assert.equal(item.verify, true);
  for (const year of Object.values(TAX_YEARS)) for (const item of Object.values(year)) assert.equal(item.verify, true);
  const keys = ledgerOfDoubt().map((r) => r.key);
  for (const k of ['filingWindowYears', 'arbeitsmittelThresholdGross', 'homeofficeCapAnnual', 'ibanAllowedCountries', 'telefonPauschaleDefaultOn']) {
    assert.ok(keys.includes(k), k);
  }
});

test('the five headline unverified figures hold the briefed values', () => {
  assert.equal(g('filingWindowYears'), 4);
  assert.equal(g('arbeitsmittelThresholdGross'), 952);
  assert.equal(g('homeofficeCapAnnual'), 1260);
  assert.equal(g('telefonPauschaleDefaultOn'), true);
  assert.ok(g('ibanAllowedCountries').includes('IE'));
  assert.throws(() => g('nope'));
});
