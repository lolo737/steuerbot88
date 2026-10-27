import { useState, useEffect, useRef, useMemo, DragEvent, useCallback } from "react"
import { X, FileText, ChevronDown, Loader, CheckCircle, AlertTriangle } from "lucide-react"
import { parseLohnsteuerbescheinigung, ParsedLohnsteuerbescheinigung } from "../lib/parseLohnsteuerbescheinigung"
import { loadStripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js"
import JSZip from "jszip"
import { jsPDF } from "jspdf"

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "boot" | "checklist" | "profile" | "years" | "preflight" | "commute" | "werbungskosten" | "review" | "complete"

interface Profile {
  email: string
  firstName: string
  lastName: string
  steuerA: string
  steuerB: string
  steuerC: string
  identifikationsnummer: string
  dob: string
  street: string
  plz: string
  city: string
  iban: string
  finanzamt: string
}

interface WerbungskostenData {
  homeofficeEnabled: boolean
  homeofficeDays: number
  telefonEnabled: boolean
  telefonMonthlyBill: number
  arbeitsmittelAmount: number
  arbeitsmittelFiles: File[]
  fachliteraturAmount: number
  fachliteraturFiles: File[]
  bewerbungskosten: number
  versicherungenAmount: number
  spendenAmount: number
  steuerberatungAmount: number
}

interface CommuteData {
  workAddress: string
  distanceKm: number
  wfhDaysPerWeek: number
  vacationDaysPerYear: number
}

interface ParsedDoc {
  file: File
  state: "parsing" | "done" | "error"
  data: ParsedLohnsteuerbescheinigung | null
}

interface YearEntry {
  year: number
  selected: boolean
  files: File[]
  parsedDocs: ParsedDoc[]
  demoReady?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AVAILABLE_YEARS = [2025, 2024, 2023, 2022]

const WERBUNGSKOSTEN_RATE: Record<number, number> = {
  2025: 1230, 2024: 1230, 2023: 1230, 2022: 1200,
}

const DEADLINE: Record<number, string> = {
  2025: "31 Dec 2029", 2024: "31 Dec 2028", 2023: "31 Dec 2027", 2022: "31 Dec 2026 ⚠",
}

const KONTOFUHRUNG = 16

// Single source of truth — reference everywhere: checkout, Stripe, About, FAQ
const PLANS = {
  "2yr": { label: "Last 2 Years", price: 19.99 },
  "4yr": { label: "Last 4 Years", price: 29.99 },
} as const

function getPlan(selectedYearCount: number): typeof PLANS["2yr"] | typeof PLANS["4yr"] {
  return selectedYearCount <= 2 ? PLANS["2yr"] : PLANS["4yr"]
}

function getPlanKey(count: number): "2yr" | "4yr" { return count <= 2 ? "2yr" : "4yr" }

// Stripe — publishable key is safe in frontend
// Keys come from .env (see .env.example), never hard-coded in the repo.
const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : Promise.resolve(null)

const PAYMENT_INTENT_URL = (import.meta.env.VITE_PAYMENT_INTENT_URL as string | undefined) ?? ""

// Plan amounts in euro-cents
const PLAN_AMOUNTS: Record<"2yr" | "4yr", number> = { "2yr": 1999, "4yr": 2999 }

// Stripe appearance — CRT terminal theme
const STRIPE_APPEARANCE: import("@stripe/stripe-js").Appearance = {
  theme: "night",
  variables: {
    colorPrimary: "#4af626",
    colorBackground: "#030703",
    colorText: "#33ff33",
    colorDanger: "#ff5555",
    fontFamily: "'Share Tech Mono', monospace",
    borderRadius: "0px",
    colorTextPlaceholder: "#1a3a1a",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { border: "1px solid rgba(51,255,51,0.18)", backgroundColor: "#020602" },
    ".Input:focus": { border: "1px solid #4af626", boxShadow: "0 0 12px rgba(51,255,51,0.35)" },
    ".Label": { color: "#33aa33", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: "10px" },
    ".Tab": { border: "1px solid rgba(51,255,51,0.12)", backgroundColor: "#050a05" },
    ".Tab--selected": { border: "1px solid #4af626", backgroundColor: "#020602" },
    ".Tab:hover": { border: "1px solid rgba(51,255,51,0.35)", color: "#4af626" },
    ".Block": { border: "1px solid rgba(51,255,51,0.1)" },
  },
}

// 2020–2022: old Homeoffice-Pauschale (COVID rule) — €5/day, 120-day cap
// 2023+: new permanent Tagespauschale — €6/day, 210-day cap
const HOMEOFFICE: Record<number, { rate: number; maxDays: number; maxAmount: number }> = {
  2025: { rate: 6, maxDays: 210, maxAmount: 1260 },
  2024: { rate: 6, maxDays: 210, maxAmount: 1260 },
  2023: { rate: 6, maxDays: 210, maxAmount: 1260 },
  2022: { rate: 5, maxDays: 120, maxAmount: 600 },
}

const FINANZAMT_LIST = [
  "Finanzamt Aachen-Kreis","Finanzamt Aachen-Mitte","Finanzamt Aachen-Stadt",
  "Finanzamt Ansbach","Finanzamt Augsburg-Land","Finanzamt Augsburg-Mitte",
  "Finanzamt Augsburg-Stadt","Finanzamt Baden-Baden","Finanzamt Bamberg",
  "Finanzamt Bayreuth","Finanzamt Berlin-Charlottenburg",
  "Finanzamt Berlin-Friedrichshain-Kreuzberg","Finanzamt Berlin-Köpenick",
  "Finanzamt Berlin-Lichtenberg","Finanzamt Berlin-Marzahn-Hellersdorf",
  "Finanzamt Berlin-Mitte","Finanzamt Berlin-Neukölln","Finanzamt Berlin-Pankow",
  "Finanzamt Berlin-Reinickendorf","Finanzamt Berlin-Schöneberg",
  "Finanzamt Berlin-Spandau","Finanzamt Berlin-Steglitz","Finanzamt Berlin-Tempelhof",
  "Finanzamt Berlin-Treptow","Finanzamt Berlin-Wedding","Finanzamt Berlin-Wilmersdorf",
  "Finanzamt Berlin-Zehlendorf","Finanzamt Bielefeld-Außenstadt",
  "Finanzamt Bielefeld-Innenstadt","Finanzamt Bochum-Mitte","Finanzamt Bochum-Süd",
  "Finanzamt Bonn-Außenstadt","Finanzamt Bonn-Innenstadt",
  "Finanzamt Brandenburg an der Havel","Finanzamt Braunschweig-Martini",
  "Finanzamt Braunschweig-Wilhelmstraße","Finanzamt Bremen-Mitte",
  "Finanzamt Bremen-Ost","Finanzamt Bremen-West","Finanzamt Chemnitz-Mitte",
  "Finanzamt Chemnitz-Süd","Finanzamt Cottbus","Finanzamt Darmstadt",
  "Finanzamt Dessau-Roßlau","Finanzamt Dortmund-Hörde","Finanzamt Dortmund-Ost",
  "Finanzamt Dortmund-Unna","Finanzamt Dortmund-West","Finanzamt Dresden-Nord",
  "Finanzamt Dresden-Süd","Finanzamt Duisburg-Hamborn","Finanzamt Duisburg-Mitte",
  "Finanzamt Duisburg-Süd","Finanzamt Düsseldorf-Altstadt",
  "Finanzamt Düsseldorf-Mettmann","Finanzamt Düsseldorf-Nord",
  "Finanzamt Düsseldorf-Süd","Finanzamt Erfurt","Finanzamt Erlangen",
  "Finanzamt Essen-NordOst","Finanzamt Essen-Süd","Finanzamt Essen-West",
  "Finanzamt Frankfurt am Main I","Finanzamt Frankfurt am Main II",
  "Finanzamt Frankfurt am Main III","Finanzamt Frankfurt am Main IV",
  "Finanzamt Frankfurt am Main V","Finanzamt Freiburg-Land","Finanzamt Freiburg-Stadt",
  "Finanzamt Fürth","Finanzamt Gelsenkirchen-Nord","Finanzamt Gelsenkirchen-Süd",
  "Finanzamt Göttingen","Finanzamt Hagen","Finanzamt Halle (Saale)",
  "Finanzamt Hamburg-Altona","Finanzamt Hamburg-Am Tierpark",
  "Finanzamt Hamburg-Barmbek-Uhlenhorst","Finanzamt Hamburg-Bergedorf",
  "Finanzamt Hamburg-Eimsbüttel","Finanzamt Hamburg-Harburg",
  "Finanzamt Hamburg-Hansa","Finanzamt Hamburg-Mitte","Finanzamt Hamburg-Nord",
  "Finanzamt Hamburg-Wandsbek","Finanzamt Hanau","Finanzamt Hannover-Land I",
  "Finanzamt Hannover-Land II","Finanzamt Hannover-Mitte","Finanzamt Hannover-Nord",
  "Finanzamt Hannover-Süd","Finanzamt Heidelberg","Finanzamt Heilbronn",
  "Finanzamt Ingolstadt","Finanzamt Jena","Finanzamt Kaiserslautern",
  "Finanzamt Karlsruhe-Durlach","Finanzamt Karlsruhe-Stadt","Finanzamt Kassel I",
  "Finanzamt Kassel II","Finanzamt Kiel-Nord","Finanzamt Kiel-Süd",
  "Finanzamt Koblenz","Finanzamt Köln-Ehrenfeld","Finanzamt Köln-Mitte",
  "Finanzamt Köln-Nord","Finanzamt Köln-Ost","Finanzamt Köln-Porz",
  "Finanzamt Köln-Süd","Finanzamt Köln-West","Finanzamt Krefeld",
  "Finanzamt Leipzig I","Finanzamt Leipzig II","Finanzamt Leipzig III",
  "Finanzamt Leverkusen","Finanzamt Lübeck","Finanzamt Ludwigshafen am Rhein",
  "Finanzamt Magdeburg","Finanzamt Mainz","Finanzamt Mannheim",
  "Finanzamt Mannheim-Neckarstadt","Finanzamt Mönchengladbach",
  "Finanzamt München I","Finanzamt München II","Finanzamt München III",
  "Finanzamt München IV","Finanzamt München-Sendling","Finanzamt Münster-Außenstadt",
  "Finanzamt Münster-Innenstadt","Finanzamt Nürnberg-Nord","Finanzamt Nürnberg-Süd",
  "Finanzamt Oberhausen-Nord","Finanzamt Oberhausen-Süd","Finanzamt Offenburg",
  "Finanzamt Oldenburg","Finanzamt Osnabrück","Finanzamt Pforzheim",
  "Finanzamt Potsdam","Finanzamt Regensburg","Finanzamt Rostock",
  "Finanzamt Saarbrücken Am Stadtgraben","Finanzamt Saarbrücken Außenstadt",
  "Finanzamt Schwerin","Finanzamt Siegen","Finanzamt Stuttgart I",
  "Finanzamt Stuttgart II","Finanzamt Stuttgart III","Finanzamt Stuttgart IV",
  "Finanzamt Ulm","Finanzamt Wiesbaden I","Finanzamt Wiesbaden II",
  "Finanzamt Wolfsburg","Finanzamt Wuppertal-Barmen","Finanzamt Wuppertal-Elberfeld",
  "Finanzamt Würzburg",
]

const INITIAL_PROFILE: Profile = {
  email: "",
  firstName: "", lastName: "",
  steuerA: "", steuerB: "", steuerC: "",
  identifikationsnummer: "",
  dob: "",
  street: "", plz: "", city: "",
  iban: "",
  finanzamt: "",
}

const INITIAL_WERBUNGSKOSTEN: WerbungskostenData = {
  homeofficeEnabled: false,
  homeofficeDays: 0,
  telefonEnabled: true,
  telefonMonthlyBill: 0,
  arbeitsmittelAmount: 0,
  arbeitsmittelFiles: [],
  fachliteraturAmount: 0,
  fachliteraturFiles: [],
  bewerbungskosten: 0,
  versicherungenAmount: 0,
  spendenAmount: 0,
  steuerberatungAmount: 95,
}

const INITIAL_YEARS: YearEntry[] = AVAILABLE_YEARS.map(year => ({ year, selected: true, files: [], parsedDocs: [] }))

const INITIAL_COMMUTE: CommuteData = {
  workAddress: "", distanceKm: 0, wfhDaysPerWeek: 0, vacationDaysPerYear: 25,
}

const DEMO_PROFILE: Profile = {
  email: "maxim.mustermann@email.com",
  firstName: "Maxim", lastName: "Mustermann",
  steuerA: "21", steuerB: "481", steuerC: "23456",
  identifikationsnummer: "12345678901",
  dob: "22.02.1982",
  street: "Musterstraße 12", plz: "10115", city: "Berlin",
  iban: "DE89370400440532013000",
  finanzamt: "Finanzamt Berlin-Mitte",
}

const DEMO_COMMUTE: CommuteData = {
  workAddress: "Unter den Linden 1, 10117 Berlin",
  distanceKm: 12, wfhDaysPerWeek: 1, vacationDaysPerYear: 28,
}

const DEMO_WERBUNGSKOSTEN: WerbungskostenData = {
  homeofficeEnabled: true,
  homeofficeDays: 48,
  telefonEnabled: true,
  telefonMonthlyBill: 45,
  arbeitsmittelAmount: 349,
  arbeitsmittelFiles: [],
  fachliteraturAmount: 89,
  fachliteraturFiles: [],
  bewerbungskosten: 0,
  versicherungenAmount: 210,
  spendenAmount: 50,
  steuerberatungAmount: 95,
}

// ─── Audio ────────────────────────────────────────────────────────────────────

function playChaChing() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const t = ctx.currentTime
    const thud = ctx.createOscillator(); const tg = ctx.createGain()
    thud.connect(tg); tg.connect(ctx.destination); thud.type = "square"
    thud.frequency.setValueAtTime(110, t); thud.frequency.exponentialRampToValueAtTime(55, t + 0.06)
    tg.gain.setValueAtTime(0.35, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    thud.start(t); thud.stop(t + 0.08)
    const bell = ctx.createOscillator(); const bg = ctx.createGain()
    bell.connect(bg); bg.connect(ctx.destination); bell.type = "sine"
    bell.frequency.setValueAtTime(1318, t + 0.05)
    bg.gain.setValueAtTime(0.55, t + 0.05); bg.gain.exponentialRampToValueAtTime(0.001, t + 1.4)
    bell.start(t + 0.05); bell.stop(t + 1.4)
    const b2 = ctx.createOscillator(); const b2g = ctx.createGain()
    b2.connect(b2g); b2g.connect(ctx.destination); b2.type = "sine"
    b2.frequency.setValueAtTime(2637, t + 0.05)
    b2g.gain.setValueAtTime(0.28, t + 0.05); b2g.gain.exponentialRampToValueAtTime(0.001, t + 0.9)
    b2.start(t + 0.05); b2.stop(t + 0.9)
    const b3 = ctx.createOscillator(); const b3g = ctx.createGain()
    b3.connect(b3g); b3g.connect(ctx.destination); b3.type = "sine"
    b3.frequency.setValueAtTime(659, t + 0.05)
    b3g.gain.setValueAtTime(0.18, t + 0.05); b3g.gain.exponentialRampToValueAtTime(0.001, t + 1.1)
    b3.start(t + 0.05); b3.stop(t + 1.1)
  } catch (_) {}
}

// ─── Calculations ─────────────────────────────────────────────────────────────

function calcCommuteDays(wfh: number, vac: number) {
  return Math.max(0, Math.round(52 * (5 - wfh) - vac - 10))
}

function calcPendler(km: number, days: number) {
  if (km <= 0 || days <= 0) return 0
  return (km <= 20 ? km * 0.3 : 20 * 0.3 + (km - 20) * 0.38) * days
}

interface YearResult { werbungskosten: number; pendler: number; kontoführung: number; total: number }

function calcYearResult(year: number, c: CommuteData): YearResult {
  const days = calcCommuteDays(c.wfhDaysPerWeek, c.vacationDaysPerYear)
  const pendler = calcPendler(c.distanceKm, days)
  const flat = WERBUNGSKOSTEN_RATE[year] ?? 1230
  const werbungskosten = Math.max(flat, pendler)
  return { werbungskosten, pendler, kontoführung: KONTOFUHRUNG, total: Math.round((werbungskosten + KONTOFUHRUNG) * 0.25) }
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Scanlines() {
  return <div className="pointer-events-none fixed inset-0 z-50" style={{ background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.13) 3px,rgba(0,0,0,0.13) 4px)" }} />
}

function Vignette() {
  return <div className="pointer-events-none fixed inset-0 z-40" style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.7) 100%)" }} />
}

