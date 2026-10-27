/**
 * STEUERBOT/88 interview wizard — DOM layer.
 * Renders each step from state, writes edits back to state, persists locally.
 */
import { PRICING, eligibleYears, g, getYearConfig } from './config.js';
import { commuteAllowance, werbungskostenEstimate } from './calc.js';
import { createStore, STEPS, CHECKLIST_ITEMS } from './state.js';
import { t, alt } from './i18n.js';
import { validateStep, getPath, setPath } from './rules.js';
import { buildSummary, toJson, toPrintableHtml } from './export.js';

const store = createStore();
store.load();
const S = () => store.state;

const form = document.getElementById('wizard');
const stepsEl = document.getElementById('steps');
const statusEl = document.getElementById('status');
const backBtn = document.getElementById('back');
const nextBtn = document.getElementById('next');
const resetBtn = document.getElementById('reset');

let errors = {};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (n) => new Intl.NumberFormat(S().lang === 'de' ? 'de-DE' : 'en-IE', { style: 'currency', currency: 'EUR' }).format(n || 0);
const L = (k) => t(k, S().lang);
const A = (k) => alt(k, S().lang);
const idFor = (path) => 'f-' + path.replace(/\./g, '-');
const VERIFY = () => `<span class="verify" title="${esc(L('msg.verify'))}">verify</span>`;

function errHtml(path) {
  const code = errors[path];
  return `<span class="error" id="${idFor(path)}-err">${code ? esc(L('err.' + code)) : ''}</span>`;
}

function input(path, key, { type = 'text', inputmode, autocomplete, extra = '' } = {}) {
  const id = idFor(path);
  const val = getPath(S(), path) ?? '';
  return `<div class="field">
    <label for="${id}">${esc(L(key))}</label><span class="alt" lang="${S().lang === 'en' ? 'de' : 'en'}">${esc(A(key))}</span>
    <input id="${id}" type="${type}" data-path="${path}" value="${esc(val)}"
      ${inputmode ? `inputmode="${inputmode}"` : ''} ${autocomplete ? `autocomplete="${autocomplete}"` : ''}
      aria-invalid="${errors[path] ? 'true' : 'false'}" aria-describedby="${id}-err" ${extra}>
    ${errHtml(path)}
  </div>`;
}

function checkbox(path, key, checked, extra = '') {
  const id = idFor(path);
  return `<div class="check"><input type="checkbox" id="${id}" data-path="${path}" ${checked ? 'checked' : ''}>
    <label for="${id}">${esc(L(key))}<span class="alt">${esc(A(key))}</span>${extra}</label></div>`;
}

/* ---------- step renderers ---------- */

function renderChecklist() {
  return `<fieldset><legend>${esc(L('step.checklist'))}</legend>
    <p>${esc(L('chk.intro'))}</p>
    ${CHECKLIST_ITEMS.map((k) => checkbox(`checklist.${k}`, `chk.${k}`, S().checklist[k])).join('')}
  </fieldset>`;
}

function renderPersonal() {
  return `<fieldset><legend>${esc(L('step.personal'))}</legend>
    <div class="grid grid-2">
      ${input('personal.firstName', 'f.firstName', { autocomplete: 'given-name' })}
      ${input('personal.lastName', 'f.lastName', { autocomplete: 'family-name' })}
      ${input('personal.dob', 'f.dob', { type: 'date', autocomplete: 'bday' })}
      ${input('personal.steuerId', 'f.steuerId', { inputmode: 'numeric', extra: 'maxlength="14" placeholder="12 345 678 901"' })}
      ${input('personal.street', 'f.street', { autocomplete: 'street-address' })}
      ${input('personal.city', 'f.city', { autocomplete: 'address-level2' })}
      ${input('personal.country', 'f.country', { autocomplete: 'country-name' })}
      ${input('personal.email', 'f.email', { type: 'email', autocomplete: 'email' })}
      ${input('personal.lastGermanAddress', 'f.lastGermanAddress')}
      ${input('personal.finanzamt', 'f.finanzamt', { extra: 'placeholder="e.g. Finanzamt Wedding"' })}
      ${input('personal.iban', 'f.iban', { extra: 'placeholder="DE89 3704 0044 0532 0130 00" spellcheck="false"' })}
      ${input('personal.accountHolder', 'f.accountHolder', { autocomplete: 'name' })}
    </div>
    <p class="status">IBAN country list ${VERIFY()}</p>
  </fieldset>`;
}

