/**
 * Field validation: IBAN (ISO 13616 mod-97), German Steuer-ID (ISO 7064 MOD 11,10),
 * plus small helpers used by the wizard. Pure functions, no DOM.
 */

/** Expected IBAN lengths for SEPA-area countries. */
export const IBAN_LENGTHS = Object.freeze({
  AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24,
  FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21,
  LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24,
  SE: 24, SI: 19, SK: 24, SM: 27,
});

export const normaliseIban = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

/** Group an IBAN in blocks of four for display. */
export const formatIban = (s) => normaliseIban(s).replace(/(.{4})(?=.)/g, '$1 ');

/** Remainder of a long numeric string mod 97, computed piecewise. */
function mod97(digits) {
  let rem = 0;
  for (let i = 0; i < digits.length; i += 7) {
    rem = Number(String(rem) + digits.slice(i, i + 7)) % 97;
  }
  return rem;
}

/**
 * @param {string} input
 * @param {{allowedCountries?: string[]}} [opts]
 * @returns {{valid: boolean, error?: string, country?: string, iban?: string}}
 */
export function validateIban(input, opts = {}) {
  const iban = normaliseIban(input);
  if (!iban) return { valid: false, error: 'required' };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return { valid: false, error: 'format' };
  const country = iban.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (!expected) return { valid: false, error: 'country_unknown', country };
  if (opts.allowedCountries && !opts.allowedCountries.includes(country)) {
    return { valid: false, error: 'country_not_allowed', country };
  }
  if (iban.length !== expected) return { valid: false, error: 'length', country };
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  if (mod97(numeric) !== 1) return { valid: false, error: 'checksum', country };
  return { valid: true, country, iban };
}

/** ISO 7064 MOD 11,10 check digit over the first ten digits. */
export function steuerIdCheckDigit(first10) {
  let product = 10;
  for (const ch of first10) {
    let sum = (Number(ch) + product) % 10;
    if (sum === 0) sum = 10;
    product = (sum * 2) % 11;
  }
  const check = 11 - product;
  return check === 10 ? 0 : check;
}

/**
 * German Steuerliche Identifikationsnummer (11 digits).
 * Rules: digits only, first digit not 0; in the first ten digits exactly one
 * digit occurs two or three times (never three in a row) and the rest once;
 * the 11th digit is the MOD 11,10 check digit.
 * @param {string} input
 */
export function validateSteuerId(input) {
  const id = String(input ?? '').replace(/[\s/.-]/g, '');
  if (!id) return { valid: false, error: 'required' };
  if (!/^\d{11}$/.test(id)) return { valid: false, error: 'format' };
  if (id[0] === '0') return { valid: false, error: 'leading_zero' };
  const first10 = id.slice(0, 10);
  const counts = {};
  for (const d of first10) counts[d] = (counts[d] || 0) + 1;
  const repeated = Object.values(counts).filter((c) => c > 1);
  if (repeated.length !== 1 || repeated[0] > 3) return { valid: false, error: 'pattern' };
  if (repeated[0] === 3 && /(\d)\1\1/.test(first10)) return { valid: false, error: 'pattern' };
  if (steuerIdCheckDigit(first10) !== Number(id[10])) return { valid: false, error: 'checksum' };
  return { valid: true, id };
}

/** Parse a user-entered euro/number amount: "1.234,56", "1,234.56", "12,5", "12.5". */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  let s = String(input ?? '').trim().replace(/[€\s]/g, '');
  if (!s) return 0;
  // Dots only, in groups of three ("48.000", "1.234.567"): German thousands separators.
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** Non-negative number (optionally integer, optionally capped). */
export function validateNumber(input, { min = 0, max = Infinity, integer = false, required = false } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return required ? { valid: false, error: 'required' } : { valid: true, value: 0 };
  const n = parseAmount(raw);
  if (Number.isNaN(n)) return { valid: false, error: 'number' };
  if (integer && !Number.isInteger(n)) return { valid: false, error: 'integer' };
  if (n < min) return { valid: false, error: 'min' };
  if (n > max) return { valid: false, error: 'max' };
  return { valid: true, value: n };
}

export function validateRequired(input) {
  return String(input ?? '').trim() ? { valid: true } : { valid: false, error: 'required' };
}

/** Very light email shape check (we never send anything; it is only printed on the summary). */
export function validateEmail(input) {
  const s = String(input ?? '').trim();
  if (!s) return { valid: true };
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { valid: true } : { valid: false, error: 'email' };
}
