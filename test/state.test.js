import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, initialState, SCHEMA_VERSION } from '../js/state.js';
import { validateStep } from '../js/rules.js';
import { buildSummary, toJson, toPrintableHtml } from '../js/export.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('nope'); } };

test('state persists and reloads through storage', () => {
  const storage = memoryStorage();
  const a = createStore(storage, 'k');
  a.load();
  a.update((s) => { s.personal.firstName = 'Niall'; s.step = 2; });
  a.setYears([2023, 2024, 2023]);
  const b = createStore(storage, 'k');
  const s = b.load();
  assert.equal(s.personal.firstName, 'Niall');
  assert.equal(s.step, 2);
  assert.deepEqual(s.years, [2024, 2023]);
  assert.ok(s.yearData[2024].commute);
  assert.ok(s.updatedAt);
});

test('setYears drops data for deselected years', () => {
  const st = createStore(memoryStorage(), 'k');
  st.load();
  st.setYears([2024, 2023]);
  st.state.yearData[2023].gross = '1000';
  st.setYears([2024]);
  assert.equal(st.state.yearData[2023], undefined);
});

test('corrupt JSON and wrong schema fall back to a fresh state', () => {
  const storage = memoryStorage();
  storage.setItem('k', '{not json');
  assert.deepEqual(createStore(storage, 'k').load().personal, initialState().personal);
  storage.setItem('k', JSON.stringify({ schema: SCHEMA_VERSION + 99, step: 4 }));
  assert.equal(createStore(storage, 'k').load().step, 0);
});

test('old saves gain new fields when hydrated', () => {
  const storage = memoryStorage();
  storage.setItem('k', JSON.stringify({ schema: SCHEMA_VERSION, years: [2024], yearData: { 2024: { gross: '5' } }, step: 99 }));
  const s = createStore(storage, 'k').load();
  assert.equal(s.yearData[2024].gross, '5');
  assert.equal(s.yearData[2024].kontofuehrung, true);
  assert.equal(s.step, 5); // clamped to last step
});

test('throwing storage never throws out of the store', () => {
  const st = createStore(throwing, 'k');
  assert.doesNotThrow(() => st.load());
  assert.equal(st.save(), false);
  assert.equal(st.persistent, false);
  assert.equal(st.clear(), false);
});

test('missing storage works in memory only', () => {
  const st = createStore(null, 'k');
  st.load();
  assert.equal(st.update((s) => { s.lang = 'de'; }), false);
  assert.equal(st.state.lang, 'de');
});

test('clear wipes storage', () => {
  const storage = memoryStorage();
  const st = createStore(storage, 'k');
  st.load(); st.save();
  assert.ok(storage._m.has('k'));
  st.clear();
  assert.ok(!storage._m.has('k'));
});

test('step rules: personal step flags bad Steuer-ID and IBAN', () => {
  const s = initialState();
  Object.assign(s.personal, { firstName: 'A', lastName: 'B', dob: '1980-01-01', steuerId: '86095742718', iban: 'DE89370400440532013001', accountHolder: 'A B' });
  const errs = validateStep('personal', s);
  assert.equal(errs['personal.steuerId'], 'checksum');
  assert.equal(errs['personal.iban'], 'checksum');
  s.personal.steuerId = '86095742719';
  s.personal.iban = 'DE89370400440532013000';
  assert.deepEqual(validateStep('personal', s), {});
});

test('step rules: years step enforces plan size', () => {
  const st = createStore(null, 'k');
  st.load();
  assert.equal(validateStep('years', st.state).years, 'years');
  st.setYears([2025, 2024, 2023]);
  assert.equal(validateStep('years', st.state).years, 'tooManyYears');
});

test('export: JSON and printable HTML carry the disclaimer and escape input', () => {
  const st = createStore(null, 'k');
  st.load();
  st.state.personal.lastName = '<script>x</script>';
  st.setYears([2024]);
  const sum = buildSummary(st.state, new Date('2026-01-01T00:00:00Z'));
  assert.match(sum.disclaimer, /Not tax advice/);
  assert.equal(sum.plan.paid, false);
  assert.equal(JSON.parse(toJson(sum)).years[0].year, 2024);
  const html = toPrintableHtml(sum);
  assert.ok(!html.includes('<script>x'));
  assert.match(html, /PROTOTYPE OUTPUT/);
});
