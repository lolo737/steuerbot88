import * as pdfjs from "pdfjs-dist"

// pdfjs worker — loaded from the CDN to avoid bundler complexity
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

export interface ParsedLohnsteuerbescheinigung {
  // Source
  fileName: string
  year: number | null

  // Employer
  employerName: string | null
  employerTaxId: string | null // Steuernummer des Arbeitgebers

  // Employee
  employeeName: string | null
  identifikationsnummer: string | null
  periodStart: string | null // e.g. "01.01.2023"
  periodEnd: string | null   // e.g. "31.12.2023"

  // Financial fields — BMF box numbers
  bruttoarbeitslohn: number | null   // Box 1  — gross wages
  lohnsteuer: number | null          // Box 2  — income tax withheld
  solidaritaetszuschlag: number | null // Box 3 — solidarity surcharge
  kirchensteuer: number | null       // Box 4  — church tax (employee)

  // Parse quality
  confidence: "high" | "medium" | "low"
  rawText: string
}

// German number format "45.000,00" → 45000.00
function parseDE(s: string): number {
  return parseFloat(s.replace(/\./g, "").replace(",", "."))
}

// pdfjs can split "18.466,33" into space-separated tokens: "18 .466,33", "18. 466,33", "18 . 466,33"
// This rejoins them before regex matching.
function normalizeNumbers(text: string): string {
  return text
    .replace(/(\d{1,6}) \.(\d{3},\d{2})/g, "$1.$2")   // "18 .466,33" → "18.466,33"
    .replace(/(\d{1,6}) \. (\d{3},\d{2})/g, "$1.$2")  // "18 . 466,33" → "18.466,33"
    .replace(/(\d{1,6})\. (\d{3},\d{2})/g, "$1.$2")   // "18. 466,33" → "18.466,33"
}

// Matches German amounts with or without thousands separators:
// 18.466,33 | 4660,27 | 466,33 | 1.610,69
const DE_NUM = /(\d+(?:\.\d{3})*,\d{2})/

// Extract a German-format currency amount from a bounded text window following a keyword
function findAmountAfter(text: string, ...keywords: string[]): number | null {
  for (const kw of keywords) {
    const idx = text.indexOf(kw)
    if (idx === -1) continue
    const window = normalizeNumbers(text.slice(idx, idx + 300))
    const m = window.match(DE_NUM)
    if (m) return parseDE(m[1])
  }
  return null
}

// Find the amount that follows a BMF box number label in the raw text
// The standard format is "1.\n<description>\n<amount>" or "1. <description>  <amount>"
function findBoxAmount(text: string, boxNumber: number): number | null {
  // Strategy 1: box label at start of line, e.g. "1." or "1 "
  const lineRe = new RegExp(`(?:^|\\n)\\s*${boxNumber}[.\\s](.{0,300})`, "m")
  const lineM = text.match(lineRe)
  if (lineM) {
    const window = normalizeNumbers(lineM[1])
    const m = window.match(DE_NUM)
    if (m) return parseDE(m[1])
    // Amount might be on the next chunk — look a bit further
    const idx = text.indexOf(lineM[0])
    const window2 = normalizeNumbers(text.slice(idx, idx + 400))
    const m2 = window2.match(DE_NUM)
    if (m2) return parseDE(m2[1])
  }

  // Strategy 2: keyword-based fallback per box
  const keywordMap: Record<number, string[]> = {
    1: ["Bruttoarbeitslohn", "Bruttolohn"],
    2: ["Einbehaltene Lohnsteuer", "Lohnsteuer"],
    3: ["Solidaritätszuschlag", "Solidaritaetszuschlag", "SolZ"],
    4: ["Kirchensteuer des Arbeitnehmers", "Kirchensteuer"],
  }
  const kws = keywordMap[boxNumber]
  if (kws) return findAmountAfter(text, ...kws)

  return null
}

function findYear(text: string): number | null {
  // Most reliable: document title explicitly names the tax year
  const titled = text.match(/Lohnsteuerbescheinigung\s+(?:für\s+)?(20\d{2})/)
  if (titled) return parseInt(titled[1])

  const labeled = text.match(/(?:Kalenderjahr|für\s+(?:das\s+)?Jahr|Steuerjahr)\s+(20\d{2})/)
  if (labeled) return parseInt(labeled[1])

  // Prefer the year from any employment-period date (DD.MM.YYYY) over a bare year string
  // because print dates (Ausstellungsdatum) often appear before employment dates in the text.
  // We collect all years from full date patterns and return the earliest (the tax year).
  const allDateYears = [...text.matchAll(/\d{2}\.\d{2}\.(20\d{2})/g)].map(m => parseInt(m[1]))
  if (allDateYears.length > 0) return Math.min(...allDateYears)

  // Absolute fallback
  const m = text.match(/(20\d{2})/)
  return m ? parseInt(m[1]) : null
}