function renderYears() {
  const s = S();
  const plan = PRICING.find((p) => p.id === s.plan) || PRICING[0];
  const options = eligibleYears(new Date().getFullYear(), 4);
  const planHtml = PRICING.map((p) => `<div class="check"><input type="radio" name="plan" id="plan-${p.id}" value="${p.id}" ${s.plan === p.id ? 'checked' : ''}>
    <label for="plan-${p.id}">${esc(s.lang === 'de' ? p.labelDe : p.label)} &mdash; &euro;${p.priceEur.toFixed(2)} <span class="badge">coming soon</span></label></div>`).join('');
  const yearsHtml = options.map((y) => `<div class="check"><input type="checkbox" class="year-pick" id="yr-${y}" value="${y}" ${s.years.includes(y) ? 'checked' : ''}>
    <label for="yr-${y}">${y}</label></div>`).join('');
  const perYear = s.years.map((y) => `<fieldset><legend>${y}</legend>
      <div class="grid grid-2">
        ${input(`yearData.${y}.employer`, 'y.employer')}
        ${input(`yearData.${y}.gross`, 'y.gross', { inputmode: 'decimal' })}
        ${input(`yearData.${y}.lohnsteuer`, 'y.lohnsteuer', { inputmode: 'decimal' })}
        ${input(`yearData.${y}.soli`, 'y.soli', { inputmode: 'decimal' })}
        ${input(`yearData.${y}.kirchensteuer`, 'y.kirchensteuer', { inputmode: 'decimal' })}
      </div>
      ${checkbox(`yearData.${y}.documents.lohnsteuerbescheinigung`, 'y.docLsb', s.yearData[y].documents.lohnsteuerbescheinigung)}
      ${checkbox(`yearData.${y}.documents.receipts`, 'y.docReceipts', s.yearData[y].documents.receipts)}
    </fieldset>`).join('');
  return `<fieldset><legend>${esc(L('y.plan'))}</legend>${planHtml}</fieldset>
    <fieldset><legend>${esc(L('y.pick'))}</legend>
      <p class="status">Max ${plan.years} &middot; filing window ${g('filingWindowYears')} years ${VERIFY()}</p>
      ${yearsHtml}${errors.years ? `<span class="error">${esc(L('err.' + errors.years))}</span>` : ''}
    </fieldset>${perYear}`;
}

function renderCommute() {
  const s = S();
  if (!s.years.length) return `<p>${esc(L('err.years'))}</p>`;
  return `<p>${esc(L('c.intro'))}<br><span class="alt">${esc(A('c.intro'))}</span></p>` + s.years.map((y) => {
    const c = s.yearData[y].commute;
    const cfg = getYearConfig(y).commute;
    const res = commuteAllowance(c, y);
    return `<fieldset><legend>${y}</legend>
      <div class="grid grid-2">
        ${input(`yearData.${y}.commute.km`, 'c.km', { inputmode: 'numeric' })}
        ${input(`yearData.${y}.commute.days`, 'c.days', { inputmode: 'numeric' })}
      </div>
      ${checkbox(`yearData.${y}.commute.ownCar`, 'c.ownCar', c.ownCar)}
      <p class="status">&euro;${cfg.baseRate.toFixed(2)}/km (1&ndash;${cfg.tierFromKm - 1}), &euro;${cfg.upperRate.toFixed(2)}/km (${cfg.tierFromKm}+) ${VERIFY()}</p>
      <p><strong>${esc(L('c.preview'))}:</strong> <span data-preview="commute-${y}">${eur(res.amount)}${res.capped ? ' (capped)' : ''}</span></p>
    </fieldset>`;
  }).join('');
}

