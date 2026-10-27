import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commuteAllowance, homeofficeAllowance, telefonAllowance, arbeitsmittel, werbungskostenEstimate, estimateAll } from '../js/calc.js';

test('commute: short distance uses base rate only', () => {
  // 15 km × 220 days × €0.30
  assert.equal(commuteAllowance({ km: 15, days: 220 }, 2022).amount, 990);
});

test('commute: tiered rate from km 21 differs by year', () => {
  // 30 km × 200 days: 20×0.30 + 10×upper
  assert.equal(commuteAllowance({ km: 30, days: 200, ownCar: true }, 2021).amount, 1900);
  assert.equal(commuteAllowance({ km: 30, days: 200, ownCar: true }, 2023).amount, 1960);
  const r = commuteAllowance({ km: 30, days: 1, ownCar: true }, 2023);
  assert.equal(r.lowerKm, 20);
  assert.equal(r.upperKm, 10);
});

test('commute: fractional km are floored; empty input is zero', () => {
  assert.equal(commuteAllowance({ km: '10,9', days: 10 }, 2022).amount, 30);
  assert.equal(commuteAllowance({ km: '', days: '' }, 2022).amount, 0);
});

test('commute: cap applies without own car, not with', () => {
  const noCar = commuteAllowance({ km: 80, days: 230 }, 2024);
  assert.equal(noCar.amount, 4500);
  assert.equal(noCar.capped, true);
  const car = commuteAllowance({ km: 80, days: 230, ownCar: true }, 2024);
  assert.ok(car.amount > 4500);
  assert.equal(car.capped, false);
});

test('homeoffice: per-day rate, max days and cap', () => {
  assert.equal(homeofficeAllowance(100, 2021).amount, 500);
  assert.equal(homeofficeAllowance(200, 2021).amount, 600);
  assert.equal(homeofficeAllowance(150, 2023).amount, 900);
  const big = homeofficeAllowance(300, 2023);
  assert.equal(big.amount, 1260);
  assert.equal(big.capped, true);
});

test('telefon: 20% capped at €20/month', () => {
  assert.equal(telefonAllowance(50, 12), 120);
  assert.equal(telefonAllowance(200, 12), 240);
  assert.equal(telefonAllowance(50, 6), 60);
});

test('arbeitsmittel: items over the threshold are split out, not counted', () => {
  const r = arbeitsmittel([{ desc: 'Desk', amount: '300' }, { desc: 'Laptop', amount: '1.299,00' }, { desc: 'Chair', amount: 952 }]);
  assert.equal(r.amount, 1252);
  assert.deepEqual(r.overThreshold, [{ desc: 'Laptop', amount: 1299 }]);
});

test('werbungskosten estimate: totals lines and compares with the lump sum', () => {
  const e = werbungskostenEstimate({
    commute: { km: 25, days: 200, ownCar: true },
    homeofficeDays: 20,
    items: [{ desc: 'Monitor', amount: 250 }],
    telefonOn: true, telefonMonthly: 40, telefonMonths: 12,
    kontofuehrung: true,
    fortbildung: '100', bewerbung: '', other: '',
  }, 2022);
  // commute 200×(20×0.30+5×0.38)=1580; HO 100; items 250; tel 96; konto 16; fortb 100
  assert.equal(e.total, 2142);
  assert.equal(e.pauschbetrag, 1200);
  assert.equal(e.aboveLumpSum, 942);
  assert.equal(e.beatsLumpSum, true);
});

test('werbungskosten estimate: below lump sum and telefon off', () => {
  const e = werbungskostenEstimate({ commute: { km: 5, days: 100 }, telefonOn: false, kontofuehrung: false }, 2023);
  assert.equal(e.total, 150);
  assert.equal(e.aboveLumpSum, 0);
  assert.equal(e.beatsLumpSum, false);
});

test('werbungskosten estimate: unset telefon toggle follows the config default', () => {
  const e = werbungskostenEstimate({ telefonOn: null, telefonMonthly: 45, kontofuehrung: false }, 2024);
  assert.equal(e.lines.find((l) => l.key === 'telefon').amount, 108); // default is ON in config
});

test('estimateAll runs per selected year', () => {
  const out = estimateAll({ years: [2024, 2023], yearData: { 2024: {}, 2023: {} } });
  assert.deepEqual(out.map((e) => e.year), [2024, 2023]);
});
