/**
 * Bilingual labels. Every label is shown in the chosen language with the
 * other language beneath it, so German form terms stay visible in EN mode
 * (handy when you later copy figures into ELSTER).
 */
export const STRINGS = {
  // steps
  'step.checklist': { en: 'Go Get These', de: 'Unterlagen besorgen' },
  'step.personal': { en: 'Personal Details', de: 'Persönliche Angaben' },
  'step.years': { en: 'Tax Years + Documents', de: 'Steuerjahre + Unterlagen' },
  'step.commute': { en: 'Commute Details', de: 'Fahrten zur Arbeit' },
  'step.werbungskosten': { en: 'Work Expenses', de: 'Werbungskosten' },
  'step.review': { en: 'Review', de: 'Überprüfung' },

  // checklist
  'chk.intro': {
    en: 'Gather these before you start. Tick each one as you find it.',
    de: 'Legen Sie diese Unterlagen bereit. Haken Sie ab, was Sie gefunden haben.',
  },
  'chk.lohnsteuerbescheinigung': { en: 'Annual payslip summary from each employer, per year', de: 'Lohnsteuerbescheinigung je Arbeitgeber und Jahr' },
  'chk.steuerId': { en: 'Your 11-digit German tax ID', de: 'Steuerliche Identifikationsnummer (11-stellig)' },
  'chk.iban': { en: 'IBAN of the account for any refund', de: 'IBAN für eine mögliche Erstattung' },
  'chk.finanzamt': { en: 'Name of your last German tax office', de: 'Zuständiges Finanzamt (zuletzt)' },
  'chk.commuteInfo': { en: 'Home-to-work distance and days worked on site', de: 'Entfernung Wohnung–Arbeit und Arbeitstage vor Ort' },
  'chk.receipts': { en: 'Receipts: equipment, courses, applications', de: 'Belege: Arbeitsmittel, Fortbildung, Bewerbungen' },
  'chk.elsterAccess': { en: 'ELSTER account (or paper forms) to submit yourself', de: 'ELSTER-Zugang (oder Papiervordrucke) zur eigenen Abgabe' },

  // personal
  'f.name': { en: 'Name', de: 'Name' },
  'f.firstName': { en: 'First name', de: 'Vorname' },
  'f.lastName': { en: 'Surname', de: 'Nachname' },
  'f.dob': { en: 'Date of birth', de: 'Geburtsdatum' },
  'f.steuerId': { en: 'Tax ID', de: 'Steuer-ID' },
  'f.email': { en: 'Email (optional, printed only)', de: 'E-Mail (optional, nur für den Ausdruck)' },
  'f.street': { en: 'Current street address', de: 'Aktuelle Anschrift' },
  'f.city': { en: 'Postcode and town', de: 'PLZ und Ort' },
  'f.country': { en: 'Country you live in now', de: 'Aktueller Wohnsitzstaat' },
  'f.lastGermanAddress': { en: 'Last address in Germany', de: 'Letzte Anschrift in Deutschland' },
  'f.finanzamt': { en: 'Tax office', de: 'Finanzamt' },
  'f.iban': { en: 'IBAN for refund', de: 'IBAN für Erstattung' },
  'f.accountHolder': { en: 'Account holder', de: 'Kontoinhaber/in' },

  // years
  'y.plan': { en: 'Plan', de: 'Paket' },
  'y.pick': { en: 'Which years are you filing?', de: 'Für welche Jahre erklären Sie?' },
  'y.employer': { en: 'Employer', de: 'Arbeitgeber' },
  'y.gross': { en: 'Gross wages (line 3)', de: 'Bruttoarbeitslohn (Zeile 3)' },
  'y.lohnsteuer': { en: 'Income tax withheld (line 4)', de: 'Einbehaltene Lohnsteuer (Zeile 4)' },
  'y.soli': { en: 'Solidarity surcharge (line 5)', de: 'Solidaritätszuschlag (Zeile 5)' },
  'y.kirchensteuer': { en: 'Church tax (line 6)', de: 'Kirchensteuer (Zeile 6)' },
  'y.docLsb': { en: 'I have the payslip summary for this year', de: 'Lohnsteuerbescheinigung liegt vor' },
  'y.docReceipts': { en: 'I have receipts for this year', de: 'Belege liegen vor' },

  // commute
  'c.intro': {
    en: 'One-way distance by the shortest road route, whole kilometres only.',
    de: 'Einfache Entfernung, kürzeste Straßenverbindung, nur volle Kilometer.',
  },
  'c.km': { en: 'One-way distance (km)', de: 'Einfache Entfernung (km)' },
  'c.days': { en: 'Days travelled to work', de: 'Arbeitstage mit Fahrt zur Arbeit' },
  'c.ownCar': { en: 'Travelled by own or company car', de: 'Mit eigenem oder Firmen-Pkw gefahren' },
  'c.preview': { en: 'Estimated commute allowance', de: 'Geschätzte Entfernungspauschale' },

  // werbungskosten
  'w.homeofficeDays': { en: 'Days worked from home', de: 'Homeoffice-Tage' },
  'w.items': { en: 'Work equipment (gross price each)', de: 'Arbeitsmittel (Bruttopreis je Stück)' },
  'w.addItem': { en: 'Add item', de: 'Posten hinzufügen' },
  'w.itemDesc': { en: 'Description', de: 'Bezeichnung' },
  'w.itemAmount': { en: 'Amount €', de: 'Betrag €' },
  'w.remove': { en: 'Remove', de: 'Entfernen' },
  'w.telefonOn': { en: 'Claim phone/internet flat rate', de: 'Telefon-/Internet-Pauschale ansetzen' },
  'w.telefonMonthly': { en: 'Average monthly phone/internet bill €', de: 'Monatliche Telefon-/Internetkosten €' },
  'w.telefonMonths': { en: 'Months employed', de: 'Monate beschäftigt' },
  'w.kontofuehrung': { en: 'Claim bank account fee flat rate', de: 'Kontoführungspauschale ansetzen' },
  'w.fortbildung': { en: 'Training and courses €', de: 'Fortbildungskosten €' },
  'w.bewerbung': { en: 'Job application costs €', de: 'Bewerbungskosten €' },
  'w.other': { en: 'Other work expenses €', de: 'Sonstige Werbungskosten €' },

  // review
  'r.total': { en: 'Estimated Werbungskosten', de: 'Geschätzte Werbungskosten' },
  'r.lump': { en: 'Employee lump sum', de: 'Arbeitnehmer-Pauschbetrag' },
  'r.above': { en: 'Above the lump sum', de: 'Über dem Pauschbetrag' },
  'r.below': {
    en: 'Below the lump sum: the tax office applies the lump sum automatically.',
    de: 'Unter dem Pauschbetrag: das Finanzamt setzt den Pauschbetrag automatisch an.',
  },
  'r.exportJson': { en: 'Download JSON', de: 'JSON herunterladen' },
  'r.exportHtml': { en: 'Open printable summary', de: 'Druckansicht öffnen' },
  'r.notice': {
    en: 'This is an estimate of deductible work expenses, not a refund calculation. You review, sign and submit the return yourself via ELSTER.',
    de: 'Dies ist eine Schätzung der Werbungskosten, keine Erstattungsberechnung. Sie prüfen, unterschreiben und übermitteln die Erklärung selbst über ELSTER.',
  },

  // nav / misc
  'nav.back': { en: 'Back', de: 'Zurück' },
  'nav.next': { en: 'Next', de: 'Weiter' },
  'nav.reset': { en: 'Wipe local data', de: 'Lokale Daten löschen' },
  'msg.saved': { en: 'Saved on this device only', de: 'Nur auf diesem Gerät gespeichert' },
  'msg.notSaved': { en: 'Storage unavailable: progress will not survive a reload', de: 'Speicher nicht verfügbar: Fortschritt geht beim Neuladen verloren' },
  'msg.fix': { en: 'Please fix the highlighted fields.', de: 'Bitte korrigieren Sie die markierten Felder.' },
  'msg.verify': { en: 'Unverified figure', de: 'Unbestätigter Wert' },

  // errors
  'err.required': { en: 'Required', de: 'Pflichtfeld' },
  'err.format': { en: 'Wrong format', de: 'Falsches Format' },
  'err.checksum': { en: 'Check digit does not match: typo?', de: 'Prüfziffer stimmt nicht: Tippfehler?' },
  'err.length': { en: 'Wrong length for this country', de: 'Falsche Länge für dieses Land' },
  'err.country_unknown': { en: 'Unknown country code', de: 'Unbekannter Ländercode' },
  'err.country_not_allowed': { en: 'Country not supported for refunds (unverified rule)', de: 'Land für Erstattung nicht unterstützt (unbestätigte Regel)' },
  'err.leading_zero': { en: 'Cannot start with 0', de: 'Darf nicht mit 0 beginnen' },
  'err.pattern': { en: 'Digit pattern is not a valid tax ID', de: 'Ziffernmuster ist keine gültige Steuer-ID' },
  'err.number': { en: 'Enter a number', de: 'Bitte eine Zahl eingeben' },
  'err.integer': { en: 'Whole numbers only', de: 'Nur ganze Zahlen' },
  'err.min': { en: 'Too small', de: 'Zu klein' },
  'err.max': { en: 'Too large', de: 'Zu groß' },
  'err.email': { en: 'Not an email address', de: 'Keine gültige E-Mail-Adresse' },
  'err.years': { en: 'Pick at least one year', de: 'Mindestens ein Jahr wählen' },
  'err.tooManyYears': { en: 'Your plan covers fewer years', de: 'Ihr Paket umfasst weniger Jahre' },
};

/** @param {string} key @param {'en'|'de'} lang */
export function t(key, lang = 'en') {
  const s = STRINGS[key];
  if (!s) return key;
  return s[lang] ?? s.en;
}

/** The other language's wording, for the secondary line under a label. */
export function alt(key, lang = 'en') {
  return t(key, lang === 'en' ? 'de' : 'en');
}
