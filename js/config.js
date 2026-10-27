/**
 * STEUERBOT/88 — central configuration.
 *
 * EVERY figure in this file is a PROTOTYPE VALUE. Each one carries
 * `verify: true` until a qualified person (Steuerberater / Lohnsteuerhilfeverein)
 * has checked it against the law in force for that tax year.
 * Nothing here is tax advice.
 *
 * Shape of a flagged value:  { value, verify, note }
 */

/** @param {*} value @param {string} note */
const v = (value, note) => Object.freeze({ value, verify: true, note });

export const APP = Object.freeze({
  name: 'STEUERBOT/88',
  version: '1.0.0',
  tagline: 'v1.0.0 — Tax Recovery System',
  storageKey: 'steuerbot88.wizard.v1',
});

/** Product-level settings that are unconfirmed (the "Ledger of Doubt"). */
export const GLOBAL = Object.freeze({
  filingWindowYears: v(4,
    'Voluntary assessment (Antragsveranlagung) assumed possible for 4 years after the end of the tax year.'),
  arbeitsmittelThresholdGross: v(952,
    'Low-value asset (GWG) limit assumed €800 net = €952 gross. Items above it are NOT added to the estimate; they need depreciation (AfA) handled manually.'),
  homeofficeCapAnnual: v(1260,
    'Homeoffice-Pauschale annual cap assumed €1,260 (from 2023). Per-year caps below override this.'),
  ibanAllowedCountries: v(
    ['AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU',
      'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'SM'],
    'Assumes the Finanzamt will pay a refund into any SEPA-area account. Not confirmed.'),
  telefonPauschaleDefaultOn: v(true,
    'Telefon-/Internet-Pauschale toggle starts switched ON (20% of bill, max €20/month). Default behaviour unconfirmed.'),
  telefonShare: v(0.2, 'Share of phone/internet bill assumed deductible without itemised proof.'),
  telefonMonthlyCap: v(20, 'Monthly cap on the Telefon-Pauschale, in euro.'),
  kontofuehrungPauschale: v(16, 'Account-fee flat rate commonly accepted by tax offices; not statutory.'),
});

/**
 * Per-tax-year figures. Keys are calendar years.
 * commute: rate per km of one-way distance per working day, split at `tierFromKm`.
 */
export const TAX_YEARS = Object.freeze({
  2021: Object.freeze({
    commute: v({ baseRate: 0.30, tierFromKm: 21, upperRate: 0.35, capWithoutCar: 4500 },
      '€0.30/km for km 1–20, €0.35 from km 21.'),
    arbeitnehmerPauschbetrag: v(1000, 'Employee lump sum.'),
    homeoffice: v({ perDay: 5, maxDays: 120, cap: 600 }, '€5/day, max €600.'),
  }),
  2022: Object.freeze({
    commute: v({ baseRate: 0.30, tierFromKm: 21, upperRate: 0.38, capWithoutCar: 4500 },
      '€0.30/km for km 1–20, €0.38 from km 21.'),
    arbeitnehmerPauschbetrag: v(1200, 'Employee lump sum.'),
    homeoffice: v({ perDay: 5, maxDays: 120, cap: 600 }, '€5/day, max €600.'),
  }),
  2023: Object.freeze({
    commute: v({ baseRate: 0.30, tierFromKm: 21, upperRate: 0.38, capWithoutCar: 4500 },
      '€0.30/km for km 1–20, €0.38 from km 21.'),
    arbeitnehmerPauschbetrag: v(1230, 'Employee lump sum.'),
    homeoffice: v({ perDay: 6, maxDays: 210, cap: 1260 }, '€6/day, max €1,260.'),
  }),
  2024: Object.freeze({
    commute: v({ baseRate: 0.30, tierFromKm: 21, upperRate: 0.38, capWithoutCar: 4500 },
      '€0.30/km for km 1–20, €0.38 from km 21.'),
    arbeitnehmerPauschbetrag: v(1230, 'Employee lump sum.'),
    homeoffice: v({ perDay: 6, maxDays: 210, cap: 1260 }, '€6/day, max €1,260.'),
  }),
  2025: Object.freeze({
    commute: v({ baseRate: 0.30, tierFromKm: 21, upperRate: 0.38, capWithoutCar: 4500 },
      '€0.30/km for km 1–20, €0.38 from km 21.'),
    arbeitnehmerPauschbetrag: v(1230, 'Employee lump sum.'),
    homeoffice: v({ perDay: 6, maxDays: 210, cap: 1260 }, '€6/day, max €1,260.'),
  }),
});

export const PRICING = Object.freeze([
  Object.freeze({ id: 'two', label: 'Last 2 Years', labelDe: 'Letzte 2 Jahre', years: 2, priceEur: 19.99 }),
  Object.freeze({ id: 'four', label: 'Last 4 Years', labelDe: 'Letzte 4 Jahre', years: 4, priceEur: 29.99 }),
]);

/** Thrown when a tax year has no configuration. */
export class UnsupportedYearError extends Error {
  constructor(year) {
    super(`No configuration for tax year ${year}`);
    this.name = 'UnsupportedYearError';
    this.year = year;
  }
}

/**
 * Look up the configuration for one tax year, returning plain values
 * plus the list of keys that still need verifying.
 * @param {number|string} year
 */
export function getYearConfig(year) {
  const y = Number(year);
  const entry = TAX_YEARS[y];
  if (!Number.isInteger(y) || !entry) throw new UnsupportedYearError(year);
  const values = {};
  const unverified = [];
  for (const [key, item] of Object.entries(entry)) {
    values[key] = item.value;
    if (item.verify) unverified.push(key);
  }
  return { year: y, ...values, unverified };
}

/** Plain value of a GLOBAL setting. */
export function g(key) {
  if (!(key in GLOBAL)) throw new Error(`Unknown global setting: ${key}`);
  return GLOBAL[key].value;
}

/**
 * Tax years selectable today: the `filingWindowYears` completed years before
 * `currentYear`, newest first, limited to years we actually have config for.
 * @param {number} currentYear
 * @param {number} [count] how many years the plan covers (2 or 4)
 */
export function eligibleYears(currentYear, count = g('filingWindowYears')) {
  const n = Math.min(count, g('filingWindowYears'));
  const out = [];
  for (let i = 1; i <= n; i++) {
    const y = currentYear - i;
    if (TAX_YEARS[y]) out.push(y);
  }
  return out;
}

/** Flattened list of every flagged value, for the README / UI "Ledger of Doubt". */
export function ledgerOfDoubt() {
  const rows = [];
  for (const [key, item] of Object.entries(GLOBAL)) {
    if (item.verify) rows.push({ scope: 'global', key, value: item.value, note: item.note });
  }
  for (const [year, entry] of Object.entries(TAX_YEARS)) {
    for (const [key, item] of Object.entries(entry)) {
      if (item.verify) rows.push({ scope: year, key, value: item.value, note: item.note });
    }
  }
  return rows;
}
