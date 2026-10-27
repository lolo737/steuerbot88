/**
 * Wizard state + local persistence. Everything stays in the browser:
 * localStorage only, every access wrapped in try/catch, nothing is ever sent.
 */
import { APP } from './config.js';

export const SCHEMA_VERSION = 1;

export const STEPS = Object.freeze(['checklist', 'personal', 'years', 'commute', 'werbungskosten', 'review']);

export const CHECKLIST_ITEMS = Object.freeze([
  'lohnsteuerbescheinigung', 'steuerId', 'iban', 'finanzamt', 'commuteInfo', 'receipts', 'elsterAccess',
]);

export function emptyYear() {
  return {
    employer: '', gross: '', lohnsteuer: '', soli: '', kirchensteuer: '',
    documents: { lohnsteuerbescheinigung: false, receipts: false },
    commute: { km: '', days: '', ownCar: false },
    homeofficeDays: '',
    items: [],
    telefonOn: null, // null = "use config default"
    telefonMonthly: '', telefonMonths: 12,
    kontofuehrung: true,
    fortbildung: '', bewerbung: '', other: '',
  };
}

export function initialState() {
  return {
    schema: SCHEMA_VERSION,
    step: 0,
    lang: 'en',
    checklist: Object.fromEntries(CHECKLIST_ITEMS.map((k) => [k, false])),
    personal: {
      firstName: '', lastName: '', dob: '', steuerId: '', email: '',
      street: '', city: '', country: '', iban: '', accountHolder: '', finanzamt: '', lastGermanAddress: '',
    },
    plan: 'two',
    years: [],
    yearData: {},
    updatedAt: null,
  };
}

/** Deep-ish merge of saved data over a fresh initial state, so old saves gain new fields. */
function hydrate(saved) {
  const base = initialState();
  if (!saved || typeof saved !== 'object' || saved.schema !== SCHEMA_VERSION) return base;
  const out = { ...base, ...saved };
  out.checklist = { ...base.checklist, ...(saved.checklist || {}) };
  out.personal = { ...base.personal, ...(saved.personal || {}) };
  out.years = Array.isArray(saved.years) ? saved.years.map(Number).filter(Number.isInteger) : [];
  out.yearData = {};
  for (const y of out.years) {
    const e = emptyYear();
    const s = saved.yearData?.[y] || {};
    out.yearData[y] = {
      ...e, ...s,
      documents: { ...e.documents, ...(s.documents || {}) },
      commute: { ...e.commute, ...(s.commute || {}) },
      items: Array.isArray(s.items) ? s.items : [],
    };
  }
  out.step = Math.min(Math.max(Number(saved.step) || 0, 0), STEPS.length - 1);
  return out;
}

/** Resolve the storage object safely (accessing window.localStorage can itself throw). */
function defaultStorage() {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * @param {Storage|null} [storage] anything with getItem/setItem/removeItem
 * @param {string} [key]
 */
export function createStore(storage = defaultStorage(), key = APP.storageKey) {
  let state = initialState();
  let persistent = !!storage;

  function load() {
    if (!storage) return (state = initialState());
    try {
      const raw = storage.getItem(key);
      state = raw ? hydrate(JSON.parse(raw)) : initialState();
    } catch {
      persistent = false;
      state = initialState();
    }
    return state;
  }

  function save() {
    state.updatedAt = new Date().toISOString();
    if (!storage) return false;
    try {
      storage.setItem(key, JSON.stringify(state));
      persistent = true;
      return true;
    } catch {
      persistent = false;
      return false;
    }
  }

  function clear() {
    state = initialState();
    if (!storage) return false;
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  /** Apply a mutation function and persist. */
  function update(fn) {
    fn(state);
    return save();
  }

  /** Make the selected years match `years`, creating/keeping per-year data. */
  function setYears(years) {
    const sorted = [...new Set(years.map(Number))].sort((a, b) => b - a);
    state.years = sorted;
    for (const y of sorted) if (!state.yearData[y]) state.yearData[y] = emptyYear();
    for (const y of Object.keys(state.yearData)) if (!sorted.includes(Number(y))) delete state.yearData[y];
    return save();
  }

  return {
    get state() { return state; },
    get persistent() { return persistent; },
    load, save, clear, update, setYears,
  };
}
