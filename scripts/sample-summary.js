// Writes a printable summary built from fictional sample data, using the real
// export code. Used to produce docs/screenshot-summary.png. Usage:
//   node scripts/sample-summary.js > /some/where/sample.html
import { createStore } from '../js/state.js';
import { buildSummary, toPrintableHtml } from '../js/export.js';

const st = createStore(null);
st.load();
Object.assign(st.state.personal, {
  firstName: 'Erika', lastName: 'Musterfrau (sample)', dob: '1985-05-12', steuerId: '86095742719',
  street: '1 Example Street', city: 'D01 X2Y3 Dublin', country: 'Ireland',
  lastGermanAddress: 'Beispielstraße 8, 13347 Berlin', finanzamt: 'Finanzamt Wedding',
  iban: 'DE89370400440532013000', accountHolder: 'Erika Musterfrau',
});
st.state.plan = 'two';
st.setYears([2024, 2023]);
Object.assign(st.state.yearData[2024], {
  employer: 'Beispiel GmbH', gross: '48.000', lohnsteuer: '7.900', soli: '0', kirchensteuer: '0',
  commute: { km: 24, days: 180, ownCar: false }, homeofficeDays: 40,
  items: [{ desc: 'Monitor', amount: '249' }, { desc: 'Laptop', amount: '1.399' }],
  telefonOn: true, telefonMonthly: '45', fortbildung: '320',
});
Object.assign(st.state.yearData[2023], {
  employer: 'Beispiel GmbH', gross: '45.500', lohnsteuer: '7.100',
  commute: { km: 12, days: 160, ownCar: false }, homeofficeDays: 60, telefonOn: false,
});
process.stdout.write(toPrintableHtml(buildSummary(st.state, new Date('2026-10-27T12:00:00Z'))));