function BlinkCursor({ dim = false }: { dim?: boolean }) {
  const [on, setOn] = useState(true)
  useEffect(() => { const id = setInterval(() => setOn(v => !v), 530); return () => clearInterval(id) }, [])
  return <span className={dim ? "text-green-800" : "text-green-400"} style={{ opacity: on ? 1 : 0 }}>█</span>
}

function StepBar({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div className="mb-10">
      <div className="flex gap-1 mb-2">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`h-px flex-1 transition-colors duration-500 ${i < current ? "bg-green-400" : i === current ? "bg-green-600" : "bg-green-950"}`} />
        ))}
      </div>
      <div className="text-green-800 text-xs tracking-widest uppercase font-mono">{current + 1}/{total} — {label}</div>
    </div>
  )
}

function ScreenTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-green-300 text-2xl tracking-widest uppercase mb-1 font-mono" style={{ fontFamily: "'VT323', monospace", textShadow: "0 0 12px rgba(51,255,51,0.5)" }}>{children}</h2>
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="text-green-800 text-xs font-mono mb-6 tracking-wide">{children}</p>
}

const INPUT_BOX = "bg-black/50 border border-green-800 text-green-300 font-mono text-sm outline-none focus:border-green-400 focus:shadow-[0_0_14px_rgba(51,255,51,0.55),0_0_28px_rgba(51,255,51,0.2)] transition-all py-2 px-2 placeholder-green-950"

function Field({ label, value, onChange, placeholder = "", type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div className="mb-4">
      <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">{label}</div>
      <div className="flex items-center border border-green-800 bg-black/50 px-3 py-2 focus-within:border-green-400 focus-within:shadow-[0_0_14px_rgba(51,255,51,0.55),0_0_28px_rgba(51,255,51,0.2)] transition-all">
        <span className="text-green-800 mr-2 select-none text-xs font-mono">&gt;</span>
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="flex-1 bg-transparent text-green-300 placeholder-green-950 outline-none font-mono text-sm"
          style={{ fontFamily: "'Share Tech Mono', monospace" }} />
      </div>
    </div>
  )
}

function SteuerNummerInput({ partA = "", partB = "", partC = "", onChange }: {
  partA?: string; partB?: string; partC?: string; onChange: (a: string, b: string, c: string) => void
}) {
  const rA = useRef<HTMLInputElement>(null)
  const rB = useRef<HTMLInputElement>(null)
  const rC = useRef<HTMLInputElement>(null)
  return (
    <div className="mb-4">
      <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">Steuernummer</div>
      <div className="flex items-center gap-2">
        <input ref={rA} maxLength={2} value={partA} placeholder="░░"
          className={`${INPUT_BOX} w-12`} style={{ fontFamily: "'Share Tech Mono', monospace" }}
          onChange={e => { const v = e.target.value.replace(/\D/g,"").slice(0,2); onChange(v,partB,partC); if(v.length===2) rB.current?.focus() }} />
        <span className="text-green-800 font-mono text-sm select-none">/</span>
        <input ref={rB} maxLength={3} value={partB} placeholder="░░░"
          className={`${INPUT_BOX} w-16`} style={{ fontFamily: "'Share Tech Mono', monospace" }}
          onChange={e => { const v = e.target.value.replace(/\D/g,"").slice(0,3); onChange(partA,v,partC); if(v.length===3) rC.current?.focus() }}
          onKeyDown={e => { if(e.key==="Backspace"&&partB==="") rA.current?.focus() }} />
        <span className="text-green-800 font-mono text-sm select-none">/</span>
        <input ref={rC} maxLength={5} value={partC} placeholder="░░░░░"
          className={`${INPUT_BOX} w-20`} style={{ fontFamily: "'Share Tech Mono', monospace" }}
          onChange={e => { const v = e.target.value.replace(/\D/g,"").slice(0,5); onChange(partA,partB,v) }}
          onKeyDown={e => { if(e.key==="Backspace"&&partC==="") rB.current?.focus() }} />
        <span className="text-green-900 text-xs font-mono select-none">{(partA?.length||0)+(partB?.length||0)+(partC?.length||0)}/10</span>
      </div>
    </div>
  )
}

function IdentifikationsnummerInput({ value = "", onChange }: { value?: string; onChange: (v: string) => void }) {
  const p1 = value.slice(0,2), p2 = value.slice(2,5), p3 = value.slice(5,8), p4 = value.slice(8,11)
  const r1 = useRef<HTMLInputElement>(null)
  const r2 = useRef<HTMLInputElement>(null)
  const r3 = useRef<HTMLInputElement>(null)
  const r4 = useRef<HTMLInputElement>(null)
  const upd = (a:string,b:string,c:string,d:string) => onChange(a+b+c+d)
  return (
    <div className="mb-4">
      <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">Identifikationsnummer (11 digits)</div>
      <div className="flex items-center gap-2">
        <input ref={r1} maxLength={2} value={p1} placeholder="░░"
          className={`${INPUT_BOX} w-12`} style={{ fontFamily: "'Share Tech Mono', monospace" }}
          onChange={e => { const v = e.target.value.replace(/\D/g,"").slice(0,2); upd(v,p2,p3,p4); if(v.length===2) r2.current?.focus() }} />
        <input ref={r2} maxLength={3} value={p2} placeholder="░░░"
          className={`${INPUT_BOX} w-16`} style={{ fontFamily: "'Share Tech Mono', monospace" }}
          onChange={e => { const v = e.target.value.replace(/\D/g,"").slice(0,3); upd(p1,v,p3,p4); if(v.length===3) r3.current?.focus() }}
          onKeyDown={e => { if(e.key==="Backspace"&&p2==="") r1.current?.focus() }} />
        <input ref={r3} maxLength={3} value={p3} placeholder="░░░"
          className={`${INPUT_BOX} w-16`} style={{ fontFamily: "'Share Tech Mono', monospace" }}
          onChange={e => { const v = e.target.value.replace(/\D/g,"").slice(0,3); upd(p1,p2,v,p4); if(v.length===3) r4.current?.focus() }}
          onKeyDown={e => { if(e.key==="Backspace"&&p3==="") r2.current?.focus() }} />
        <input ref={r4} maxLength={3} value={p4} placeholder="░░░"
          className={`${INPUT_BOX} w-16`} style={{ fontFamily: "'Share Tech Mono', monospace" }}
          onChange={e => { const v = e.target.value.replace(/\D/g,"").slice(0,3); upd(p1,p2,p3,v) }}
          onKeyDown={e => { if(e.key==="Backspace"&&p4==="") r3.current?.focus() }} />
        <span className="text-green-900 text-xs font-mono select-none">{value.length}/11</span>
      </div>
    </div>
  )
}

function DobInput({ value = "", onChange }: { value?: string; onChange: (v: string) => void }) {
  const parts = value.split(".")
  const d = parts[0] || "", m = parts[1] || "", y = parts[2] || ""
  const rD = useRef<HTMLInputElement>(null)
  const rM = useRef<HTMLInputElement>(null)
  const rY = useRef<HTMLInputElement>(null)
  const upd = (day:string, mon:string, yr:string) => onChange(`${day}.${mon}.${yr}`)
  return (
    <div className="mb-4">
      <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">Date of Birth</div>
      <div className="flex items-center gap-1">
        <input ref={rD} maxLength={2} value={d} placeholder="░░"
          className={`${INPUT_BOX} w-12 text-center`} style={{ fontFamily: "'Share Tech Mono', monospace" }}
          onChange={e => { const v = e.target.value.replace(/\D/g,"").slice(0,2); upd(v,m,y); if(v.length===2) rM.current?.focus() }} />
        <span className="text-green-700 font-mono select-none">/</span>
        <input ref={rM} maxLength={2} value={m} placeholder="░░"
          className={`${INPUT_BOX} w-12 text-center`} style={{ fontFamily: "'Share Tech Mono', monospace" }}
          onChange={e => { const v = e.target.value.replace(/\D/g,"").slice(0,2); upd(d,v,y); if(v.length===2) rY.current?.focus() }}
          onKeyDown={e => { if(e.key==="Backspace"&&m==="") rD.current?.focus() }} />
        <span className="text-green-700 font-mono select-none">/</span>
        <input ref={rY} maxLength={4} value={y} placeholder="░░░░"
          className={`${INPUT_BOX} w-20 text-center`} style={{ fontFamily: "'Share Tech Mono', monospace" }}
          onChange={e => { const v = e.target.value.replace(/\D/g,"").slice(0,4); upd(d,m,v) }}
          onKeyDown={e => { if(e.key==="Backspace"&&y==="") rM.current?.focus() }} />
        <span className="text-green-900 text-xs font-mono select-none">dd/mm/yyyy</span>
      </div>
    </div>
  )
}

function IbanInput({ value = "", onChange }: { value?: string; onChange: (v: string) => void }) {
  const rest = value.toUpperCase().startsWith("DE") ? value.slice(2) : value
  return (
    <div className="mb-4">
      <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">German IBAN</div>
      <div className="flex items-center border border-green-800 bg-black/50 focus-within:border-green-400 focus-within:shadow-[0_0_14px_rgba(51,255,51,0.55),0_0_28px_rgba(51,255,51,0.2)] transition-all">
        <span className="text-green-300 font-mono text-sm px-3 py-2 border-r border-green-900 select-none bg-green-950/30">DE</span>
        <input
          value={rest}
          onChange={e => { const v = e.target.value.replace(/[^0-9]/g,"").slice(0,20); onChange("DE" + v) }}
          maxLength={20}
          placeholder="░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░"
          className="flex-1 bg-transparent text-green-300 placeholder-green-950 outline-none font-mono text-sm px-3 py-2 tracking-wide"
          style={{ fontFamily: "'Share Tech Mono', monospace" }}
        />
        <span className="text-green-900 text-xs font-mono pr-3 select-none">{rest.length}/20</span>
      </div>
      <div className="text-green-950 text-xs font-mono mt-1">* German IBANs are 22 chars and start with DE. Keep this account open until your refund arrives.</div>
    </div>
  )
}

function FinanzamtDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [])

  const filtered = useMemo(() =>
    FINANZAMT_LIST.filter(f => f.toLowerCase().includes(query.toLowerCase())),
    [query]
  )

  return (
    <div ref={containerRef} className="mb-4 relative">
      <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">Finanzamt</div>
      <div
        className={`flex items-center border bg-black/50 transition-all cursor-text ${open ? "border-green-400 shadow-[0_0_14px_rgba(51,255,51,0.55),0_0_28px_rgba(51,255,51,0.2)]" : "border-green-800"}`}
        onClick={() => { setOpen(true); setQuery(""); setTimeout(() => inputRef.current?.focus(), 0) }}
      >
        <span className="text-green-800 ml-3 mr-2 select-none text-xs font-mono">&gt;</span>
        <input
          ref={inputRef}
          value={open ? query : value}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setOpen(true); setQuery("") }}
          placeholder={value || "Search or type Finanzamt name..."}
          className="flex-1 bg-transparent text-green-300 placeholder-green-800 outline-none font-mono text-sm py-2"
          style={{ fontFamily: "'Share Tech Mono', monospace" }}
        />
        <ChevronDown size={12} className={`text-green-700 mr-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full border border-green-900 border-t-0 bg-black z-50 max-h-44 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-2 text-green-800 text-xs font-mono">No match — type to search</div>
          ) : (
            filtered.map(fa => (
              <div key={fa}
                className={`px-4 py-2 text-xs font-mono cursor-pointer transition-colors ${fa === value ? "text-green-300 bg-green-950/50" : "text-green-700 hover:text-green-400 hover:bg-green-950/30"}`}
                onMouseDown={e => { e.preventDefault(); onChange(fa); setOpen(false) }}
              >
                {fa}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function Btn({ onClick, disabled = false, dim = false, children }: {
  onClick: () => void; disabled?: boolean; dim?: boolean; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-6 py-2 font-mono text-xs tracking-widest uppercase transition-all border ${
        disabled ? "border-green-950 text-green-950 cursor-not-allowed"
        : dim ? "border-green-900 text-green-700 hover:border-green-700 hover:text-green-400"
        : "border-green-400 text-green-400 hover:bg-green-400 hover:text-black hover:shadow-[0_0_20px_rgba(51,255,51,0.4)]"
      }`} style={{ fontFamily: "'Share Tech Mono', monospace" }}>
      {children}
    </button>
  )
}