function renderWerbungskosten() {
  const s = S();
  if (!s.years.length) return `<p>${esc(L('err.years'))}</p>`;
  return s.years.map((y) => {
    const yd = s.yearData[y];
    const ho = getYearConfig(y).homeoffice;
    const telOn = yd.telefonOn ?? g('telefonPauschaleDefaultOn');
    const items = yd.items.map((it, i) => `<div class="row">
        ${input(`yearData.${y}.items.${i}.desc`, 'w.itemDesc')}
        ${input(`yearData.${y}.items.${i}.amount`, 'w.itemAmount', { inputmode: 'decimal' })}
        <button type="button" class="btn ghost small" data-remove="${y}:${i}">${esc(L('w.remove'))}</button>
      </div>`).join('');
    return `<fieldset><legend>${y}</legend>
      ${input(`yearData.${y}.homeofficeDays`, 'w.homeofficeDays', { inputmode: 'numeric' })}
      <p class="status">&euro;${ho.perDay}/day, max ${ho.maxDays} days, cap &euro;${ho.cap} ${VERIFY()}</p>
      <h3>${esc(L('w.items'))}</h3>
      <p class="status">Items over &euro;${g('arbeitsmittelThresholdGross')} are listed separately, not counted ${VERIFY()}</p>
      ${items}
      <button type="button" class="btn ghost small" data-add="${y}">+ ${esc(L('w.addItem'))}</button>
      <hr>
      ${checkbox(`yearData.${y}.telefonOn`, 'w.telefonOn', telOn, ` ${VERIFY()}`)}
      ${telOn ? `<div class="grid grid-2">${input(`yearData.${y}.telefonMonthly`, 'w.telefonMonthly', { inputmode: 'decimal' })}
        ${input(`yearData.${y}.telefonMonths`, 'w.telefonMonths', { inputmode: 'numeric' })}</div>` : ''}
      ${checkbox(`yearData.${y}.kontofuehrung`, 'w.kontofuehrung', yd.kontofuehrung, ` (&euro;${g('kontofuehrungPauschale')}) ${VERIFY()}`)}
      <div class="grid grid-3">
        ${input(`yearData.${y}.fortbildung`, 'w.fortbildung', { inputmode: 'decimal' })}
        ${input(`yearData.${y}.bewerbung`, 'w.bewerbung', { inputmode: 'decimal' })}
        ${input(`yearData.${y}.other`, 'w.other', { inputmode: 'decimal' })}
      </div>
    </fieldset>`;
  }).join('');
}

function renderReview() {
  const s = S();
  const p = s.personal;
  const personal = `<div class="box"><div class="box-title">${esc(L('step.personal'))}</div>
    <table class="sum"><tbody>
      <tr><th>${esc(L('f.name'))}</th><td>${esc(p.firstName)} ${esc(p.lastName)}</td></tr>
      <tr><th>${esc(L('f.steuerId'))}</th><td>${esc(p.steuerId)}</td></tr>
      <tr><th>${esc(L('f.finanzamt'))}</th><td>${esc(p.finanzamt)}</td></tr>
      <tr><th>${esc(L('f.iban'))}</th><td>${esc(p.iban)}</td></tr>
    </tbody></table></div>`;
  const years = s.years.map((y) => {
    const e = werbungskostenEstimate(s.yearData[y], y);
    return `<div class="box"><div class="box-title">${y}</div>
      <table class="sum"><tbody>
        ${e.lines.map((l) => `<tr><th>${esc(l.label)}${l.capped ? ' (capped)' : ''}</th><td class="n">${eur(l.amount)}</td></tr>`).join('')}
        <tr class="total"><th>${esc(L('r.total'))}</th><td class="n">${eur(e.total)}</td></tr>
        <tr><th>${esc(L('r.lump'))} ${VERIFY()}</th><td class="n">${eur(e.pauschbetrag)}</td></tr>
        <tr><th>${esc(L('r.above'))}</th><td class="n">${eur(e.aboveLumpSum)}</td></tr>
      </tbody></table>
      ${e.beatsLumpSum ? '' : `<p class="status">${esc(L('r.below'))}</p>`}
      ${e.overThreshold.length ? `<p class="error">Not counted (over threshold): ${e.overThreshold.map((i) => `${esc(i.desc)} ${eur(i.amount)}`).join(', ')}</p>` : ''}
    </div>`;
  }).join('');
  return `<fieldset><legend>${esc(L('step.review'))}</legend>
    <div class="disclaimer">${esc(L('r.notice'))}</div>
    <div class="grid grid-2">${personal}${years}</div>
    <p style="margin-top:18px">
      <button type="button" class="btn" id="export-json">${esc(L('r.exportJson'))}</button>
      <button type="button" class="btn ghost" id="export-html">${esc(L('r.exportHtml'))}</button>
    </p>
  </fieldset>`;
}

const RENDER = {
  checklist: renderChecklist, personal: renderPersonal, years: renderYears,
  commute: renderCommute, werbungskosten: renderWerbungskosten, review: renderReview,
};

/* ---------- chrome ---------- */

