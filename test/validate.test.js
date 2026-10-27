import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIban, formatIban, validateSteuerId, steuerIdCheckDigit, parseAmount, validateNumber, validateEmail } from '../js/validate.js';

test('IBAN: accepts well-known valid examples, with or without spaces', () => {
  for (const iban of ['DE89 3704 0044 0532 0130 00', 'GB82WEST12345698765432', 'IE29 AIBK 9311 5212 3456 78', 'de89370400440532013000']) {
    assert.equal(validateIban(iban).valid, true, iban);
  }
});

test('IBAN: rejects a single-digit typo via mod-97 checksum', () => {
  assert.deepEqual(validateIban('DE89370400440532013001').error, 'checksum');
});

test('IBAN: rejects wrong length, bad format, unknown and disallowed countries', () => {
  assert.equal(validateIban('DE8937040044053201300').error, 'length');
  assert.equal(validateIban('').error, 'required');
  assert.equal(validateIban('89DE370400').error, 'format');
  assert.equal(validateIban('XX89370400440532013000').error, 'country_unknown');
  assert.equal(validateIban('GB82WEST12345698765432', { allowedCountries: ['DE', 'IE'] }).error, 'country_not_allowed');
});

test('IBAN: formatIban groups in fours', () => {
  assert.equal(formatIban('de89370400440532013000'), 'DE89 3704 0044 0532 0130 00');
});

test('Steuer-ID: check digit algorithm (ISO 7064 MOD 11,10)', () => {
  assert.equal(steuerIdCheckDigit('8609574271'), 9);
  assert.equal(steuerIdCheckDigit('4703689281'), 6);
});

test('Steuer-ID: accepts valid IDs, including spaced input', () => {
  for (const id of ['86095742719', '47036892816', '65929970489', '57549285017', '86 095 742 719']) {
    assert.equal(validateSteuerId(id).valid, true, id);
  }
});

test('Steuer-ID: rejects wrong check digit, length, leading zero and bad digit pattern', () => {
  assert.equal(validateSteuerId('86095742718').error, 'checksum');
  assert.equal(validateSteuerId('8609574271').error, 'format');
  assert.equal(validateSteuerId('06095742719').error, 'leading_zero');
  assert.equal(validateSteuerId('12345678901').error, 'pattern'); // no repeated digit
  assert.equal(validateSteuerId('11123456780').error, 'pattern'); // three identical in a row
  assert.equal(validateSteuerId('').error, 'required');
});

test('parseAmount: German and English notation', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount('48.000'), 48000); // German thousands dot
  assert.equal(parseAmount('1.234.567'), 1234567);
  assert.equal(parseAmount('12.50'), 12.5); // two decimals stay decimal
  assert.equal(parseAmount('€ 99'), 99);
  assert.equal(parseAmount(''), 0);
  assert.ok(Number.isNaN(parseAmount('abc')));
});

test('validateNumber and validateEmail', () => {
  assert.equal(validateNumber('', { required: true }).error, 'required');
  assert.equal(validateNumber('2.5', { integer: true }).error, 'integer');
  assert.equal(validateNumber('400', { max: 366 }).error, 'max');
  assert.equal(validateNumber('-1').error, 'min');
  assert.equal(validateNumber('220', { integer: true }).value, 220);
  assert.equal(validateEmail('').valid, true);
  assert.equal(validateEmail('nope').valid, false);
});