function Nav({ onBack, onNext, nextLabel = "Continue →", disabled = false }: {
  onBack?: () => void; onNext: () => void; nextLabel?: string; disabled?: boolean
}) {
  return (
    <div className="flex justify-between mt-8">
      {onBack ? <Btn onClick={onBack} dim>← Back</Btn> : <div />}
      <Btn onClick={onNext} disabled={disabled}>{nextLabel}</Btn>
    </div>
  )
}

// ─── Checklist Screen ─────────────────────────────────────────────────────────

const CHECKLIST_ITEMS = [
  {
    id: "phone",
    headline: "Your phone/internet bill",
    body: "Yearly summary, if your provider has one — even a rough number is fine. This alone is often worth up to €240/year.",
  },
  {
    id: "insurance",
    headline: "Any insurance you pay yourself",
    body: "Haftpflicht, Rechtsschutz, Berufsunfähigkeit, apartment insurance. Check your email for the yearly Beitragsrechnung.",
  },
  {
    id: "receipts",
    headline: "Receipts for anything you bought for work",
    body: "Laptop, monitor, chair, headset, work phone.",
  },
  {
    id: "donations",
    headline: "Any donations",
    body: "Including informal ones like a GoFundMe or a school fundraiser, if you got a receipt.",
  },
]