function renderSteps() {
  const s = S();
  stepsEl.innerHTML = STEPS.map((name, i) => `<li ${i === s.step ? 'aria-current="step"' : ''} class="${i < s.step ? 'done' : ''}">
    <button type="button" data-goto="${i}" ${i > s.step ? 'disabled' : ''}>${String(i).padStart(2, '0')} ${esc(L('step.' + name))}</button></li>`).join('');
}

function render(focusFirst = false) {
  const s = S();
  document.documentElement.lang = s.lang;
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === s.lang)));
  renderSteps();
  form.innerHTML = RENDER[STEPS[s.step]]();
  backBtn.textContent = L('nav.back');
  nextBtn.textContent = L('nav.next');
  resetBtn.textContent = L('nav.reset');
  backBtn.disabled = s.step === 0;
  nextBtn.hidden = s.step === STEPS.length - 1;
  statusEl.textContent = store.persistent ? L('msg.saved') : L('msg.notSaved');
  if (focusFirst) form.querySelector('legend, input')?.closest('fieldset')?.querySelector('input')?.focus();
}

function persist() {
  store.save();
  statusEl.textContent = store.persistent ? L('msg.saved') : L('msg.notSaved');
}

/* ---------- events ---------- */

form.addEventListener('input', (e) => {
  const el = e.target;
  const path = el.dataset.path;
  if (!path || el.type === 'checkbox') return;
  setPath(S(), path, el.value);
  if (errors[path]) {
    delete errors[path];
    el.setAttribute('aria-invalid', 'false');
    const err = document.getElementById(el.id + '-err');
    if (err) err.textContent = '';
  }
  const m = path.match(/^yearData\.(\d{4})\.commute\./);
  if (m) {
    const y = Number(m[1]);
    const res = commuteAllowance(S().yearData[y].commute, y);
    const out = form.querySelector(`[data-preview="commute-${y}"]`);
    if (out) out.textContent = eur(res.amount) + (res.capped ? ' (capped)' : '');
  }
  persist();
});

form.addEventListener('change', (e) => {
  const el = e.target;
  const s = S();
  if (el.name === 'plan') {
    s.plan = el.value;
    persist();
    return render();
  }
  if (el.classList.contains('year-pick')) {
    const picked = [...form.querySelectorAll('.year-pick:checked')].map((x) => Number(x.value));
    store.setYears(picked);
    return render();
  }
  if (el.type === 'checkbox' && el.dataset.path) {
    setPath(s, el.dataset.path, el.checked);
    persist();
    if (el.dataset.path.endsWith('.telefonOn')) render();
  }
});

form.addEventListener('click', (e) => {
  const s = S();
  const add = e.target.closest('[data-add]');
  const rm = e.target.closest('[data-remove]');
  if (add) {
    s.yearData[add.dataset.add].items.push({ desc: '', amount: '' });
    persist(); render();
  } else if (rm) {
    const [y, i] = rm.dataset.remove.split(':');
    s.yearData[y].items.splice(Number(i), 1);
    persist(); render();
  } else if (e.target.id === 'export-json') {
    download(`steuerbot88-summary-${today()}.json`, toJson(buildSummary(s)), 'application/json');
  } else if (e.target.id === 'export-html') {
    const html = toPrintableHtml(buildSummary(s));
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const win = window.open(url, '_blank');
    if (!win) download(`steuerbot88-summary-${today()}.html`, html, 'text/html');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
});

form.addEventListener('submit', (e) => e.preventDefault());

stepsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto]');
  if (!b || b.disabled) return;
  errors = {};
  S().step = Number(b.dataset.goto);
  persist(); render(true);
});

nextBtn.addEventListener('click', () => {
  const s = S();
  errors = validateStep(STEPS[s.step], s);
  if (Object.keys(errors).length) {
    render();
    statusEl.textContent = L('msg.fix');
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  s.step = Math.min(s.step + 1, STEPS.length - 1);
  persist(); render(true);
  window.scrollTo({ top: 0 });
});

backBtn.addEventListener('click', () => {
  errors = {};
  S().step = Math.max(S().step - 1, 0);
  persist(); render(true);
});

resetBtn.addEventListener('click', () => {
  if (!window.confirm('Wipe everything stored by STEUERBOT/88 in this browser?')) return;
  const lang = S().lang;
  store.clear();
  S().lang = lang;
  errors = {};
  render();
});

document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
  S().lang = b.dataset.lang;
  persist(); render();
}));

function today() { return new Date().toISOString().slice(0, 10); }

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

render();
