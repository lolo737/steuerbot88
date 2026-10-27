/**
 * Per-step validation rules for the wizard. Pure: takes state, returns
 * a map of field path -> error code. Empty map means the step is valid.
 */
import { g, PRICING } from './config.js';
import {
  validateIban, validateSteuerId, validateNumber, validateRequired, validateEmail,
} from './validate.js';

export function validateStep(stepName, state) {
  const errs = {};
  const put = (path, res) => { if (!res.valid) errs[path] = res.error; };

  if (stepName === 'personal') {
    const p = state.personal;
    put('personal.firstName', validateRequired(p.firstName));
    put('personal.lastName', validateRequired(p.lastName));
    put('personal.dob', validateRequired(p.dob));
    put('personal.steuerId', validateSteuerId(p.steuerId));
    put('personal.email', validateEmail(p.email));
    put('personal.iban', validateIban(p.iban, { allowedCountries: g('ibanAllowedCountries') }));
    put('personal.accountHolder', validateRequired(p.accountHolder));
  }

  if (stepName === 'years') {
    const plan = PRICING.find((x) => x.id === state.plan);
    if (!state.years.length) errs.years = 'years';
    else if (plan && state.years.length > plan.years) errs.years = 'tooManyYears';
    for (const y of state.years) {
      const yd = state.yearData[y];
      put(`yearData.${y}.gross`, validateNumber(yd.gross, { required: true }));
      put(`yearData.${y}.lohnsteuer`, validateNumber(yd.lohnsteuer, { required: true }));
      put(`yearData.${y}.soli`, validateNumber(yd.soli));
      put(`yearData.${y}.kirchensteuer`, validateNumber(yd.kirchensteuer));
    }
  }

  if (stepName === 'commute') {
    for (const y of state.years) {
      const c = state.yearData[y].commute;
      put(`yearData.${y}.commute.km`, validateNumber(c.km, { integer: true, max: 1000 }));
      put(`yearData.${y}.commute.days`, validateNumber(c.days, { integer: true, max: 366 }));
    }
  }

  if (stepName === 'werbungskosten') {
    for (const y of state.years) {
      const yd = state.yearData[y];
      put(`yearData.${y}.homeofficeDays`, validateNumber(yd.homeofficeDays, { integer: true, max: 366 }));
      put(`yearData.${y}.telefonMonthly`, validateNumber(yd.telefonMonthly));
      put(`yearData.${y}.telefonMonths`, validateNumber(yd.telefonMonths, { integer: true, max: 12 }));
      for (const f of ['fortbildung', 'bewerbung', 'other']) put(`yearData.${y}.${f}`, validateNumber(yd[f]));
      yd.items.forEach((it, i) => put(`yearData.${y}.items.${i}.amount`, validateNumber(it.amount)));
    }
  }

  return errs;
}

/** Read a dotted path from an object. */
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Write a dotted path into an object (intermediate objects must exist). */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}