function ChecklistScreen({ email, setEmail, onContinue }: {
  email: string; setEmail: (e: string) => void; onContinue: () => void
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-8 py-16">
      <div className="w-full max-w-xl">
        <div className="text-green-700 text-xs font-mono tracking-widest mb-8 border-b border-green-950 pb-3">
          STEUERBOT/88 — PRE-FLIGHT
        </div>

        <h1
          className="text-green-300 mb-8 tracking-widest uppercase leading-tight"
          style={{ fontFamily: "'VT323', monospace", fontSize: "1.6rem", textShadow: "0 0 12px rgba(51,255,51,0.4)" }}
        >
          Before you start —{"\n"}go get these
        </h1>

        <div className="space-y-4 mb-10">
          {CHECKLIST_ITEMS.map(item => {
            const isChecked = checked.has(item.id)
            return (
              <div
                key={item.id}
                className={`flex gap-4 p-4 border cursor-pointer transition-all select-none ${
                  isChecked ? "border-green-700 bg-green-950/20" : "border-green-950 hover:border-green-900"
                }`}
                onClick={() => toggle(item.id)}
              >
                <div
                  className={`text-xl leading-none mt-px shrink-0 transition-colors ${
                    isChecked ? "text-green-400" : "text-green-800"
                  }`}
                >
                  {isChecked ? "☑" : "☐"}
                </div>
                <div>
                  <div
                    className={`font-mono text-sm mb-1 transition-colors ${
                      isChecked ? "text-green-300" : "text-green-600"
                    }`}
                    style={{ fontFamily: "'Share Tech Mono', monospace" }}
                  >
                    {item.headline}
                  </div>
                  <div className="text-green-800 text-xs font-mono leading-relaxed">
                    {item.body}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="border-l-2 border-green-900 pl-4 text-green-700 text-xs font-mono mb-8 leading-relaxed">
          Two minutes now finding these saves you leaving money on the table later.
        </div>

        <div className="mb-8">
          <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">Your email — we'll send a resume link if you get interrupted</div>
          <div className="flex items-center border border-green-800 bg-black/50 px-3 py-2 focus-within:border-green-400 focus-within:shadow-[0_0_14px_rgba(51,255,51,0.55),0_0_28px_rgba(51,255,51,0.2)] transition-all">
            <span className="text-green-800 mr-2 select-none text-xs font-mono">&gt;</span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="flex-1 bg-transparent text-green-300 placeholder-green-950 outline-none font-mono text-sm"
              style={{ fontFamily: "'Share Tech Mono', monospace" }}
            />
          </div>
          <div className="text-green-900 text-xs font-mono mt-1">Optional here — required on the next screen.</div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-green-900 text-xs font-mono">
            {checked.size}/{CHECKLIST_ITEMS.length} gathered
          </div>
          <button
            onClick={onContinue}
            className="px-8 py-3 border border-green-400 text-green-300 font-mono tracking-widest uppercase transition-all hover:bg-green-400 hover:text-black hover:shadow-[0_0_20px_rgba(51,255,51,0.4)]"
            style={{ fontFamily: "'VT323', monospace", fontSize: "1.15rem" }}
          >
            {"I'm ready →"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Boot Screen ──────────────────────────────────────────────────────────────

function BootScreen({ onStart }: { onStart: () => void }) {
  const [count, setCount] = useState(0)
  const [ready, setReady] = useState(false)

  const lines = [
    { t: "STEUERBOT/88 v1.0.0 — TAX RECOVERY SYSTEM", s: "bright" },
    { t: "Copyright (c) 2026 Niall O'Hara. Prototype build.", s: "dim" },
    { t: "", s: "dim" },
    { t: "Checking memory.....................................64K OK", s: "dim" },
    { t: "Loading Finanzamt registry..........................OK", s: "ok" },
    { t: "Loading deduction tables (2022–2025)................OK", s: "ok" },
    { t: "Loading PDF renderer................................OK", s: "ok" },
    { t: "Verifying Werbungskostenpauschale rates.............OK", s: "ok" },
    { t: "", s: "dim" },
    { t: "SYSTEM READY.", s: "bright" },
    { t: "", s: "dim" },
    { t: "Recover your German tax refund before you leave.", s: "mid" },
    { t: "Up to 4 years. Takes 5 minutes.", s: "mid" },
    { t: "", s: "dim" },
    { t: "> Press START to begin", s: "prompt" },
  ]

  useEffect(() => {
    let i = 0
    const fire = () => {
      if (i < lines.length) { setCount(i + 1); i++; setTimeout(fire, i < 10 ? 110 : 55) }
      else setReady(true)
    }
    const id = setTimeout(fire, 300)
    return () => clearTimeout(id)
  }, [])

  const col: Record<string,string> = { bright:"text-green-200", ok:"text-green-500", dim:"text-green-900", mid:"text-green-400", prompt:"text-green-300" }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-8 py-16">
      <div className="w-full max-w-2xl">
        <pre className="text-green-500 text-xs mb-10 leading-snug select-none" style={{ fontFamily:"'Share Tech Mono',monospace", textShadow:"0 0 8px rgba(51,255,51,0.6)" }}>{`
 ███████╗████████╗███████╗██╗   ██╗███████╗██████╗
 ██╔════╝╚══██╔══╝██╔════╝██║   ██║██╔════╝██╔══██╗
 ███████╗   ██║   █████╗  ██║   ██║█████╗  ██████╔╝
 ╚════██║   ██║   ██╔══╝  ██║   ██║██╔══╝  ██╔══██╗
 ███████║   ██║   ███████╗╚██████╔╝███████╗██║  ██║
 ╚══════╝   ╚═╝   ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝  BOT/88
`}</pre>
        <div className="font-mono text-sm leading-6 space-y-px">
          {lines.slice(0, count).map((l, i) => (
            <div key={i} className={col[l.s] || "text-green-700"}>{l.t || " "}</div>
          ))}
          {count > 0 && !ready && <BlinkCursor />}
        </div>
        {ready && (
          <div className="mt-10">
            <button onClick={onStart}
              className="px-10 py-3 border-2 border-green-400 text-green-300 font-mono tracking-widest uppercase transition-all hover:bg-green-400 hover:text-black"
              style={{ fontFamily:"'VT323',monospace", fontSize:"1.25rem", boxShadow:"0 0 24px rgba(51,255,51,0.35)" }}>
              START RECOVERY ▶
            </button>
            <div className="mt-4 text-green-900 text-xs font-mono">→ You'll need a few documents before you begin</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Profile Screen ───────────────────────────────────────────────────────────

function ProfileScreen({ profile, setProfile, onNext }: {
  profile: Profile; setProfile: (p: Profile) => void; onNext: () => void
}) {
  const set = (k: keyof Profile) => (v: string) => setProfile({ ...profile, [k]: v })
  const valid =
    profile.email.includes("@") &&
    profile.firstName.trim() && profile.lastName.trim() &&
    (profile.steuerA?.length ?? 0) === 2 &&
    (profile.steuerB?.length ?? 0) === 3 &&
    (profile.steuerC?.length ?? 0) === 5 &&
    (profile.identifikationsnummer?.length ?? 0) === 11 &&
    profile.dob.length >= 8 &&
    profile.street.trim() &&
    (profile.plz?.length ?? 0) === 5 &&
    (profile.iban?.length ?? 0) === 22 &&
    profile.finanzamt.trim()

  return (
    <div className="max-w-lg mx-auto">
      <StepBar current={0} total={5} label="Personal Details" />
      <ScreenTitle>Who are you?</ScreenTitle>
      <Sub>Your details go on every form. Enter once, used for all years.</Sub>

      <Field label="Email address" value={profile.email} onChange={set("email")} placeholder="you@email.com" type="email" />

      <div className="grid grid-cols-2 gap-x-4">
        <Field label="First Name" value={profile.firstName} onChange={set("firstName")} />
        <Field label="Last Name" value={profile.lastName} onChange={set("lastName")} />
      </div>

      <SteuerNummerInput
        partA={profile.steuerA} partB={profile.steuerB} partC={profile.steuerC}
        onChange={(a,b,c) => setProfile({ ...profile, steuerA:a, steuerB:b, steuerC:c })}
      />

      <IdentifikationsnummerInput
        value={profile.identifikationsnummer}
        onChange={set("identifikationsnummer")}
      />

      <DobInput value={profile.dob} onChange={set("dob")} />

      <Field label="Street + House Number" value={profile.street} onChange={set("street")} placeholder="Torstraße 42" />

      <div className="grid grid-cols-3 gap-x-4">
        <div className="mb-4">
          <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">PLZ</div>
          <div className="flex items-center border border-green-800 bg-black/50 px-3 py-2 focus-within:border-green-400 focus-within:shadow-[0_0_14px_rgba(51,255,51,0.55),0_0_28px_rgba(51,255,51,0.2)] transition-all">
            <span className="text-green-800 mr-2 select-none text-xs font-mono">&gt;</span>
            <input maxLength={5} value={profile.plz} onChange={e => set("plz")(e.target.value.replace(/\D/g,"").slice(0,5))}
              placeholder="░░░░░" className="w-full bg-transparent text-green-300 placeholder-green-950 outline-none font-mono text-sm"
              style={{ fontFamily:"'Share Tech Mono',monospace" }} />
          </div>
        </div>
        <div className="col-span-2">
          <Field label="City" value={profile.city} onChange={set("city")} placeholder="Berlin" />
        </div>
      </div>

      <IbanInput value={profile.iban} onChange={set("iban")} />
      <FinanzamtDropdown value={profile.finanzamt} onChange={set("finanzamt")} />

      <div className="border-l-2 border-green-900 pl-3 text-green-800 text-xs font-mono mt-1 mb-2">
        ! Keep your German bank account open — refunds take 3–6 months.
      </div>

      <Nav onNext={onNext} disabled={!valid} />
    </div>
  )
}

// ─── Year Card ────────────────────────────────────────────────────────────────

function ParsedDocRow({ doc, onRemove }: { doc: ParsedDoc; onRemove: () => void }) {
  const d = doc.data
  return (
    <div className="border border-green-950 bg-black/30 mt-2">
      <div className="flex items-center gap-2 px-3 py-2">
        {doc.state === "parsing" && <Loader size={11} className="text-green-700 shrink-0 animate-spin" />}
        {doc.state === "done" && <CheckCircle size={11} className={`shrink-0 ${d?.confidence === "high" ? "text-green-500" : "text-yellow-600"}`} />}
        {doc.state === "error" && <AlertTriangle size={11} className="text-yellow-700 shrink-0" />}
        <span className="flex-1 text-green-700 text-xs font-mono truncate">{doc.file.name}</span>
        <button onClick={onRemove} className="text-green-900 hover:text-green-500 transition-colors ml-2"><X size={11} /></button>
      </div>
      {doc.state === "parsing" && (
        <div className="px-3 pb-2 text-green-900 text-xs font-mono">Parsing...</div>
      )}
      {doc.state === "done" && d && (
        <div className="px-3 pb-3 space-y-px">
          {d.employerName && (
            <div className="flex justify-between text-xs font-mono">
              <span className="text-green-800">Arbeitgeber</span>
              <span className="text-green-600 truncate max-w-[55%] text-right">{d.employerName}</span>
            </div>
          )}
          {d.periodStart && d.periodEnd && (
            <div className="flex justify-between text-xs font-mono">
              <span className="text-green-800">Zeitraum</span>
              <span className="text-green-600">{d.periodStart} – {d.periodEnd}</span>
            </div>
          )}
          {d.bruttoarbeitslohn !== null && (
            <div className="flex justify-between text-xs font-mono">
              <span className="text-green-800">Bruttoarbeitslohn</span>
              <span className="text-green-400">€{d.bruttoarbeitslohn.toLocaleString("de-DE", { minimumFractionDigits: 2 })}</span>
            </div>
          )}
          {d.lohnsteuer !== null && (
            <div className="flex justify-between text-xs font-mono">
              <span className="text-green-800">Lohnsteuer einbehalten</span>
              <span className="text-green-400">€{d.lohnsteuer.toLocaleString("de-DE", { minimumFractionDigits: 2 })}</span>
            </div>
          )}
          {d.solidaritaetszuschlag !== null && (
            <div className="flex justify-between text-xs font-mono">
              <span className="text-green-800">Solidaritätszuschlag</span>
              <span className="text-green-600">€{d.solidaritaetszuschlag.toLocaleString("de-DE", { minimumFractionDigits: 2 })}</span>
            </div>
          )}
          {d.confidence !== "high" && (
            <div className="text-yellow-800 text-xs font-mono pt-1">⚠ Partial read — check figures before submitting.</div>
          )}
        </div>
      )}
      {doc.state === "error" && (
        <div className="px-3 pb-2 text-yellow-800 text-xs font-mono">Could not parse this PDF. Enter values manually in Review.</div>
      )}
    </div>
  )
}

function YearCard({ entry, onToggle, onAddFiles, onRemoveDoc }: {
  entry: YearEntry; onToggle: () => void
  onAddFiles: (f: File[]) => void; onRemoveDoc: (i: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const urgent = entry.year === 2022

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf")
    if (files.length) onAddFiles(files)
  }

  const parsing = entry.parsedDocs.some(d => d.state === "parsing")
  const docCount = entry.demoReady && entry.parsedDocs.length === 0 ? 1 : entry.parsedDocs.length

  return (
    <div className={`border transition-all duration-200 ${entry.selected ? (urgent ? "border-yellow-700" : "border-green-700") : "border-green-950"}`}>
      <div className="flex items-center gap-4 px-4 py-3 cursor-pointer select-none hover:bg-green-950/30 transition-colors" onClick={onToggle}>
        <div className={`text-xl leading-none select-none transition-colors ${entry.selected ? (urgent ? "text-yellow-400" : "text-green-400") : "text-green-900"}`}>
          {entry.selected ? "☑" : "❏"}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`font-mono tracking-widest ${entry.selected ? (urgent ? "text-yellow-300" : "text-green-300") : "text-green-800"}`}
            style={{ fontFamily:"'VT323',monospace", fontSize:"1.1rem" }}>
            {entry.year}
          </span>
          <span className="text-green-800 text-xs font-mono ml-4">
            €{WERBUNGSKOSTEN_RATE[entry.year].toLocaleString()} flat · deadline {DEADLINE[entry.year]}
          </span>
        </div>
        {docCount > 0 && (
          <span className={`text-xs font-mono shrink-0 ${parsing ? "text-green-800" : "text-green-600"}`}>
            {parsing ? "parsing…" : `${docCount} doc${docCount !== 1 ? "s" : ""}`}
          </span>
        )}
      </div>

      {entry.selected && !entry.demoReady && (
        <div className="border-t border-green-950 px-4 pt-3 pb-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`border border-dashed text-center px-4 py-3 cursor-pointer transition-all ${dragging ? "border-green-400 bg-green-950/40" : "border-green-900 hover:border-green-800"}`}
          >
            <div className="text-green-800 text-xs font-mono">Drop Lohnsteuerbescheinigung PDF · click to browse</div>
            <div className="text-green-950 text-xs font-mono mt-px">Multiple files if you changed employer mid-year</div>
            <input ref={inputRef} type="file" accept=".pdf" multiple className="hidden"
              onChange={e => { const f = Array.from(e.target.files ?? []); if(f.length) onAddFiles(f); e.target.value="" }} />
          </div>
          {entry.parsedDocs.length > 0 && (
            <div className="space-y-1 mt-1">
              {entry.parsedDocs.map((doc, i) => (
                <ParsedDocRow key={i} doc={doc} onRemove={() => onRemoveDoc(i)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Years Screen ─────────────────────────────────────────────────────────────

function YearsScreen({ yearEntries, setYearEntries, onNext, onBack, demoMode }: {
  yearEntries: YearEntry[]; setYearEntries: (e: YearEntry[]) => void
  onNext: () => void; onBack: () => void; demoMode: boolean
}) {
  const toggle = (year: number) =>
    setYearEntries(yearEntries.map(e => e.year === year ? { ...e, selected: !e.selected } : e))

  const addFiles = useCallback((year: number, files: File[]) => {
    // Immediately add docs in "parsing" state, then parse async and update
    const newDocs: ParsedDoc[] = files.map(f => ({ file: f, state: "parsing", data: null }))
    setYearEntries(yearEntries.map(e =>
      e.year === year ? { ...e, files: [...e.files, ...files], parsedDocs: [...e.parsedDocs, ...newDocs] } : e
    ))
    files.forEach((file, idx) => {
      const docIndex = yearEntries.find(e => e.year === year)!.parsedDocs.length + idx
      parseLohnsteuerbescheinigung(file).then(data => {
        setYearEntries(prev => prev.map(e => {
          if (e.year !== year) return e
          const updated = [...e.parsedDocs]
          updated[docIndex] = { file, state: "done", data }
          return { ...e, parsedDocs: updated }
        }))
      }).catch(() => {
        setYearEntries(prev => prev.map(e => {
          if (e.year !== year) return e
          const updated = [...e.parsedDocs]
          updated[docIndex] = { file, state: "error", data: null }
          return { ...e, parsedDocs: updated }
        }))
      })
    })
  }, [yearEntries, setYearEntries])

  const removeDoc = (year: number, i: number) =>
    setYearEntries(yearEntries.map(e =>
      e.year === year
        ? { ...e, files: e.files.filter((_, idx) => idx !== i), parsedDocs: e.parsedDocs.filter((_, idx) => idx !== i) }
        : e
    ))

  const selected = yearEntries.filter(e => e.selected)
  const allHaveDocs = selected.every(e => e.parsedDocs.length > 0 || e.demoReady)
  const anyParsing = selected.some(e => e.parsedDocs.some(d => d.state === "parsing"))
  const canContinue = selected.length > 0 && (demoMode || allHaveDocs) && !anyParsing

  return (
    <div className="max-w-lg mx-auto">
      <StepBar current={1} total={5} label="Tax Years + Documents" />
      <ScreenTitle>Select years to recover</ScreenTitle>
      <Sub>Upload your Lohnsteuerbescheinigung for each year. Multiple files if you changed employers.</Sub>
      <div className="space-y-2">
        {yearEntries.map(e => (
          <YearCard key={e.year} entry={e} onToggle={() => toggle(e.year)}
            onAddFiles={f => addFiles(e.year, f)} onRemoveDoc={i => removeDoc(e.year, i)} />
        ))}
      </div>
      {selected.length > 0 && !allHaveDocs && !demoMode && (
        <div className="mt-4 text-green-800 text-xs font-mono">! Upload documents for all selected years to continue.</div>
      )}
      {anyParsing && (
        <div className="mt-2 text-green-900 text-xs font-mono">Parsing in progress — wait before continuing.</div>
      )}
      <Nav onBack={onBack} onNext={onNext} disabled={!canContinue} />
    </div>
  )
}

// ─── Commute Screen ───────────────────────────────────────────────────────────

function CommuteScreen({ commute, setCommute, onNext, onBack }: {
  commute: CommuteData; setCommute: (c: CommuteData) => void; onNext: () => void; onBack: () => void
}) {
  const days = calcCommuteDays(commute.wfhDaysPerWeek, commute.vacationDaysPerYear)
  const pendler = calcPendler(commute.distanceKm, days)
  const flat = 1230

  return (
    <div className="max-w-lg mx-auto">
      <StepBar current={2} total={5} label="Commute & Job Details" />
      <ScreenTitle>Pendlerpauschale</ScreenTitle>
      <Sub>Commuting costs are tax-deductible. Enter your one-way distance — only days you actually travelled count.</Sub>

      <Field label="Workplace Address" value={commute.workAddress}
        onChange={v => setCommute({ ...commute, workAddress: v })} placeholder="Unter den Linden 1, 10117 Berlin" />
      <Field label="One-way distance to work (km)" value={commute.distanceKm > 0 ? String(commute.distanceKm) : ""}
        onChange={v => setCommute({ ...commute, distanceKm: parseFloat(v) || 0 })} placeholder="25" type="number" />

      <div className="mb-4">
        <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">Home office days per week</div>
        <div className="border border-green-800 bg-black/50 px-3 py-2 focus-within:border-green-400 focus-within:shadow-[0_0_14px_rgba(51,255,51,0.55)] transition-all">
          <select value={String(commute.wfhDaysPerWeek)}
            onChange={e => setCommute({ ...commute, wfhDaysPerWeek: parseInt(e.target.value) })}
            className="w-full bg-transparent text-green-300 outline-none font-mono text-sm cursor-pointer"
            style={{ fontFamily:"'Share Tech Mono',monospace", appearance:"none" }}>
            {[0,1,2,3,4,5].map(n => (
              <option key={n} value={n} className="bg-black text-green-300">
                {n === 0 ? "0 — fully in office" : n === 5 ? "5 — fully remote" : `${n} day${n>1?"s":""}/week at home`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Field label="Approx. vacation days per year" value={commute.vacationDaysPerYear > 0 ? String(commute.vacationDaysPerYear) : ""}
        onChange={v => setCommute({ ...commute, vacationDaysPerYear: parseFloat(v) || 0 })} placeholder="25" type="number" />

      {commute.distanceKm > 0 && (
        <div className="border border-green-900 bg-black/40 p-4 mb-2 font-mono text-xs">
          <div className="text-green-700 mb-2 tracking-widest">─ PREVIEW ───────────────────</div>
          <div className="flex justify-between text-green-600 py-px"><span>Commute days/year</span><span>{days}</span></div>
          <div className="flex justify-between text-green-600 py-px"><span>Pendlerpauschale</span><span>€{pendler.toFixed(0)}</span></div>
          <div className="flex justify-between py-px border-t border-green-950 mt-2 pt-2">
            <span className="text-green-700">Deduction used</span>
            <span className={pendler > flat ? "text-green-300" : "text-green-700"}>
              {pendler > flat ? `Pendler wins (+€${(pendler - flat).toFixed(0)})` : `Flat rate (€${flat})`}
            </span>
          </div>
        </div>
      )}

      <div className="text-green-900 text-xs font-mono mb-2">Skip if fully remote — the flat Werbungskostenpauschale still applies.</div>
      <Nav onBack={onBack} onNext={onNext} nextLabel="Next: Deductions →" />
    </div>
  )
}

// ─── Werbungskosten Screen ────────────────────────────────────────────────────

function Toggle({ label, on, onToggle, children }: {
  label: string; on: boolean; onToggle: () => void; children?: React.ReactNode
}) {
  return (
    <div className={`border transition-all mb-3 ${on ? "border-green-700" : "border-green-950"}`}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-green-950/20 transition-colors" onClick={onToggle}>
        <div className={`text-xl leading-none shrink-0 transition-colors ${on ? "text-green-400" : "text-green-800"}`}>
          {on ? "☑" : "☐"}
        </div>
        <div className="flex-1 font-mono text-sm" style={{ fontFamily: "'Share Tech Mono', monospace" }}>
          <span className={on ? "text-green-300" : "text-green-700"}>{label}</span>
        </div>
        <div className={`text-xs font-mono tracking-widest px-2 py-0.5 border transition-colors ${on ? "border-green-700 text-green-500" : "border-green-900 text-green-900"}`}>
          {on ? "ON" : "OFF"}
        </div>
      </div>
      {on && children && (
        <div className="border-t border-green-950 px-4 pb-4 pt-3">{children}</div>
      )}
    </div>
  )
}

function AmountField({ label, value, onChange, nudge }: {
  label: string; value: number; onChange: (v: number) => void; nudge?: string
}) {
  return (
    <div className="mb-4">
      <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">{label}</div>
      <div className="flex items-center border border-green-800 bg-black/50 focus-within:border-green-400 focus-within:shadow-[0_0_14px_rgba(51,255,51,0.55),0_0_28px_rgba(51,255,51,0.2)] transition-all">
        <span className="text-green-600 font-mono text-sm px-3 py-2 border-r border-green-900 select-none">€</span>
        <input
          type="number"
          min={0}
          value={value || ""}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          placeholder="0"
          className="flex-1 bg-transparent text-green-300 placeholder-green-950 outline-none font-mono text-sm px-3 py-2"
          style={{ fontFamily: "'Share Tech Mono', monospace" }}
        />
      </div>
      {nudge && <div className="text-green-800 text-xs font-mono mt-1 leading-relaxed">{nudge}</div>}
    </div>
  )
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-6">
      <div className="flex-1 h-px bg-green-950" />
      <div className="text-green-800 text-xs font-mono tracking-widest uppercase">{label}</div>
      <div className="flex-1 h-px bg-green-950" />
    </div>
  )
}

function ReceiptUpload({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const add = (incoming: File[]) => onChange([...files, ...incoming])
  const remove = (i: number) => onChange(files.filter((_, idx) => idx !== i))
  return (
    <div className="mt-2 mb-1">
      {files.length > 0 && (
        <div className="space-y-1 mb-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-1 text-xs font-mono">
              <FileText size={10} className="text-green-800 shrink-0" />
              <span className="flex-1 text-green-700 truncate">{f.name}</span>
              <button onClick={() => remove(i)} className="text-green-900 hover:text-green-500 transition-colors"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => ref.current?.click()}
        className="text-green-900 hover:text-green-700 text-xs font-mono transition-colors flex items-center gap-1"
      >
        <span className="text-green-900">+</span> attach receipt{files.length > 0 ? " (another)" : ""}
      </button>
      <input ref={ref} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple className="hidden"
        onChange={e => { const f = Array.from(e.target.files ?? []); if (f.length) add(f); e.target.value = "" }} />
    </div>
  )
}

function WerbungskostenScreen({ data, setData, selectedYears, onNext, onBack }: {
  data: WerbungskostenData
  setData: (d: WerbungskostenData) => void
  selectedYears: number[]
  onNext: () => void
  onBack: () => void
}) {
  const set = (k: keyof WerbungskostenData) => (v: number | boolean | File[]) =>
    setData({ ...data, [k]: v })

  const telefonMonthly = Math.min((data.telefonMonthlyBill * 0.2), 20)
  const telefonTotal = Math.min(telefonMonthly * 12, 240)

  // Derive homeoffice display from the selected years
  // If 2022 is the only selected year: old rule. If 2023+ only: new rule. Mixed: show both.
  const has2022 = selectedYears.includes(2022)
  const hasNew = selectedYears.some(y => y >= 2023)
  const showMixed = has2022 && hasNew

  // For the live preview inside the toggle, use the most restrictive cap if mixed
  const previewRule = has2022 && !hasNew ? HOMEOFFICE[2022] : HOMEOFFICE[2023]
  const homeofficePreview = Math.min(data.homeofficeDays * previewRule.rate, previewRule.maxAmount)

  return (
    <div className="max-w-lg mx-auto">
      <StepBar current={3} total={5} label="Werbungskosten" />
      <ScreenTitle>Deductions</ScreenTitle>
      <Sub>Add what applies to you. Skip anything that doesn't — you can leave fields blank.</Sub>

      {/* Homeoffice */}
      <Toggle
        label={has2022 && !hasNew
          ? "Homeoffice-Pauschale — €5/day, max €600/yr (2022 rule)"
          : "Homeoffice-Pauschale — €6/day, max €1,260/yr"}
        on={data.homeofficeEnabled}
        onToggle={() => set("homeofficeEnabled")(!data.homeofficeEnabled)}
      >
        <div className="mb-2">
          <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">Days worked from home</div>
          <div className="flex items-center gap-3">
            <div className="flex items-center border border-green-800 bg-black/50 focus-within:border-green-400 focus-within:shadow-[0_0_14px_rgba(51,255,51,0.55)] transition-all flex-1">
              <input type="number" min={0} max={previewRule.maxDays} value={data.homeofficeDays || ""}
                onChange={e => set("homeofficeDays")(parseInt(e.target.value) || 0)}
                placeholder="0" className="flex-1 bg-transparent text-green-300 placeholder-green-950 outline-none font-mono text-sm px-3 py-2"
                style={{ fontFamily: "'Share Tech Mono', monospace" }} />
              <span className="text-green-800 font-mono text-xs pr-3">days</span>
            </div>
            {data.homeofficeDays > 0 && (
              <div className="text-green-400 font-mono text-sm shrink-0">= €{homeofficePreview}</div>
            )}
          </div>
          {showMixed ? (
            <div className="text-green-800 text-xs font-mono mt-1 space-y-px">
              <div>2022: €5/day · max 120 days (€600)</div>
              <div>2023–2025: €6/day · max 210 days (€1,260)</div>
              <div className="text-green-900">Enter your days for each year — the correct rate applies automatically.</div>
            </div>
          ) : (
            <div className="text-green-800 text-xs font-mono mt-1">
              Max {previewRule.maxDays} days (€{previewRule.maxAmount.toLocaleString()}). Count only days you actually worked from home — not weekends or holidays.
            </div>
          )}
        </div>
      </Toggle>

      {/* Telefon/Internet */}
      <Toggle
        label="Telefon/Internet-Pauschale — up to €240/yr"
        on={data.telefonEnabled}
        onToggle={() => set("telefonEnabled")(!data.telefonEnabled)}
      >
        <div className="mb-2">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-green-700 text-xs tracking-widest uppercase font-mono mb-1">Monthly phone/internet bill (€)</div>
              <div className="flex items-center border border-green-800 bg-black/50 focus-within:border-green-400 focus-within:shadow-[0_0_14px_rgba(51,255,51,0.55)] transition-all">
                <span className="text-green-600 font-mono text-sm px-3 py-2 border-r border-green-900">€</span>
                <input type="number" min={0} value={data.telefonMonthlyBill || ""} onChange={e => set("telefonMonthlyBill")(parseFloat(e.target.value) || 0)}
                  placeholder="0" className="flex-1 bg-transparent text-green-300 placeholder-green-950 outline-none font-mono text-sm px-3 py-2"
                  style={{ fontFamily: "'Share Tech Mono', monospace" }} />
              </div>
            </div>
            {data.telefonMonthlyBill > 0 && (
              <div className="text-right shrink-0 pt-5">
                <div className="text-green-400 font-mono text-sm">€{telefonTotal.toFixed(0)}/yr</div>
                <div className="text-green-800 text-xs font-mono">20% capped</div>
              </div>
            )}
          </div>
          <div className="text-green-800 text-xs font-mono mt-1">{"Don't have the exact number? A rough estimate is fine — this is often worth up to €240/year."}</div>
        </div>
      </Toggle>

      {/* Arbeitsmittel */}
      <div className="mb-4">
        <AmountField label="Arbeitsmittel — work equipment" value={data.arbeitsmittelAmount}
          onChange={v => set("arbeitsmittelAmount")(v)}
          nudge="Look for order confirmations or receipts from anything you bought for work this year." />
        <ReceiptUpload files={data.arbeitsmittelFiles}
          onChange={f => set("arbeitsmittelFiles")(f)} />
      </div>

      {/* Fachliteratur */}
      <div className="mb-4">
        <AmountField label="Fachliteratur / Fortbildung" value={data.fachliteraturAmount}
          onChange={v => set("fachliteraturAmount")(v)}
          nudge="Courses, books, certifications tied to your work." />
        <ReceiptUpload files={data.fachliteraturFiles}
          onChange={f => set("fachliteraturFiles")(f)} />
      </div>

      {/* Bewerbungskosten */}
      <AmountField label="Bewerbungskosten — job application costs" value={data.bewerbungskosten} onChange={v => set("bewerbungskosten")(v)} />

      <SectionDivider label="Sonderausgaben" />

      {/* Versicherungen */}
      <AmountField label="Versicherungen" value={data.versicherungenAmount} onChange={v => set("versicherungenAmount")(v)}
        nudge="Check your email for 'Beitragsrechnung' or 'Versicherungsschein' — most insurers send one yearly." />

      {/* Spenden */}
      <AmountField label="Spenden — donations" value={data.spendenAmount} onChange={v => set("spendenAmount")(v)}
        nudge="Include informal donations too — GoFundMe, school fundraisers — as long as you have a receipt or confirmation email." />

      {/* Steuerberatungskosten */}
      <AmountField label="Steuerberatungskosten" value={data.steuerberatungAmount} onChange={v => set("steuerberatungAmount")(v)}
        nudge="Pre-filled with our fee. A full Steuerberater can cost up to €818 — add that instead if you used one." />

      <Nav onBack={onBack} onNext={onNext} nextLabel="Review →" />
    </div>
  )
}

// ─── Paywall ──────────────────────────────────────────────────────────────────

function PaymentForm({ plan, email, onSuccess }: { plan: "2yr" | "4yr"; email: string; onSuccess: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setError(null)

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { receipt_email: email || undefined },
    })

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed — please try again.")
      setSubmitting(false)
    } else if (paymentIntent?.status === "succeeded") {
      onSuccess()
    } else {
      setError("Unexpected payment status. Contact support if charged.")
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-5">
        <PaymentElement options={{ layout: "tabs" }} />
      </div>

      {error && (
        <div className="border border-red-900 bg-red-950/20 p-3 mb-4 text-red-400 font-mono text-xs">
          ⚠ {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className={`w-full py-4 font-mono tracking-widest uppercase transition-all border-2 ${
          submitting || !stripe
            ? "border-green-950 text-green-950 cursor-not-allowed"
            : "border-green-400 text-green-300 hover:bg-green-400 hover:text-black cursor-pointer"
        }`}
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: "1.15rem",
          boxShadow: submitting || !stripe ? "none" : "0 0 20px rgba(51,255,51,0.25)",
        }}
      >
        {submitting ? (
          <span className="inline-flex items-center gap-3">
            <Loader size={14} className="animate-spin" />
            Processing<BlinkCursor />
          </span>
        ) : (
          `PAY €${PLANS[plan].price.toFixed(2)} ▶`
        )}
      </button>

      <div className="text-green-950 text-xs font-mono mt-3 text-center">
        Secured by Stripe · Your card details never touch our servers
      </div>
    </form>
  )
}

function PaywallModal({ plan, email, onSuccess, onClose }: {
  plan: "2yr" | "4yr"; email: string; onSuccess: () => void; onClose: () => void
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    fetch(PAYMENT_INTENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountCents: PLAN_AMOUNTS[plan], email }),
    })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then(d => setClientSecret(d.clientSecret))
      .catch(() => setFetchError("Could not connect to payment server. Please try again."))
  }, [plan, email])

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/95 flex items-start justify-center overflow-y-auto px-4 py-12"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md border border-green-800 bg-[#050a05] p-6 relative"
        style={{ boxShadow: "0 0 60px rgba(51,255,51,0.07), 0 0 120px rgba(51,255,51,0.03)" }}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-5 pb-4 border-b border-green-950">
          <div className="text-green-700 font-mono text-xs tracking-widest">STEUERBOT/88 — CHECKOUT</div>
          <button onClick={onClose} className="text-green-900 hover:text-green-500 transition-colors font-mono text-sm leading-none" title="Cancel">✕</button>
        </div>

        {/* Plan summary */}
        <div className="flex items-baseline justify-between mb-6 border border-green-950 bg-black/40 px-4 py-3">
          <div>
            <div className="text-green-500 font-mono text-xs tracking-widest">{PLANS[plan].label}</div>
            <div className="text-green-800 font-mono text-xs mt-px">
              {plan === "2yr" ? "2023 + 2024 returns" : "2022 + 2023 + 2024 + 2025 returns"} · one-time
            </div>
          </div>
          <div className="text-green-100 font-mono" style={{ fontFamily: "'VT323', monospace", fontSize: "2rem", textShadow: "0 0 12px rgba(51,255,51,0.4)" }}>
            €{PLANS[plan].price.toFixed(2)}
          </div>
        </div>

        {/* State: loading / error / form */}
        {fetchError && (
          <div className="border border-yellow-900 p-4 text-yellow-700 font-mono text-xs mb-4">
            ⚠ {fetchError}
          </div>
        )}
        {!clientSecret && !fetchError && (
          <div className="py-12 text-center text-green-800 font-mono text-xs">
            Connecting<BlinkCursor />
          </div>
        )}
        {clientSecret && (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: STRIPE_APPEARANCE }}>
            <PaymentForm plan={plan} email={email} onSuccess={onSuccess} />
          </Elements>
        )}
      </div>
    </div>
  )
}

// ─── Review Screen ────────────────────────────────────────────────────────────

type PrintLine =
  | { kind: "file"; text: string }
  | { kind: "cmd"; text: string }
  | { kind: "blank" }
  | { kind: "row"; label: string; value: string; note?: string }
  | { kind: "refund"; amount: number }
  | { kind: "grand"; amount: number }

function DotRow({ label, value, note }: { label: string; value: string; note?: string }) {
  const COL = 52
  const dots = Math.max(3, COL - label.length - value.length)
  const zero = value === "€0"
  return (
    <div className="font-mono text-xs leading-5 whitespace-nowrap">
      <span className={zero ? "text-green-950" : "text-green-700"}>{label}</span>
      <span className="text-green-950">{" " + ".".repeat(dots) + " "}</span>
      <span className={zero ? "text-green-950" : "text-green-400"}>{value}</span>
      {note && <span className="text-green-900 ml-2">{note}</span>}
    </div>
  )
}

// ─── Pre-Flight Check Screen ───────────────────────────────────────────────────

type PFKey = string // e.g. "2022-0-brutto"

function PreflightRow({ fkey, label, display, editable, isChecked, isEditing, editVal, onToggle, onStartEdit, onEditChange, onCommit, onCancelEdit }: {
  fkey: PFKey; label: string; display: string; editable?: boolean
  isChecked: boolean; isEditing: boolean; editVal: string
  onToggle: () => void; onStartEdit: () => void
  onEditChange: (v: string) => void; onCommit: () => void; onCancelEdit: () => void
}) {
  return (
    <div className="flex items-center gap-3 py-1 border-b border-green-950/40">
      <button
        onClick={onToggle}
        className={`text-lg leading-none shrink-0 transition-colors ${isChecked ? "text-green-400" : "text-green-800 hover:text-green-600"}`}
        style={{ fontFamily:"'VT323',monospace", minWidth:"1.1rem" }}
      >
        {isChecked ? "☑" : "❏"}
      </button>
      <span className="text-green-800 text-xs font-mono w-44 shrink-0">{label}</span>
      {isEditing ? (
        <input
          autoFocus
          value={editVal}
          onChange={e => onEditChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={e => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCancelEdit() }}
          className="flex-1 bg-black border border-green-600 text-green-300 text-xs font-mono px-2 py-px outline-none"
          style={{ maxWidth:"180px" }}
        />
      ) : (
        <span
          className={`flex-1 text-xs font-mono text-right ${isChecked ? "text-green-500" : "text-green-300"} ${editable ? "cursor-pointer hover:text-green-200 hover:underline" : ""}`}
          onClick={editable ? onStartEdit : undefined}
          title={editable ? "Click to correct value" : undefined}
        >
          {display}
        </span>
      )}
    </div>
  )
}

function pfKey(year: number, docIdx: number, field: string): PFKey {
  return `${year}-${docIdx}-${field}`
}

function PreflightScreen({ yearEntries, setYearEntries, onNext, onBack }: {
  yearEntries: YearEntry[]
  setYearEntries: (entries: YearEntry[]) => void
  onNext: () => void
  onBack: () => void
}) {
  const [checked, setChecked] = useState<Set<PFKey>>(new Set())
  const [editingKey, setEditingKey] = useState<PFKey | null>(null)
  const [editVal, setEditVal] = useState("")

  const docEntries = yearEntries
    .filter(e => e.selected)
    .flatMap(e =>
      e.parsedDocs
        .filter(d => d.state === "done" && d.data)
        .map((d, idx) => ({ entry: e, doc: d, docIdx: idx }))
    )

  // Build the complete set of required keys across all docs
  const requiredKeys = useMemo<PFKey[]>(() => {
    const keys: PFKey[] = []
    docEntries.forEach(({ entry, doc, docIdx }) => {
      const d = doc.data!
      if (d.periodStart) keys.push(pfKey(entry.year, docIdx, "zeitraum"))
      if (d.bruttoarbeitslohn !== null) keys.push(pfKey(entry.year, docIdx, "brutto"))
      if (d.lohnsteuer !== null) keys.push(pfKey(entry.year, docIdx, "lohnsteuer"))
      if (d.solidaritaetszuschlag !== null && d.solidaritaetszuschlag > 0)
        keys.push(pfKey(entry.year, docIdx, "solz"))
    })
    return keys
  }, [docEntries])

  const allDone = requiredKeys.length === 0 || requiredKeys.every(k => checked.has(k))

  const toggle = (k: PFKey) =>
    setChecked(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })

  const checkAll = () => setChecked(new Set(requiredKeys))

  // Commit an edited numeric field back into yearEntries
  const commitEdit = (year: number, docIdx: number, field: string) => {
    const raw = editVal.replace(",", ".").replace(/[^\d.]/g, "")
    const num = parseFloat(raw)
    if (isNaN(num)) { setEditingKey(null); return }
    setYearEntries(yearEntries.map(e => {
      if (e.year !== year) return e
      return {
        ...e,
        parsedDocs: e.parsedDocs.map((d, i) => {
          if (i !== docIdx || !d.data) return d
          const patch: Partial<ParsedLohnsteuerbescheinigung> =
            field === "brutto" ? { bruttoarbeitslohn: num } :
            field === "lohnsteuer" ? { lohnsteuer: num } :
            field === "solz" ? { solidaritaetszuschlag: num } : {}
          return { ...d, data: { ...d.data, ...patch } }
        }),
      }
    }))
    setEditingKey(null)
  }

  const noDocs = docEntries.length === 0
  const hasNoParsed = yearEntries.filter(e => e.selected).every(e => e.parsedDocs.length === 0 || e.parsedDocs.every(d => d.state !== "done"))

  return (
    <div>
      <div className="mb-8">
        <div style={{ fontFamily:"'VT323',monospace", fontSize:"2rem" }} className="text-green-400 tracking-widest mb-1">
          PRE-FLIGHT CHECK
        </div>
        <div className="text-green-700 text-xs font-mono leading-relaxed">
          Verify each parsed value against your physical documents.<br />
          Tick ❏ to confirm — or click a value to correct it — then CONTINUE.
        </div>
      </div>

      {(noDocs || hasNoParsed) ? (
        <div className="border border-green-950 px-4 py-4 mb-6">
          <div className="text-yellow-700 text-xs font-mono mb-1">⚠ No documents parsed</div>
          <div className="text-green-800 text-xs font-mono">
            No Lohnsteuerbescheinigung PDFs were uploaded for the selected years.<br />
            You can enter figures manually on the Review screen.
          </div>
        </div>
      ) : (
        <>
          <button
            onClick={allDone ? () => setChecked(new Set()) : checkAll}
            className="mb-5 text-xs font-mono text-green-700 hover:text-green-400 border border-green-900 hover:border-green-700 px-3 py-1 transition-colors"
          >
            {allDone ? "UNCHECK ALL" : "CHECK ALL"}
          </button>

          <div className="space-y-6">
            {yearEntries.filter(e => e.selected).map(entry => {
              const doneDocs = entry.parsedDocs.filter(d => d.state === "done" && d.data)
              if (doneDocs.length === 0) return null
              return (
                <div key={entry.year}>
                  <div className="text-green-600 text-xs font-mono tracking-widest mb-2 border-b border-green-950 pb-1"
                    style={{ fontFamily:"'VT323',monospace", fontSize:"1.15rem" }}>
                    {entry.year}
                  </div>
                  <div className="space-y-3">
                    {entry.parsedDocs.map((doc, docIdx) => {
                      if (doc.state !== "done" || !doc.data) return null
                      const d = doc.data

                      const makeRow = (field: string, label: string, display: string, editable?: boolean) => {
                        const k = pfKey(entry.year, docIdx, field)
                        return (
                          <PreflightRow
                            key={k}
                            fkey={k}
                            label={label}
                            display={display}
                            editable={editable}
                            isChecked={checked.has(k)}
                            isEditing={editingKey === k}
                            editVal={editVal}
                            onToggle={() => toggle(k)}
                            onStartEdit={() => { setEditingKey(k); setEditVal(display) }}
                            onEditChange={setEditVal}
                            onCommit={() => commitEdit(entry.year, docIdx, field)}
                            onCancelEdit={() => setEditingKey(null)}
                          />
                        )
                      }

                      return (
                        <div key={docIdx} className="border border-green-950 bg-black/20 px-3 pt-2 pb-3">
                          <div className="text-green-700 text-xs font-mono truncate mb-2">
                            {doc.file.name}
                          </div>
                          {d.periodStart && makeRow("zeitraum", "Zeitraum", `${d.periodStart} – ${d.periodEnd ?? "?"}`)}
                          {d.bruttoarbeitslohn !== null && makeRow("brutto", "Bruttoarbeitslohn", `€${d.bruttoarbeitslohn.toLocaleString("de-DE", { minimumFractionDigits: 2 })}`, true)}
                          {d.lohnsteuer !== null && makeRow("lohnsteuer", "Lohnsteuer", `€${d.lohnsteuer.toLocaleString("de-DE", { minimumFractionDigits: 2 })}`, true)}
                          {d.solidaritaetszuschlag !== null && d.solidaritaetszuschlag > 0 && makeRow("solz", "Solidaritätszuschlag", `€${d.solidaritaetszuschlag.toLocaleString("de-DE", { minimumFractionDigits: 2 })}`, true)}
                          {d.confidence !== "high" && (
                            <div className="text-yellow-800 text-xs font-mono mt-2">⚠ Partial read — verify carefully.</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="flex justify-between items-center mt-10 pt-4 border-t border-green-950">
        <button onClick={onBack} className="text-green-800 hover:text-green-500 text-xs font-mono transition-colors">← BACK</button>
        <button
          onClick={onNext}
          disabled={!allDone && !noDocs && !hasNoParsed}
          className={`text-xs font-mono px-6 py-2 border transition-all ${
            allDone || noDocs || hasNoParsed
              ? "border-green-700 text-green-400 hover:bg-green-950/50"
              : "border-green-950 text-green-900 cursor-not-allowed"
          }`}
        >
          {allDone || noDocs || hasNoParsed ? "CONTINUE →" : `CONFIRM ${requiredKeys.filter(k => !checked.has(k)).length} MORE ❏`}
        </button>
      </div>
    </div>
  )
}

// ─── Review Screen ─────────────────────────────────────────────────────────────

function ReviewScreen({ profile, yearEntries, commute, werbungskosten, onGenerate, onBack }: {
  profile: Profile; yearEntries: YearEntry[]; commute: CommuteData
  werbungskosten: WerbungskostenData; onGenerate: () => void; onBack: () => void
}) {
  const selected = yearEntries.filter(e => e.selected)
  const fmtE = (n: number) => `€${Math.round(n).toLocaleString()}`

  const allLines = useMemo<PrintLine[]>(() => {
    const lines: PrintLine[] = []
    let grandTotal = 0

    selected.forEach((entry, idx) => {
      if (idx > 0) lines.push({ kind: "blank" })

      // File header — use actual parsed filename if available
      const docName = entry.parsedDocs.find(d => d.state === "done")?.file.name
        ?? `${entry.year}_Einkommensteuererklaerung.pdf`
      lines.push({ kind: "file", text: `[${docName}] READY` })
      lines.push({ kind: "cmd", text: `> Processing ${entry.year}...` })
      lines.push({ kind: "blank" })

      // Per-year deduction calculations
      const pauschale = WERBUNGSKOSTEN_RATE[entry.year]
      const days = calcCommuteDays(commute.wfhDaysPerWeek, commute.vacationDaysPerYear)
      const pendler = calcPendler(commute.distanceKm, days)
      const werbung = Math.max(pauschale, pendler)

      const rule = HOMEOFFICE[entry.year] ?? HOMEOFFICE[2023]
      const homeoffice = werbungskosten.homeofficeEnabled
        ? Math.min(werbungskosten.homeofficeDays * rule.rate, rule.maxAmount)
        : 0
      const telefon = werbungskosten.telefonEnabled
        ? Math.min(Math.min(werbungskosten.telefonMonthlyBill * 0.2, 20) * 12, 240)
        : 0

      const totalDeductions =
        werbung + KONTOFUHRUNG + homeoffice + telefon
        + werbungskosten.arbeitsmittelAmount + werbungskosten.fachliteraturAmount
        + werbungskosten.bewerbungskosten + werbungskosten.versicherungenAmount
        + werbungskosten.spendenAmount + werbungskosten.steuerberatungAmount
      const estRefund = Math.round(totalDeductions * 0.25)
      grandTotal += estRefund

      lines.push({ kind: "row", label: "Werbungskosten", value: fmtE(werbung) })
      lines.push({ kind: "row", label: "Kontoführung", value: fmtE(KONTOFUHRUNG) })

      if (werbungskosten.homeofficeEnabled && werbungskosten.homeofficeDays > 0) {
        lines.push({
          kind: "row", label: "Homeoffice-Pauschale", value: fmtE(homeoffice),
          note: `(€${rule.rate}/day × ${werbungskosten.homeofficeDays} days, capped at €${rule.maxAmount.toLocaleString()})`,
        })
      }

      if (werbungskosten.arbeitsmittelAmount > 0) {
        lines.push({
          kind: "row", label: "Arbeitsmittel", value: fmtE(werbungskosten.arbeitsmittelAmount),
          note: "(expensed in full — under €952)",
        })
      }

      if (werbungskosten.telefonEnabled) {
        lines.push({
          kind: "row", label: "Telefon/Internet-Pauschale", value: fmtE(telefon),
          note: "(20% of bill, capped at €20/month)",
        })
      }

      lines.push({ kind: "row", label: "Fachliteratur/Fortbildung", value: fmtE(werbungskosten.fachliteraturAmount) })
      lines.push({ kind: "row", label: "Bewerbungskosten", value: fmtE(werbungskosten.bewerbungskosten) })
      lines.push({ kind: "row", label: "Versicherungen", value: fmtE(werbungskosten.versicherungenAmount) })
      lines.push({
        kind: "row", label: "Spenden", value: fmtE(werbungskosten.spendenAmount),
        note: werbungskosten.spendenAmount === 0 ? "(donations, church tax, GoFundMe)" : undefined,
      })
      lines.push({ kind: "row", label: "Steuerberatungskosten", value: fmtE(werbungskosten.steuerberatungAmount) })

      lines.push({ kind: "blank" })
      lines.push({ kind: "refund", amount: estRefund })
    })

    if (selected.length > 1) {
      lines.push({ kind: "blank" })
      lines.push({ kind: "grand", amount: grandTotal })
    }

    return lines
  }, [yearEntries, commute, werbungskosten])

  const [visible, setVisible] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setVisible(0)
    let i = 0
    const tick = () => {
      if (i < allLines.length) {
        i++
        setVisible(i)
        timerRef.current = setTimeout(tick, allLines[i - 1].kind === "blank" ? 80 : 150)
      }
    }
    timerRef.current = setTimeout(tick, 500)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [allLines])

  const done = visible >= allLines.length
  const visLines = allLines.slice(0, visible)

  return (
    <div className="max-w-lg mx-auto">
      <StepBar current={4} total={5} label="Review" />

      {/* Taxpayer header */}
      <div className="border border-green-900 p-4 mb-4 font-mono text-xs">
        <div className="text-green-800 mb-2 tracking-widest">─ TAXPAYER ──────────────────────</div>
        <div className="text-green-300">{profile.firstName} {profile.lastName}</div>
        <div className="text-green-800 mt-1">Steuernummer: {profile.steuerA}/{profile.steuerB}/{profile.steuerC}</div>
        <div className="text-green-800">Identifikationsnummer: {profile.identifikationsnummer}</div>
        <div className="text-green-800">DOB: {profile.dob}</div>
        <div className="text-green-800">{profile.street}, {profile.plz} {profile.city}</div>
        <div className="text-green-800">IBAN: {profile.iban}</div>
        <div className="text-green-800">Finanzamt: {profile.finanzamt}</div>
      </div>

      {/* Terminal printout */}
      <div className="border border-green-900 bg-black/40 p-4 mb-4 overflow-x-auto">
        <div className="min-w-[480px]">
          {visLines.map((line, i) => {
            switch (line.kind) {
              case "file":
                return <div key={i} className="text-green-400 font-mono text-xs mb-px">{line.text}</div>
              case "cmd":
                return <div key={i} className="text-green-700 font-mono text-xs mb-3">{line.text}</div>
              case "blank":
                return <div key={i} className="h-2" />
              case "row":
                return <DotRow key={i} label={line.label} value={line.value} note={line.note} />
              case "refund":
                return (
                  <div key={i} className="font-mono text-xs mt-3 pt-2 border-t border-green-950">
                    <span className="text-green-800">Est. refund: </span>
                    <span className="text-green-200" style={{ textShadow: "0 0 10px rgba(51,255,51,0.7)" }}>
                      ~{fmtE(line.amount)}
                    </span>
                  </div>
                )
              case "grand":
                return (
                  <div key={i} className="font-mono text-xs mt-2 pt-2 border-t border-green-900 flex items-baseline gap-3">
                    <span className="text-green-700 tracking-widest">TOTAL ALL YEARS</span>
                    <span className="text-green-100" style={{ textShadow: "0 0 14px rgba(51,255,51,0.9)" }}>
                      ~{fmtE(line.amount)}
                    </span>
                  </div>
                )
            }
          })}
          {!done && <BlinkCursor />}
        </div>
      </div>

      <div className="border-l-2 border-green-950 pl-3 text-green-900 text-xs font-mono mb-6">
        Estimates assume ~25% marginal rate. Sign and post each form to your Finanzamt. Keep copies.
      </div>

      {/* Pricing — appears once animation is done */}
      {done && (() => {
        const plan = getPlan(selected.length)
        return (
          <div className="border border-green-800 bg-black/30 p-4 mb-6 font-mono text-xs"
            style={{ boxShadow: "0 0 20px rgba(51,255,51,0.06)" }}>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-green-500 tracking-widest uppercase">{plan.label}</span>
              <span className="text-green-200 text-lg" style={{ fontFamily: "'VT323',monospace", textShadow: "0 0 10px rgba(51,255,51,0.5)" }}>
                €{plan.price.toFixed(2)}
              </span>
            </div>
            <div className="text-green-900">One-time · all selected years · resubmit support included</div>
          </div>
        )
      })()}

      <div className="flex justify-between items-center">
        <Btn onClick={onBack} dim>← Back</Btn>
        <button
          onClick={onGenerate}
          disabled={!done}
          className={`px-8 py-3 border-2 font-mono tracking-widest uppercase transition-all duration-500 ${
            done
              ? "border-green-400 text-green-300 hover:bg-green-400 hover:text-black cursor-pointer"
              : "border-green-950 text-green-950 cursor-not-allowed"
          }`}
          style={{
            fontFamily: "'VT323',monospace", fontSize: "1.15rem",
            boxShadow: done ? "0 0 24px rgba(51,255,51,0.3)" : "none",
          }}>
          {done ? `PAY €${getPlan(selected.length).price.toFixed(2)} & GENERATE ▶` : `GENERATE ${selected.length} FORM${selected.length !== 1 ? "S" : ""} ▶`}
        </button>
      </div>
    </div>
  )
}

// ─── Download helpers ─────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

function generateYearPdf(
  year: number,
  profile: Profile,
  commute: CommuteData,
  wk: WerbungskostenData,
  parsedDocs: ParsedDoc[],
): Blob {
  // ── Pre-calculate everything ──────────────────────────────────────────
  const rule = HOMEOFFICE[year] ?? HOMEOFFICE[2023]
  const pauschale = WERBUNGSKOSTEN_RATE[year] ?? 1230
  const commuteDays = calcCommuteDays(commute.wfhDaysPerWeek, commute.vacationDaysPerYear)
  const pendler = calcPendler(commute.distanceKm, commuteDays)
  const werbung = Math.max(pauschale, pendler)
  const homeoffice = wk.homeofficeEnabled ? Math.min(wk.homeofficeDays * rule.rate, rule.maxAmount) : 0
  const telefon = wk.telefonEnabled ? Math.min(Math.min(wk.telefonMonthlyBill * 0.2, 20) * 12, 240) : 0
  const weitereWK = homeoffice + telefon + wk.arbeitsmittelAmount + wk.fachliteraturAmount + wk.bewerbungskosten + KONTOFUHRUNG
  const totalWK = werbung + weitereWK
  const totalSonder = wk.versicherungenAmount + wk.spendenAmount + wk.steuerberatungAmount
  const estRefund = Math.round((totalWK + totalSonder) * 0.25)
  const parsed = parsedDocs.find(d => d.state === "done" && d.data?.year === year)?.data
  const steuernr = `${profile.steuerA}/${profile.steuerB}/${profile.steuerC}`
  const today = new Date().toLocaleDateString("de-DE")
  const deNum = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2 })
  const TOTAL_PAGES = 3

  // ── jsPDF setup ───────────────────────────────────────────────────────
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const W = 210, M = 18, R = W - M, CW = R - M
  const G: [number,number,number] = [35, 107, 57]   // official form green
  const DK: [number,number,number] = [25, 25, 25]
  const GR: [number,number,number] = [110, 110, 110]
  const LG: [number,number,number] = [190, 190, 190]
  let y = 0, pageNum = 1

  // ── Shared helpers ────────────────────────────────────────────────────
  const pageHeader = (subtitle: string, pn: number) => {
    // Three-column top header — matches the 2022 Vorschau layout
    doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...DK)
    doc.text("STEUERBOT/88", M, 9)
    doc.text(`Steuernummer ${steuernr}`, W/2, 9, { align: "center" })
    doc.text(`Datum der Ausfertigung: ${today}`, R, 9, { align: "right" })
    doc.setFont("helvetica", "normal"); doc.setFontSize(7)
    doc.text(profile.finanzamt, M, 13)
    doc.text(`${year}  Seite ${pn} von ${TOTAL_PAGES}`, R, 13, { align: "right" })
    doc.setDrawColor(...LG); doc.line(M, 15, R, 15)
    // Large year
    doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(...DK)
    doc.text(String(year), R, 27, { align: "right" })
    y = 22
  }

  const pageFooter = (pn: number) => {
    const fy = 289
    doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(...DK)
    doc.text("*** Vorschau ***", M, fy)
    doc.setFont("helvetica", "normal"); doc.setTextColor(...GR)
    doc.text("STEUERBOT/88 — Nicht einreichen. Daten via ELSTER uebermitteln oder Formular handschriftlich ausfuellen.", W/2, fy, { align: "center" })
    doc.text("*** Vorschau ***", R, fy, { align: "right" })
  }

  const sectionH1 = (text: string) => {
    y += 5
    doc.setFont("helvetica", "bold"); doc.setFontSize(13.5); doc.setTextColor(...DK)
    doc.text(text, M, y); y += 7
  }

  const sectionH2 = (text: string) => {
    y += 3
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...DK)
    doc.text(text, M, y); y += 5.5
  }

  const sectionH3 = (text: string) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...DK)
    doc.text(text, M, y); y += 5
  }

  // Field: line-number label | description | value (right-aligned)
  const field = (lineNum: string | number, label: string, value: string) => {
    doc.setFontSize(8.5); doc.setFont("helvetica", "normal")
    doc.setTextColor(...GR); doc.text(String(lineNum), M, y)
    doc.setTextColor(...DK); doc.text(label, M + 7, y)
    doc.setFont("helvetica", "bold"); doc.text(value, R, y, { align: "right" })
    y += 5.2
  }

  const hr = () => { doc.setDrawColor(...LG); doc.line(M, y, R, y); y += 3 }
  const blank = (h = 3) => { y += h }

  const checkPage = (need = 18) => {
    if (y > 275 - need) {
      pageFooter(pageNum); doc.addPage(); pageNum++
      pageHeader("", pageNum); y += 4
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 1 — HAUPTVORDRUCK EST 1 A
  // ══════════════════════════════════════════════════════════════════════
  pageHeader("Hauptvordruck", 1)

  sectionH1("Hauptvordruck ESt 1 A")

  sectionH2("Art der Erklärung")
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...DK)
  doc.text("Einkommensteuererklärung", M, y); y += 7

  sectionH2("Allgemeine Angaben")
  field(7, "Telefonische Rückfragen tagsüber unter Nummer", "(nicht angegeben)")

  blank(3)
  sectionH2("Steuerpflichtige Person. Nur bei Zusammenveranlagung: Ehemann oder Person A")

  field(8, "Identifikationsnummer", profile.identifikationsnummer)
  field(8, "Geburtsdatum", profile.dob)
  field(9, "Name", profile.lastName)
  field(10, "Vorname", profile.firstName)
  field(11, "Religion", "nicht kirchensteuerpflichtig")
  // Split street into name + number (best-effort)
  const streetMatch = profile.street.match(/^(.*?)\s+(\d+\s*\w*)$/)
  field(12, "Straße (derzeitige Adresse)", streetMatch?.[1] ?? profile.street)
  field(13, "Hausnummer", streetMatch?.[2] ?? "")
  field(14, "Postleitzahl (Inland)", profile.plz)
  field(15, "Wohnort", profile.city)
  field(17, "Ausgeübter Beruf", parsed?.employerName ? `Arbeitnehmer (${parsed.employerName})` : "Arbeitnehmer")

  blank(5)
  sectionH2("Bankverbindung")
  field(31, "IBAN (inländisches Geldinstitut)", profile.iban)

  blank(2)
  sectionH2("Kontoinhaber/-in")
  field(34, "", "steuerpflichtige Person / Ehemann / Person A")

  blank(6)
  hr()
  sectionH2("Ergänzende Angaben zur Steuererklärung")
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GR)
  const notice = "Diese Zusammenfassung wurde mit STEUERBOT/88 erstellt. Die Angaben entsprechen den eingegebenen Daten. Bitte prüfen Sie alle Angaben vor der Einreichung. Einreichung erfolgt handschriftlich oder über ELSTER (www.elster.de)."
  const noticeLines = doc.splitTextToSize(notice, CW)
  doc.text(noticeLines, M, y); y += noticeLines.length * 4.5 + 4

  blank(4)
  sectionH2("Unterschrift")
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...DK)
  doc.text("Datum, Unterschrift(en)    Steuererklärungen sind eigenhändig zu unterschreiben.", M, y); y += 8
  doc.setDrawColor(...DK); doc.line(M, y, M + 55, y); doc.line(M + 70, y, M + 145, y); y += 4
  doc.setFontSize(7); doc.setTextColor(...GR)
  doc.text("Datum", M, y); doc.text("Unterschrift", M + 70, y)

  pageFooter(1)

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 2 — ANLAGE N
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage(); pageNum = 2
  pageHeader("Anlage N", 2)

  sectionH1("Anlage N (Steuerpflichtige Person / Ehemann / Person A)")
  sectionH2("Einkünfte aus nichtselbständiger Arbeit")

  blank(1)
  if (parsed?.identifikationsnummer) {
    field(4, "eTIN laut Lohnsteuerbescheinigung", parsed.identifikationsnummer)
  }

  blank(3)
  sectionH2("Angaben zum Arbeitslohn")
  sectionH3("Lohnsteuerbescheinigung(en) Steuerklasse 1–5")

  if (parsed?.employerName) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...GR)
    doc.text(`Arbeitgeber: ${parsed.employerName}`, M + 7, y); y += 5
  }
  field(6, "Bruttoarbeitslohn", parsed?.bruttoarbeitslohn != null ? deNum(parsed.bruttoarbeitslohn) : "(von Lohnsteuerbescheinigung übertragen)")
  field(7, "Lohnsteuer", parsed?.lohnsteuer != null ? deNum(parsed.lohnsteuer) : "(von Lohnsteuerbescheinigung übertragen)")
  field(8, "Solidaritätszuschlag", parsed?.solidaritaetszuschlag != null ? deNum(parsed.solidaritaetszuschlag) : "0,00")
  if (parsed?.kirchensteuer != null && parsed.kirchensteuer > 0) {
    field(9, "Kirchensteuer des Arbeitnehmers", deNum(parsed.kirchensteuer))
  }

  blank(5)
  sectionH2("Werbungskosten")
  sectionH3("Wege zwischen Wohnung und erster Tätigkeitsstätte (Entfernungspauschale)")

  if (commute.workAddress && commute.distanceKm > 0) {
    blank(1)
    sectionH3("Erste Tätigkeitsstätte")
    field(31, "Erste Tätigkeitsstätte (Postleitzahl, Ort und Straße)", commute.workAddress)
    field(31, "Arbeitstage je Woche", `${5 - commute.wfhDaysPerWeek} Tage`)
    field(31, "Urlaubs-, Krankheits-, Heimarbeits- und Dienstreisetage", String(commute.vacationDaysPerYear + 10))
    field(35, "aufgesucht an Tagen", String(commuteDays))
    field(35, "einfache Entfernung in Kilometern (auf volle Kilometer abgerundet)", String(Math.floor(commute.distanceKm)))
    blank(1)
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GR)
    const pendlerNote = pendler > pauschale
      ? `Entfernungspauschale (${deNum(pendler)} EUR) > Werbungskostenpauschale (${deNum(pauschale)} EUR) — Pendlerpauschale wird angewandt.`
      : `Werbungskostenpauschale (${deNum(pauschale)} EUR) >= Entfernungspauschale (${deNum(pendler)} EUR) — Pauschale wird angewandt.`
    doc.text(pendlerNote, M + 7, y, { maxWidth: CW - 7 }); y += 7
  } else {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...GR)
    doc.text("(kein Pendelweg angegeben — Werbungskostenpauschale wird angewandt)", M + 7, y); y += 6
  }

  blank(4)
  sectionH2("Weitere Werbungskosten")
  sectionH3("Sonstiges (zum Beispiel Bewerbungskosten, Kontoführungsgebühren)")

  const wkItems: { label: string; amount: number }[] = []
  if (homeoffice > 0) wkItems.push({ label: `Homeoffice-Pauschale (${wk.homeofficeDays} Tage × ${rule.rate},00 EUR)`, amount: homeoffice })
  if (telefon > 0) wkItems.push({ label: `Telefon-/Internetkosten (20 % von ${wk.telefonMonthlyBill},00 EUR/Monat)`, amount: telefon })
  if (wk.arbeitsmittelAmount > 0) wkItems.push({ label: "Arbeitsmittel", amount: wk.arbeitsmittelAmount })
  if (wk.fachliteraturAmount > 0) wkItems.push({ label: "Fachliteratur / Fortbildungskosten", amount: wk.fachliteraturAmount })
  if (wk.bewerbungskosten > 0) wkItems.push({ label: "Bewerbungskosten", amount: wk.bewerbungskosten })
  wkItems.push({ label: "Kontoführungsgebühren", amount: KONTOFUHRUNG })

  wkItems.forEach(item => {
    checkPage()
    field(48, "Bezeichnung", item.label)
    field(48, "Betrag", deNum(item.amount))
    blank(1)
  })

  blank(2); hr()
  sectionH3("Summe")
  field(49, "Summe der weiteren Werbungskosten", deNum(weitereWK))
  blank(4); hr()
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...DK)
  doc.text(`Werbungskosten gesamt (angesetzt):  ${deNum(totalWK)} EUR`, M, y); y += 6

  pageFooter(2)

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 3 — ANLAGE SONDERAUSGABEN + SCHÄTZUNG
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage(); pageNum = 3
  pageHeader("Anlage Sonderausgaben", 3)

  sectionH1("Anlage Sonderausgaben")
  sectionH2("Angaben zu Sonderausgaben")
  sectionH3("– Ohne Versicherungsaufwendungen und Altersvorsorgebeiträge –")

  blank(3)
  if (wk.versicherungenAmount > 0) {
    sectionH3("Versicherungsbeiträge")
    field("", "Versicherungen (Haftpflicht, Rechtsschutz, Berufsunfähigkeit u. a.)", deNum(wk.versicherungenAmount))
    blank(2)
  }
  if (wk.spendenAmount > 0) {
    sectionH3("Spenden und Mitgliedsbeiträge")
    field(4, "Zuwendungen (Spenden) laut Zuwendungsbestätigungen", deNum(wk.spendenAmount))
    blank(2)
  }
  if (wk.steuerberatungAmount > 0) {
    sectionH3("Steuerberatungskosten")
    field(4, "Steuerberatungskosten", deNum(wk.steuerberatungAmount))
    blank(2)
  }

  blank(2); hr()
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...DK)
  doc.text(`Sonderausgaben gesamt:  ${deNum(totalSonder)} EUR`, M, y); y += 8

  blank(5); hr()

  // ── Refund estimate box ────────────────────────────────────────────
  doc.setFillColor(237, 247, 240)
  doc.setDrawColor(...G)
  doc.roundedRect(M, y, CW, 26, 2, 2, "FD")
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...G)
  doc.text("Schätzung der zu erwartenden Steuererstattung", M + 4, y + 7)
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...GR)
  doc.text("(bei ~25 % Grenzsteuersatz — tatsächlicher Betrag kann abweichen)", M + 4, y + 12)
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(...G)
  doc.text(`~${estRefund.toLocaleString("de-DE")} EUR`, R - 4, y + 20, { align: "right" })
  y += 32

  blank(8); hr()
  sectionH2("Nächste Schritte")
  const steps = [
    `1. Einreichen über ELSTER (kostenlos): www.elster.de — empfohlen vom Finanzamt.`,
    `2. Alternativ: Dieses Dokument ausdrucken, handschriftlich unterschreiben, einsenden an: ${profile.finanzamt}`,
    `   Adresse: www.bzst.de`,
    `3. Frist (Antragsveranlagung ${year}): ${DEADLINE[year] ?? "4 Jahre nach Ende des Steuerjahres"}`,
    `4. IBAN für Rückerstattung: ${profile.iban} — Konto bis zur Erstattung offen halten.`,
    `5. Bearbeitungszeit: 3–6 Monate. Belege und Nachweise 10 Jahre aufbewahren.`,
  ]
  steps.forEach(s => {
    checkPage()
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...DK)
    const lines = doc.splitTextToSize(s, CW)
    doc.text(lines, M, y); y += lines.length * 4.8 + 1.5
  })

  pageFooter(3)

  return doc.output("blob")
}

// ─── Complete Screen ──────────────────────────────────────────────────────────

function CompleteScreen({ yearEntries, commute, profile, werbungskosten }: {
  yearEntries: YearEntry[]; commute: CommuteData
  profile: Profile; werbungskosten: WerbungskostenData
}) {
  const selected = useMemo(() => yearEntries.filter(e => e.selected), [yearEntries])
  const results = useMemo(() => selected.map(e => ({ year: e.year, ...calcYearResult(e.year, commute) })), [selected, commute])
  const totalEst = useMemo(() => results.reduce((s, r) => s + r.total, 0), [results])

  const [lines, setLines] = useState<{ text: string; style: string }[]>([])
  const [phase, setPhase] = useState<"processing"|"ching"|"done">("processing")
  const [count, setCount] = useState(0)
  const soundRef = useRef(false)

  useEffect(() => {
    let t = 0
    const q = (text: string, style: string, wait: number) => {
      t += wait
      setTimeout(() => setLines(l => [...l, { text, style }]), t)
    }
    q("> Initializing PDF renderer...", "dim", 300)
    q("> Loading official form templates...", "dim", 700)
    q("", "dim", 1100)
    let base = 1400
    selected.forEach((s, i) => {
      const r = results[i]
      setTimeout(() => setLines(l => [...l, { text: `> Processing ${s.year}...`, style: "mid" }]), base); base += 700
      setTimeout(() => setLines(l => [...l, { text: `  Werbungskosten:  €${r.werbungskosten.toLocaleString()}`, style: "detail" }]), base); base += 150
      setTimeout(() => setLines(l => [...l, { text: `  Kontoführung:    €${r.kontoführung}`, style: "detail" }]), base); base += 150
      setTimeout(() => setLines(l => [...l, { text: `  Est. refund:     ~€${r.total}`, style: "detail" }]), base); base += 250
      setTimeout(() => setLines(l => [...l, { text: `  [${s.year}_Einkommensteuererklaerung.pdf]  READY`, style: "ok" }]), base); base += 150
      setTimeout(() => setLines(l => [...l, { text: "", style: "dim" }]), base); base += 200
    })
    setTimeout(() => setLines(l => [...l, { text: "> All forms generated successfully.", style: "bright" }]), base)
    setTimeout(() => {
      setPhase("ching")
      if (!soundRef.current) { soundRef.current = true; playChaChing(); setTimeout(playChaChing, 1000) }
    }, base + 600)
    setTimeout(() => setPhase("done"), base + 1800)
  }, [])

  useEffect(() => {
    if (phase === "processing") return
    let f = 0; const frames = 80
    const id = setInterval(() => { f++; setCount(Math.round((f/frames)*totalEst)); if(f>=frames) clearInterval(id) }, 14)
    return () => clearInterval(id)
  }, [phase, totalEst])

  const lc: Record<string,string> = { dim:"text-green-900", mid:"text-green-500", detail:"text-green-700", ok:"text-green-300", bright:"text-green-200" }

  return (
    <div className="max-w-lg mx-auto">
      <div className="border border-green-900 bg-black/60 p-4 mb-6 min-h-52">
        <div className="text-green-800 text-xs font-mono mb-3 tracking-widest">─ GENERATING FORMS ──────────────────</div>
        <div className="font-mono text-xs space-y-px">
          {lines.map((l, i) => <div key={i} className={lc[l.style] ?? "text-green-700"}>{l.text || " "}</div>)}
          {phase === "processing" && <BlinkCursor />}
        </div>
      </div>

      {phase !== "processing" && (
        <div className="border-2 p-8 text-center transition-all duration-500"
          style={{ borderColor:"#4af626", boxShadow:"0 0 60px rgba(74,246,38,0.35),0 0 120px rgba(74,246,38,0.15),inset 0 0 40px rgba(74,246,38,0.06)" }}>
          <div className="text-green-700 text-xs font-mono tracking-widest mb-3 uppercase">cha-ching</div>
          <div className="font-mono mb-1" style={{ fontFamily:"'VT323',monospace", fontSize:"3.5rem", lineHeight:1, color:"#4af626", textShadow:"0 0 24px #4af626,0 0 48px rgba(74,246,38,0.5)" }}>
            ~€{count.toLocaleString()}
          </div>
          <div className="text-green-700 text-xs font-mono tracking-widest">ESTIMATED TOTAL REFUND</div>
          {phase === "done" && (
            <div className="mt-6 border-t border-green-900 pt-4 space-y-1">
              {results.map(r => (
                <div key={r.year} className="flex justify-between text-xs font-mono px-4">
                  <span className="text-green-700">{r.year}</span><span className="text-green-600">~€{r.total}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === "done" && (
        <div className="mt-6 space-y-4">
          <div className="border border-green-900 p-4 font-mono text-xs">
            <div className="text-green-700 mb-2 tracking-widest">─ NEXT STEPS ────────────────────</div>
            <div className="space-y-1 text-green-700">
              <div>1. Download your completed forms below</div>
              <div>2. Print, sign, and date each form</div>
              <div>3. Post to your Finanzamt (address on cover page)</div>
              <div>4. Keep copies — Finanzämter can take 3–6 months</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              className="py-3 border border-green-600 text-green-400 font-mono text-xs tracking-widest uppercase hover:bg-green-950 transition-all hover:shadow-[0_0_12px_rgba(51,255,51,0.2)]"
              style={{ fontFamily:"'Share Tech Mono',monospace" }}
              onClick={async () => {
                const zip = new JSZip()
                selected.forEach(e => {
                  const pdf = generateYearPdf(e.year, profile, commute, werbungskosten, e.parsedDocs)
                  zip.file(`steuerbot88_${e.year}.pdf`, pdf)
                })
                const blob = await zip.generateAsync({ type: "blob" })
                triggerDownload(blob, `steuerbot88_${selected.map(e => e.year).join("-")}.zip`)
              }}
            >
              Download All (ZIP)
            </button>
            <button
              className="py-3 border border-green-900 text-green-700 font-mono text-xs tracking-widest uppercase hover:border-green-700 hover:text-green-500 transition-all"
              style={{ fontFamily:"'Share Tech Mono',monospace" }}
              onClick={() => {
                selected.forEach((e, i) => {
                  setTimeout(() => {
                    const pdf = generateYearPdf(e.year, profile, commute, werbungskosten, e.parsedDocs)
                    triggerDownload(pdf, `steuerbot88_${e.year}.pdf`)
                  }, i * 400)
                })
              }}
            >
              Download Separately
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Demo ─────────────────────────────────────────────────────────────────────

function runDemo(
  setStep: (s: Step) => void,
  setProfile: (fn: (p: Profile) => Profile) => void,
  setYearEntries: (e: YearEntry[]) => void,
  setCommute: (fn: CommuteData | ((c: CommuteData) => CommuteData)) => void,
  setWerbungskosten: (fn: WerbungskostenData | ((d: WerbungskostenData) => WerbungskostenData)) => void,
  setDemoMode: (b: boolean) => void,
) {
  setDemoMode(true)
  setStep("checklist")

  let t = 0
  const q = (fn: () => void, wait: number) => { t += wait; setTimeout(fn, t) }

  // Reset state
  q(() => {
    setProfile(() => ({ ...INITIAL_PROFILE }))
    setWerbungskosten({ ...INITIAL_WERBUNGSKOSTEN })
  }, 200)

  // ── Checklist: type email ──
  const email = DEMO_PROFILE.email
  email.split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, email: email.slice(0, i+1) })), i === 0 ? 1000 : 75))
  q(() => setStep("profile"), 900)

  // ── Profile: typewriter fill ──
  const dp = DEMO_PROFILE
  dp.firstName.split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, firstName: dp.firstName.slice(0,i+1) })), i === 0 ? 700 : 110))
  dp.lastName.split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, lastName: dp.lastName.slice(0,i+1) })), i === 0 ? 400 : 110))

  q(() => setProfile(p => ({ ...p, steuerA: "2" })), 550)
  q(() => setProfile(p => ({ ...p, steuerA: "21" })), 180)
  q(() => setProfile(p => ({ ...p, steuerB: "4" })), 300)
  q(() => setProfile(p => ({ ...p, steuerB: "48" })), 180)
  q(() => setProfile(p => ({ ...p, steuerB: "481" })), 180)
  dp.steuerC.split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, steuerC: dp.steuerC.slice(0,i+1) })), i === 0 ? 300 : 160))

  dp.identifikationsnummer.split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, identifikationsnummer: dp.identifikationsnummer.slice(0,i+1) })), i === 0 ? 500 : 100))

  "22.02.1982".split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, dob: "22.02.1982".slice(0,i+1) })), i === 0 ? 500 : 120))

  dp.street.split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, street: dp.street.slice(0,i+1) })), i === 0 ? 450 : 70))
  dp.plz.split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, plz: dp.plz.slice(0,i+1) })), i === 0 ? 300 : 120))
  dp.city.split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, city: dp.city.slice(0,i+1) })), i === 0 ? 300 : 100))

  const ibanRest = dp.iban.slice(2)
  ibanRest.split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, iban: "DE" + ibanRest.slice(0,i+1) })), i === 0 ? 450 : 85))

  dp.finanzamt.split("").forEach((_, i) => q(() => setProfile(p => ({ ...p, finanzamt: dp.finanzamt.slice(0,i+1) })), i === 0 ? 400 : 62))

  // ── Years: stamp all four ──
  q(() => {
    setYearEntries(AVAILABLE_YEARS.map(year => ({ year, selected: true, files: [], parsedDocs: [], demoReady: true })))
    setStep("years")
  }, 1100)

  // ── Commute: fill and advance ──
  q(() => setStep("commute"), 1400)
  const wa = DEMO_COMMUTE.workAddress
  wa.split("").forEach((_, i) => q(() => setCommute(c => ({ ...c, workAddress: wa.slice(0,i+1) })), i === 0 ? 700 : 48))
  q(() => setCommute(c => ({ ...c, distanceKm: 12 })), 600)
  q(() => setCommute(c => ({ ...c, wfhDaysPerWeek: 1 })), 500)
  q(() => setCommute(c => ({ ...c, vacationDaysPerYear: 28 })), 500)

  // ── Werbungskosten: reveal fields one by one ──
  q(() => setStep("werbungskosten"), 1000)
  q(() => setWerbungskosten(d => ({ ...d, homeofficeEnabled: true })), 1000)
  q(() => setWerbungskosten(d => ({ ...d, homeofficeDays: 4 })), 700)
  q(() => setWerbungskosten(d => ({ ...d, homeofficeDays: 48 })), 400)
  q(() => setWerbungskosten(d => ({ ...d, telefonMonthlyBill: 45 })), 900)
  q(() => setWerbungskosten(d => ({ ...d, arbeitsmittelAmount: 349 })), 1000)
  q(() => setWerbungskosten(d => ({ ...d, fachliteraturAmount: 89 })), 900)
  q(() => setWerbungskosten(d => ({ ...d, versicherungenAmount: 210 })), 1000)
  q(() => setWerbungskosten(d => ({ ...d, spendenAmount: 50 })), 900)
  // steuerberatungAmount already pre-filled at 95 from INITIAL

  // ── Review then complete ──
  q(() => setStep("review"), 1400)
  q(() => setStep("complete"), 3000)
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState<Step>("boot")
  const [profile, setProfile] = useState<Profile>(INITIAL_PROFILE)
  const [yearEntries, setYearEntries] = useState<YearEntry[]>(INITIAL_YEARS)
  const [commute, setCommute] = useState<CommuteData>(INITIAL_COMMUTE)
  const [werbungskosten, setWerbungskosten] = useState<WerbungskostenData>(INITIAL_WERBUNGSKOSTEN)
  const [demoMode, setDemoMode] = useState(false)
  const [showPaywall, setShowPaywall] = useState(false)

  const selectedYears = yearEntries.filter(e => e.selected)
  const planKey = getPlanKey(selectedYears.length)

  const handlePaySuccess = () => {
    setShowPaywall(false)
    setStep("complete")
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden" style={{ fontFamily:"'Share Tech Mono',monospace" }}>
      <Scanlines />
      <Vignette />

      <div className="relative z-10 min-h-screen">
        {step === "boot" && <BootScreen onStart={() => setStep("checklist")} />}
        {step === "checklist" && <ChecklistScreen email={profile.email} setEmail={v => setProfile(p => ({ ...p, email: v }))} onContinue={() => setStep("profile")} />}

        {step !== "boot" && step !== "checklist" && (
          <div className="max-w-2xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-12 border-b border-green-950 pb-3">
              <div className="text-green-700 text-sm tracking-widest" style={{ fontFamily:"'VT323',monospace", fontSize:"1rem" }}>STEUERBOT/88</div>
              <div className="text-green-900 text-xs font-mono">{new Date().toISOString().slice(0,10)}</div>
            </div>

            {step === "profile" && <ProfileScreen profile={profile} setProfile={setProfile} onNext={() => setStep("years")} />}
            {step === "years" && <YearsScreen yearEntries={yearEntries} setYearEntries={setYearEntries} onNext={() => setStep("preflight")} onBack={() => setStep("profile")} demoMode={demoMode} />}
            {step === "preflight" && <PreflightScreen yearEntries={yearEntries} setYearEntries={setYearEntries} onNext={() => setStep("commute")} onBack={() => setStep("years")} />}
            {step === "commute" && <CommuteScreen commute={commute} setCommute={setCommute} onNext={() => setStep("werbungskosten")} onBack={() => setStep("preflight")} />}
            {step === "werbungskosten" && <WerbungskostenScreen data={werbungskosten} setData={setWerbungskosten} selectedYears={yearEntries.filter(e => e.selected).map(e => e.year)} onNext={() => setStep("review")} onBack={() => setStep("commute")} />}
            {step === "review" && <ReviewScreen profile={profile} yearEntries={yearEntries} commute={commute} werbungskosten={werbungskosten} onGenerate={() => setShowPaywall(true)} onBack={() => setStep("werbungskosten")} />}
            {step === "complete" && <CompleteScreen yearEntries={yearEntries} commute={commute} profile={profile} werbungskosten={werbungskosten} />}
          </div>
        )}
      </div>

      {/* Stripe paywall modal — rendered above everything */}
      {showPaywall && (
        <PaywallModal
          plan={planKey}
          email={profile.email}
          onSuccess={handlePaySuccess}
          onClose={() => setShowPaywall(false)}
        />
      )}

      {/* Admin demo trigger — bottom-left corner */}
      <button
        onClick={() => runDemo(setStep, setProfile as (fn: (p: Profile) => Profile) => void, setYearEntries, setCommute, setWerbungskosten, setDemoMode)}
        className="fixed bottom-3 left-3 z-50 text-green-950 hover:text-green-800 text-xs font-mono transition-colors select-none"
        style={{ fontFamily:"'Share Tech Mono',monospace" }}
        title="Demo mode"
      >
        admin
      </button>
    </div>
  )
}
