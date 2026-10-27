/**
 * Export: a plain summary object, a JSON string, and a self-contained
 * printable HTML document (print it, or "Save as PDF" from the browser).
 * Pure functions — no DOM required, so they are unit-testable in Node.
 */
import { APP, PRICING } from './config.js';
import { estimateAll } from './calc.js';
import { formatIban, parseAmount } from './validate.js';

const DISCLAIMER =
  'PROTOTYPE OUTPUT. Not tax advice. Not affiliated with the Bundeszentralamt für Steuern, ' +
  'ELSTER or any German tax authority. Every figure used is an unverified configuration value ' +
  'and must be checked before you rely on it. You review, sign and submit your own return.';

export function buildSummary(state, now = new Date()) {
  const plan = PRICING.find((p) => p.id === state.plan) || null;
  const estimates = estimateAll(state);
  return {
    generator: `${APP.name} ${APP.tagline}`,
    generatedAt: now.toISOString(),
    disclaimer: DISCLAIMER,
    plan: plan ? { id: plan.id, label: plan.label, priceEur: plan.priceEur, paid: false } : null,
    personal: { ...state.personal, iban: formatIban(state.personal?.iban) },
    years: (state.years || []).map((y, i) => {
      const yd = state.yearData?.[y] || {};
      return {
        year: y,
        lohnsteuerbescheinigung: {
          employer: yd.employer || '',
          gross: parseAmount(yd.gross) || 0,
          lohnsteuer: parseAmount(yd.lohnsteuer) || 0,
          soli: parseAmount(yd.soli) || 0,
          kirchensteuer: parseAmount(yd.kirchensteuer) || 0,
        },
        inputs: yd,
        estimate: estimates[i],
      };
    }),
  };
}

export const toJson = (summary) => JSON.stringify(summary, null, 2);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const eur = (n) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);

export function toPrintableHtml(summary) {
  const p = summary.personal || {};
  const rows = (label, value) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
  const years = summary.years.map((y) => {
    const e = y.estimate;
    const lsb = y.lohnsteuerbescheinigung;
    return `
    <section>
      <h2>Steuerjahr ${y.year}</h2>
      <h3>Lohnsteuerbescheinigung (as entered)</h3>
      <table>
        ${rows('Arbeitgeber / Employer', lsb.employer)}
        ${rows('Bruttoarbeitslohn', eur(lsb.gross))}
        ${rows('Lohnsteuer', eur(lsb.lohnsteuer))}
        ${rows('Solidaritätszuschlag', eur(lsb.soli))}
        ${rows('Kirchensteuer', eur(lsb.kirchensteuer))}
      </table>
      <h3>Werbungskosten estimate (Anlage N)</h3>
      <table>
        ${e.lines.map((l) => rows(l.label + (l.capped ? ' (capped)' : ''), eur(l.amount))).join('')}
        <tr class="total"><th>Total</th><td>${eur(e.total)}</td></tr>
        ${rows('Arbeitnehmer-Pauschbetrag', eur(e.pauschbetrag))}
        ${rows('Above lump sum', eur(e.aboveLumpSum))}
      </table>
      ${e.overThreshold.length ? `<p class="warn">Items above the low-value threshold (not included; handle depreciation yourself): ${e.overThreshold.map((i) => `${esc(i.desc)} ${eur(i.amount)}`).join(', ')}</p>` : ''}
      <p class="small">Unverified config keys for this year: ${esc(e.unverified.join(', ') || 'none')}</p>
    </section>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>STEUERBOT/88 summary</title>
<style>
  body{font-family:"Courier New",ui-monospace,monospace;color:#111;background:#fff;max-width:780px;margin:24px auto;padding:0 16px;line-height:1.45}
  h1{font-size:1.4rem;letter-spacing:.06em;border-bottom:3px double #111;padding-bottom:6px}
  h2{font-size:1.15rem;margin-top:28px;border-bottom:1px solid #111}
  h3{font-size:.95rem;margin:14px 0 4px}
  table{width:100%;border-collapse:collapse;font-size:.9rem}
  th,td{text-align:left;padding:3px 6px;border-bottom:1px dotted #999;vertical-align:top}
  td{text-align:right;font-variant-numeric:tabular-nums}
  tr.total th,tr.total td{font-weight:bold;border-top:2px solid #111}
  .disclaimer{border:2px solid #111;padding:10px;font-size:.85rem;margin:14px 0}
  .warn{font-size:.85rem;border-left:4px solid #111;padding-left:8px}
  .small{font-size:.75rem;color:#444}
  @media print{.noprint{display:none}body{margin:0}}
</style></head><body>
<p class="noprint"><button onclick="window.print()">Print / Save as PDF</button></p>
<h1>${esc(summary.generator)}</h1>
<p class="small">Generated ${esc(summary.generatedAt)}</p>
<div class="disclaimer"><strong>Read this first.</strong> ${esc(summary.disclaimer)}</div>
<h2>Persönliche Angaben</h2>
<table>
  ${rows('Name', `${p.firstName || ''} ${p.lastName || ''}`.trim())}
  ${rows('Geburtsdatum', p.dob)}
  ${rows('Steuer-ID', p.steuerId)}
  ${rows('Anschrift', [p.street, p.city, p.country].filter(Boolean).join(', '))}
  ${rows('Letzte Anschrift in DE', p.lastGermanAddress)}
  ${rows('Finanzamt', p.finanzamt)}
  ${rows('IBAN', p.iban)}
  ${rows('Kontoinhaber/in', p.accountHolder)}
</table>
${years}
<p class="small">Use these figures to fill in ELSTER yourself. STEUERBOT/88 never submits anything.</p>
</body></html>`;
}