function findIdentifikationsnummer(text: string): string | null {
  // 11-digit number, often labeled
  const labeled = text.match(/(?:IdentifikationsNr|Identifikationsnummer|Steuer-IdNr)[.:\s]*(\d{11})/)
  if (labeled) return labeled[1]
  // Bare 11-digit number (must not be part of a longer number)
  const bare = text.match(/(?<!\d)(\d{11})(?!\d)/)
  return bare ? bare[1] : null
}

function findEmployerName(text: string): string | null {
  // "Arbeitgeber:" or "Name des Arbeitgebers" followed by the name on the same or next line
  const m = text.match(/(?:Arbeitgeber|Name des Arbeitgebers)[:\s]+([^\n]{3,60})/)
  if (m) return m[1].trim()
  // First non-empty line is often the employer name in many payroll systems
  const firstLine = text.split("\n").find(l => l.trim().length > 3)
  return firstLine?.trim() ?? null
}

function findPeriod(text: string): { start: string | null; end: string | null } {
  // Primary: "DD.MM.YYYY bis DD.MM.YYYY" or with dash / em-dash separator
  const withSep = text.match(/(\d{2}\.\d{2}\.20\d{2})\s*(?:bis|-|–)\s*(\d{2}\.\d{2}\.20\d{2})/)
  if (withSep) return { start: withSep[1], end: withSep[2] }

  // Secondary: two dates close together with no separator (pdfjs table cells joined by space)
  // "19.04.2022 31.12.2022" or "01.01.2022 31.12.2022"
  const dual = text.match(/(\d{2}\.\d{2}\.20\d{2}) +(\d{2}\.\d{2}\.20\d{2})/)
  if (dual) return { start: dual[1], end: dual[2] }

  // Tertiary: construct a full-year period from the detected year
  const year = findYear(text)
  if (year) return { start: `01.01.${year}`, end: `31.12.${year}` }

  // Absolute fallback: first date in text
  const single = text.match(/(\d{2}\.\d{2}\.20\d{2})/)
  if (single) {
    const y = single[1].slice(-4)
    return { start: `01.01.${y}`, end: `31.12.${y}` }
  }
  return { start: null, end: null }
}

function findEmployerTaxId(text: string): string | null {
  const m = text.match(/(?:Steuer-?Nr\.?|Steuernummer)[^\d]*(\d[\d/\s]{8,14})/)
  return m ? m[1].trim() : null
}

function scoreConfidence(parsed: Omit<ParsedLohnsteuerbescheinigung, "confidence">): "high" | "medium" | "low" {
  const critical = [parsed.bruttoarbeitslohn, parsed.lohnsteuer, parsed.year]
  const filled = critical.filter(v => v !== null).length
  if (filled === 3) return "high"
  if (filled === 2) return "medium"
  return "low"
}

export async function parseLohnsteuerbescheinigung(
  file: File
): Promise<ParsedLohnsteuerbescheinigung> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise

  let fullText = ""
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ")
    fullText += pageText + "\n"
  }

  // Normalize split numbers across the whole document before any extraction
  const normalizedText = normalizeNumbers(fullText)

  const year = findYear(normalizedText)
  const bruttoarbeitslohn = findBoxAmount(normalizedText, 1)
  const lohnsteuer = findBoxAmount(normalizedText, 2)
  const solidaritaetszuschlag = findBoxAmount(normalizedText, 3)
  const kirchensteuer = findBoxAmount(normalizedText, 4)
  const identifikationsnummer = findIdentifikationsnummer(normalizedText)
  const employerName = findEmployerName(normalizedText)
  const employerTaxId = findEmployerTaxId(normalizedText)
  const { start: periodStart, end: periodEnd } = findPeriod(normalizedText)

  const partial = {
    fileName: file.name,
    year,
    employerName,
    employerTaxId,
    employeeName: null, // hard to extract reliably without knowing the layout
    identifikationsnummer,
    periodStart,
    periodEnd,
    bruttoarbeitslohn,
    lohnsteuer,
    solidaritaetszuschlag,
    kirchensteuer,
    rawText: normalizedText,
  }

  return { ...partial, confidence: scoreConfidence(partial) }
}
