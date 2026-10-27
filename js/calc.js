/**
 * Werbungskosten arithmetic. Pure functions driven by js/config.js.
 * Produces an ESTIMATE of deductible employment expenses only — it does not
 * calculate income tax or a refund. All figures are prototype values.
 */
import { getYearConfig, g } from './config.js';
import { parseAmount } from './validate.js';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (x) => {
  const n = parseAmount(x);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Entfernungspauschale: one-way km × working days, tiered rate.
 * @param {{km:number|string, days:number|string, ownCar?:boolean}} input
 * @param {number} year
 */
export function commuteAllowance({ km, days, ownCar = false }, year) {
  const { commute } = getYearConfig(year);
  const distance = Math.floor(num(km)); // only full kilometres count
  const d = Math.floor(num(days));
  if (!distance || !d) return { amount: 0, capped: false, lowerKm: 0, upperKm: 0 };
  const lowerKm = Math.min(distance, commute.tierFromKm - 1);
  const upperKm = Math.max(0, distance - (commute.tierFromKm - 1));
  let amount = d * (lowerKm * commute.baseRate + upperKm * commute.upperRate);
  let capped = false;
  if (!ownCar && amount > commute.capWithoutCar) {
    amount = commute.capWithoutCar;
    capped = true;
  }
  return { amount: round2(amount), capped, lowerKm, upperKm };
}

/** Homeoffice-Pauschale: days × daily rate, limited by max days and the annual cap. */
export function homeofficeAllowance(days, year) {
  const { homeoffice } = getYearConfig(year);
  const globalCap = g('homeofficeCapAnnual');
  const d = Math.min(Math.floor(num(days)), homeoffice.maxDays);
  const raw = d * homeoffice.perDay;
  const cap = Math.min(homeoffice.cap, globalCap);
  return { amount: round2(Math.min(raw, cap)), capped: raw > cap || num(days) > homeoffice.maxDays, days: d };
}

/** Telefon-/Internet-Pauschale from an average monthly bill. */
export function telefonAllowance(monthlyBill, months = 12) {
  const perMonth = Math.min(num(monthlyBill) * g('telefonShare'), g('telefonMonthlyCap'));
  return round2(perMonth * Math.min(Math.max(Math.floor(num(months)), 0), 12));
}

/**
 * Split work equipment into items counted now (≤ threshold) and items that
 * need depreciation handled by the user (> threshold).
 * @param {{desc:string, amount:number|string}[]} items
 */
export function arbeitsmittel(items = []) {
  const threshold = g('arbeitsmittelThresholdGross');
  let counted = 0;
  const overThreshold = [];
  for (const it of items) {
    const a = num(it?.amount);
    if (!a) continue;
    if (a <= threshold) counted += a;
    else overThreshold.push({ desc: it.desc || '', amount: a });
  }
  return { amount: round2(counted), overThreshold, threshold };
}

/**
 * Full per-year Werbungskosten estimate.
 * @param {object} yd the wizard's data for one year
 * @param {number} year
 */
export function werbungskostenEstimate(yd = {}, year) {
  const cfg = getYearConfig(year);
  const commute = commuteAllowance(yd.commute || {}, year);
  const homeoffice = homeofficeAllowance(yd.homeofficeDays, year);
  const equipment = arbeitsmittel(yd.items);
  const telefonOn = yd.telefonOn ?? g('telefonPauschaleDefaultOn'); // null = not chosen yet
  const telefon = telefonOn ? telefonAllowance(yd.telefonMonthly, yd.telefonMonths ?? 12) : 0;
  const konto = yd.kontofuehrung ? g('kontofuehrungPauschale') : 0;
  const lines = [
    { key: 'commute', label: 'Entfernungspauschale', amount: commute.amount, capped: commute.capped },
    { key: 'homeoffice', label: 'Homeoffice-Pauschale', amount: homeoffice.amount, capped: homeoffice.capped },
    { key: 'arbeitsmittel', label: 'Arbeitsmittel', amount: equipment.amount },
    { key: 'telefon', label: 'Telefon/Internet', amount: telefon },
    { key: 'konto', label: 'Kontoführung', amount: konto },
    { key: 'fortbildung', label: 'Fortbildung', amount: round2(num(yd.fortbildung)) },
    { key: 'bewerbung', label: 'Bewerbungskosten', amount: round2(num(yd.bewerbung)) },
    { key: 'other', label: 'Sonstige', amount: round2(num(yd.other)) },
  ];
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const pauschbetrag = cfg.arbeitnehmerPauschbetrag;
  return {
    year: cfg.year,
    lines,
    total,
    pauschbetrag,
    aboveLumpSum: round2(Math.max(0, total - pauschbetrag)),
    beatsLumpSum: total > pauschbetrag,
    overThreshold: equipment.overThreshold,
    unverified: cfg.unverified,
  };
}

/** Estimate for every selected year in a wizard state. */
export function estimateAll(state) {
  return (state.years || []).map((y) => werbungskostenEstimate(state.yearData?.[y] || {}, y));
}
