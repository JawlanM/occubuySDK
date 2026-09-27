import { FastLinkFlowState, hasSuccessSite, latestSuccessSite, parseFastLinkMessage } from "./fastlink/fastlink-events.js";
import { buildFastLinkForm, fastLinkOrigin } from "./fastlink/fastlink-form.js";
import { loadYodleeInitializeJs } from "./fastlink/fastlink-embed.js";
import type { FastLinkSession, FastLinkSuccessPayload } from "./fastlink/models.js";

export type OccubuyEnvironment = "sandbox" | "production";

export interface OccubuyScoreResult {
  status: "success";
  score: number;
  band: "Excellent" | "Very Good" | "Good" | "Fair" | "Poor";
  verifiedAt: string;
  /** scoreId, handed back by /share as a confirmation reference - see US D1.3 */
  reference: string;
}

export interface OccubuyCancelResult {
  status: "cancelled";
}

export interface OccubuyDeclineResult {
  status: "declined";
}

export type OccubuyErrorCode =
  | "INVALID_APPLICANT"
  | "START_FAILED"
  | "ORIGIN_NOT_ALLOWED"
  | "PARTNER_KEY_INVALID"
  | "BANK_CONNECTION_FAILED"
  | "POLL_FAILED"
  | "POLL_TIMEOUT"
  | "SHARE_FAILED";

export interface OccubuyErrorResult {
  code: OccubuyErrorCode;
  message: string;
}

/** comes from whatever form the partner already had the renter fill out - no login on our side */
export interface OccubuyApplicant {
  fullName: string;
  email: string;
  phone: string;
  /** ISO date, e.g. "1998-04-12" - has to make them 18+ */
  dob: string;
  address: string;
}

/** Per-partner colours, applied only to this init() instance - no partner portal to source these from yet, so pass them directly. */
export interface OccubuyBranding {
  /** Accent colour for buttons, the brand dot, checkboxes etc. Defaults to Occubuy coral. Button text
   * switches between dark and white to stay readable on it. */
  primaryColor?: string;
  /** Hover/pressed shade for primaryColor. Defaults to a darker coral if omitted. */
  primaryColorDark?: string;
  /** Colour for headings and the score number. Defaults to Occubuy's near-black ink. */
  headingColor?: string;
}

/**
 * Starting display settings. The renter can change each one with the buttons in the widget's
 * header, and their choice is remembered on their device (it wins over these defaults).
 */
export interface OccubuyAccessibility {
  /** Bigger text throughout. Default false. */
  largeText?: boolean;
  /** "light" (default), "dark", or "auto" to follow the renter's device setting. */
  theme?: "light" | "dark" | "auto";
  /** Stronger text and borders. Default: on when the renter's device asks for more contrast. */
  highContrast?: boolean;
  /** Show the three display buttons in the widget's header. Default true. */
  showControls?: boolean;
}

export interface OccubuyInitConfig {
  apiKey: string;
  /** Where to render the widget, either a CSS selector like "#occubuy-widget" or the actual element. */
  container: string | HTMLElement;
  applicant: OccubuyApplicant;
  /** Optional colour overrides - see OccubuyBranding. Everything else about the layout is fixed. */
  branding?: OccubuyBranding;
  /** Larger text, dark mode and high contrast defaults - see OccubuyAccessibility. */
  accessibility?: OccubuyAccessibility;
  /**
   * Where the backend lives. The hosted script (sdk/v1/occubuy-sdk.js) already defaults to the
   * deployed backend, so partners leave this out. The dist/ builds default to localhost:8787
   * for local dev.
   */
  apiBase?: string;
  environment?: OccubuyEnvironment;
  onComplete?: (result: OccubuyScoreResult) => void;
  onCancel?: (result: OccubuyCancelResult) => void;
  /** Fires if the customer sees their score but decides not to share it with the partner. */
  onDecline?: (result: OccubuyDeclineResult) => void;
  /** Fires whenever the widget hits an unrecoverable error, alongside showing its own error screen. */
  onError?: (error: OccubuyErrorResult) => void;
}

export interface OccubuyScoreInstance {
  start: () => void;
}

type ResolvedConfig = OccubuyInitConfig & {
  environment: OccubuyEnvironment;
  onComplete: (result: OccubuyScoreResult) => void;
  onCancel: (result: OccubuyCancelResult) => void;
  onDecline: (result: OccubuyDeclineResult) => void;
  onError: (error: OccubuyErrorResult) => void;
};

// Baked in at build time for the hosted script partners embed (see tsup.config.ts), so their
// snippet doesn't need apiBase. Every other build (dist/, tests) falls back to local dev.
// One origin serves both the score API and the fake FastLink page.
declare const __OCCUBUY_DEFAULT_API_BASE__: string | undefined;
const DEFAULT_API_BASE =
  typeof __OCCUBUY_DEFAULT_API_BASE__ === "string" ? __OCCUBUY_DEFAULT_API_BASE__ : "http://localhost:8787";
const SESSION_HEADER = "X-Occubuy-Session";

// OccubuyBranding field -> the CSS variable the widget's styles read
const BRANDING_CSS_VARS: Array<[keyof OccubuyBranding, string]> = [
  ["primaryColor", "--occubuy-accent"],
  ["primaryColorDark", "--occubuy-accent-dark"],
  ["headingColor", "--occubuy-heading"],
];
// portal colours are checked again here since they end up as CSS on the partner's page
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// Sets one branding colour on the container. For the accent it also picks the button text
// colour: the design's dark ink on light accents (like the default coral), white on dark ones.
function applyBrandColour(el: HTMLElement, cssVar: string, colour: string): void {
  el.style.setProperty(cssVar, colour);
  if (cssVar !== "--occubuy-accent" || !HEX_COLOUR.test(colour)) return;
  const hex = colour.length === 4 ? colour.replace(/[0-9a-f]/gi, "$&$&") : colour;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // contrast vs white (L=1) against contrast vs the ink #1F1719 (L~0.0095)
  el.style.setProperty("--occubuy-on-accent", 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.0595 ? "#fff" : "#1F1719");
}

const MAX_POLL_ATTEMPTS = 40; // about 60 seconds at 1.5s each, just so it can't poll forever if something's stuck
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ERRORS = 3; // network blips in a row before giving up; each one waits longer

// The partner portal's five band names, 200-point steps (decided 26 Sep). The backend's
// utils/band.ts uses the same cutoffs, so the widget, onComplete, GET /scores/:id and the portal
// all agree. Change both together.
function scoreToBand(score: number): OccubuyScoreResult["band"] {
  if (score >= 800) return "Excellent";
  if (score >= 600) return "Very Good";
  if (score >= 400) return "Good";
  if (score >= 200) return "Fair";
  return "Poor";
}

// Mirrors backend/src/utils/validators.ts so bad input fails fast client-side; backend
// still re-checks everything.
const AU_MOBILE = /^(?:\+?61|0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateApplicant(applicant: OccubuyApplicant | undefined): string | null {
  if (!applicant) return "Applicant details are required.";
  if (!applicant.fullName || applicant.fullName.trim().length < 2 || applicant.fullName.trim().length > 100) {
    return "Full name must be 2-100 characters.";
  }
  if (!applicant.email || !EMAIL_PATTERN.test(applicant.email.trim())) {
    return "Enter a valid email address.";
  }
  if (!applicant.phone || !AU_MOBILE.test(applicant.phone.trim())) {
    return "Enter a valid Australian mobile number, e.g. 04XX XXX XXX.";
  }
  if (!applicant.dob || Number.isNaN(new Date(applicant.dob).getTime())) {
    return "Enter a valid date of birth.";
  }
  const dobDate = new Date(applicant.dob);
  const now = new Date();
  if (dobDate.getTime() > now.getTime()) return "Date of birth cannot be in the future.";
  let age = now.getUTCFullYear() - dobDate.getUTCFullYear();
  const hadBirthdayThisYear =
    now.getUTCMonth() > dobDate.getUTCMonth() ||
    (now.getUTCMonth() === dobDate.getUTCMonth() && now.getUTCDate() >= dobDate.getUTCDate());
  if (!hadBirthdayThisYear) age -= 1;
  if (age < 18) return "You must be 18 or older to use Occubuy Score.";
  if (!applicant.address || applicant.address.trim().length < 5 || applicant.address.trim().length > 200) {
    return "Address must be 5-200 characters.";
  }
  return null;
}

// Separate from the "how it's calculated" copy in successTemplate - improvement advice
// must vary by band, not be one generic sentence.
function improvementCopy(band: OccubuyScoreResult["band"]): string {
  switch (band) {
    case "Poor":
      return "Build a longer history of on-time payments and steady income landing in this account. Even a few more months of consistent activity moves this the most.";
    case "Fair":
      return "Get regular income paid into this account and keep bills paid on time. A few steady months here is what lifts this into Good.";
    case "Good":
      return "Keep income arriving on a predictable schedule and pay down existing debt where you can. Consistency over the next few months is what pushes this into Very Good.";
    case "Very Good":
      return "You're close to the top band. Keep income steady, avoid missed payments and hold off on large new debts to reach Excellent.";
    case "Excellent":
      return "This is already an excellent score. Keep income steady and avoid large new debts to hold it here.";
  }
}

/**
 * Accepts the `fastlinkUrl` / `fastLinkUrl` / `url` aliases, so a minor backend
 * field-naming difference doesn't silently break the widget.
 */
function normalizeFastLinkSession(raw: unknown): FastLinkSession | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const url = record.fastlinkUrl ?? record.fastLinkUrl ?? record.url;
  if (typeof url !== "string" || url.length === 0) return null;
  if (typeof record.accessToken !== "string" || record.accessToken.length === 0) return null;

  return {
    fastlinkUrl: url,
    accessToken: record.accessToken,
    configName: typeof record.configName === "string" ? record.configName : undefined,
    extraParams:
      typeof record.extraParams === "object" && record.extraParams !== null
        ? (record.extraParams as Record<string, string>)
        : undefined,
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : undefined,
    transport: record.transport === "yodleeJs" ? "yodleeJs" : "postMessage",
  };
}

// Widget styles, injected once. Every class is "occubuy-"-prefixed to avoid clashing
// with the partner's own page styles.
const STYLE_ID = "occubuy-style";
const A11Y_KEY = "occubuy-a11y";
const FONT_LINK_ID = "occubuy-font-link";

const WIDGET_CSS = `
.occubuy-container {
  --ob-acc: var(--occubuy-accent, #F87954); --ob-acc2: var(--occubuy-accent-dark, #E86A46);
  --ob-on: var(--occubuy-on-accent, #1F1719); --ob-head: var(--occubuy-heading, #1F1719);
  --ob-ink: #1F1719; --ob-body: #6C5359; --ob-muted: #7D656C;
  --ob-line: #EBDBDA; --ob-line2: #D6C2C5; --ob-sunk: #F7EBE7; --ob-bg: #FEF6F0; --ob-card: #fff; --ob-bad: #A3271F;
  --ob-s: 1; --ob-ease: cubic-bezier(.2,0,0,1); --ob-disp: "Outfit", ui-sans-serif, system-ui, sans-serif;
  font: 400 calc(14px*var(--ob-s))/1.6 "Sora", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ob-body); background: var(--ob-bg); border: 1px solid var(--ob-line); border-radius: 16px;
  padding: 20px; max-width: 420px; box-sizing: border-box;
  box-shadow: 0 1px 2px rgba(31,23,25,.06), 0 12px 28px -18px rgba(31,23,25,.4);
}
.occubuy-container * { box-sizing: border-box; }
.occubuy-brand { display: flex; align-items: center; gap: 8px; font: 600 calc(11px*var(--ob-s))/1.4 var(--ob-disp); letter-spacing: .14em; text-transform: uppercase; color: var(--ob-muted); margin-bottom: 16px; }
.occubuy-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ob-acc); flex-shrink: 0; }
.occubuy-heading { font: 600 calc(20px*var(--ob-s))/1.3 var(--ob-disp); letter-spacing: -.01em; color: var(--ob-head); margin: 0 0 8px; }
.occubuy-sub { color: var(--ob-body); margin: 0 0 20px; }
@keyframes occubuy-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.occubuy-fade-in { animation: occubuy-fade-in 200ms var(--ob-ease); }
.occubuy-consent { display: flex; gap: 12px; align-items: flex-start; background: var(--ob-sunk); border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; }
.occubuy-consent input { margin: 2px 0 0; width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--ob-acc); cursor: pointer; }
.occubuy-consent label { font-size: calc(13px*var(--ob-s)); color: var(--ob-ink); line-height: 1.6; cursor: pointer; }
.occubuy-btn {
  width: 100%; min-height: 48px; padding: 12px 16px; border: 1px solid transparent; border-radius: 12px;
  font: 600 calc(14.5px*var(--ob-s))/1 var(--ob-disp); cursor: pointer; color: var(--ob-on); background: var(--ob-acc);
  transition: background-color 200ms var(--ob-ease), transform 120ms var(--ob-ease);
}
.occubuy-btn:hover:not(:disabled) { background: var(--ob-acc2); }
.occubuy-btn:active:not(:disabled) { transform: scale(.98); }
.occubuy-btn:focus-visible { outline: 2px solid var(--ob-acc); outline-offset: 2px; }
.occubuy-btn:disabled { opacity: .38; cursor: not-allowed; }
.occubuy-btn-secondary { background: transparent; color: var(--ob-ink); border-color: var(--ob-line2); margin-top: 8px; }
.occubuy-btn-secondary:hover:not(:disabled) { background: var(--ob-sunk); }
.occubuy-iframe-wrap { border: 1px solid var(--ob-line); border-radius: 12px; overflow: hidden; margin-bottom: 16px; background: #fff; }
.occubuy-iframe-wrap iframe { width: 100%; height: 220px; border: none; display: block; }
.occubuy-spinner-wrap { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 40px 0; }
.occubuy-spinner { width: 32px; height: 32px; border-radius: 50%; border: 3px solid var(--ob-line); border-top-color: var(--ob-acc); animation: occubuy-spin .8s linear infinite; }
@keyframes occubuy-spin { to { transform: rotate(360deg); } }
.occubuy-spinner-text { font-size: calc(13px*var(--ob-s)); color: var(--ob-body); text-align: center; }
.occubuy-success { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 20px; }
.occubuy-check { width: 48px; height: 48px; border-radius: 50%; background: color-mix(in srgb, var(--ob-acc) 16%, var(--ob-card)); color: var(--ob-ink); display: flex; align-items: center; justify-content: center; font: 600 calc(22px*var(--ob-s))/1 var(--ob-disp); margin-bottom: 12px; }
.occubuy-score-label { font: 600 calc(11px*var(--ob-s))/1.4 var(--ob-disp); letter-spacing: .14em; text-transform: uppercase; color: var(--ob-body); margin: 0; }
.occubuy-score-value { font: 700 calc(40px*var(--ob-s))/1.05 var(--ob-disp); letter-spacing: -.03em; font-variant-numeric: tabular-nums; color: var(--ob-head); margin: 8px 0 12px; }
.occubuy-score-band { display: inline-block; font: 600 calc(12.5px*var(--ob-s))/1.2 var(--ob-disp); color: var(--ob-ink); border: 1px solid var(--ob-line2); padding: 6px 12px; border-radius: 8px; }
.occubuy-improve { background: var(--ob-sunk); border-radius: 12px; padding: 12px 16px; margin-bottom: 20px; }
.occubuy-improve-label { font: 600 calc(11px*var(--ob-s))/1.4 var(--ob-disp); letter-spacing: .14em; text-transform: uppercase; color: var(--ob-muted); margin-bottom: 4px; }
.occubuy-improve-text { font-size: calc(13px*var(--ob-s)); color: var(--ob-body); margin: 0; }
.occubuy-error { border: 1px solid var(--ob-bad); color: var(--ob-bad); background: var(--ob-card); border-radius: 12px; padding: 12px 16px; font-size: calc(13px*var(--ob-s)); margin-bottom: 16px; }
.occubuy-card { background: var(--ob-card); border: 1px solid var(--ob-line); border-radius: 16px; padding: 20px; margin-bottom: 16px; }
.occubuy-card-title { font: 600 calc(16px*var(--ob-s))/1.35 var(--ob-disp); color: var(--ob-head); margin: 0 0 4px; }
.occubuy-card-sub { font-size: calc(13px*var(--ob-s)); color: var(--ob-body); margin: 0 0 16px; }
.occubuy-steps { list-style: none; margin: 0 0 20px; padding: 0; }
.occubuy-step { display: flex; align-items: flex-start; gap: 12px; padding-bottom: 16px; }
.occubuy-step:last-child { padding-bottom: 0; }
.occubuy-step-dot { width: 8px; height: 8px; margin-top: 7px; border-radius: 50%; background: var(--ob-acc); flex-shrink: 0; position: relative; }
.occubuy-step:not(:last-child) .occubuy-step-dot::after { content: ""; position: absolute; top: 8px; left: 3px; width: 2px; height: 22px; background: var(--ob-line); }
.occubuy-step-text { font-size: calc(14px*var(--ob-s)); color: var(--ob-ink); line-height: 1.5; }
.occubuy-btn-icon { display: inline-block; margin-right: 8px; }
.occubuy-provider-row { text-align: center; font-size: calc(12px*var(--ob-s)); color: var(--ob-muted); margin-top: 12px; }
.occubuy-provider-badge { display: inline-flex; font: 600 calc(11px*var(--ob-s))/1.4 var(--ob-disp); color: var(--ob-ink); border: 1px solid var(--ob-line2); padding: 2px 8px; border-radius: 8px; margin-left: 6px; }
.occubuy-disclosure { display: flex; align-items: flex-start; gap: 8px; font-size: calc(12.5px*var(--ob-s)); color: var(--ob-body); line-height: 1.5; margin-top: 16px; }
.occubuy-disclosure-icon { flex-shrink: 0; }
.occubuy-footnote { font-size: calc(12px*var(--ob-s)); color: var(--ob-muted); text-align: center; margin: 0; }
@media (prefers-reduced-motion: reduce) { .occubuy-container * { animation: none !important; transition: none !important; } }
.occubuy-a11y { margin-left: auto; display: flex; gap: 4px; }
.occubuy-a11y button { min-width: 32px; height: 32px; padding: 0 6px; border: 1px solid var(--ob-line2); border-radius: 8px; background: transparent; color: var(--ob-ink); font: 600 13px/1 var(--ob-disp); letter-spacing: 0; cursor: pointer; }
.occubuy-a11y button[aria-pressed="true"] { background: var(--ob-ink); color: var(--ob-bg); border-color: var(--ob-ink); }
.occubuy-a11y button:focus-visible, .occubuy-consent input:focus-visible { outline: 2px solid var(--ob-acc); outline-offset: 2px; }
.occubuy-container [tabindex="-1"]:focus { outline: none; }
.occubuy-no-controls .occubuy-a11y { display: none; }
.occubuy-large .occubuy-container { --ob-s: 1.25; }
.occubuy-dark .occubuy-container {
  --ob-ink: #FEF6F0; --ob-head: #FEF6F0; --ob-body: #C9B5BA; --ob-muted: #A9929A; --ob-line: #3D2F33; --ob-line2: #4A393E;
  --ob-sunk: #302428; --ob-bg: #1A1416; --ob-card: #241C1E; --ob-bad: #FFB4A8; --ob-acc2: var(--occubuy-accent-dark, #FA8C6B);
  box-shadow: 0 1px 2px rgba(0,0,0,.5), 0 16px 40px -20px rgba(0,0,0,.9);
}
.occubuy-hc .occubuy-container { --ob-body: var(--ob-ink); --ob-muted: var(--ob-ink); --ob-line: var(--ob-ink); --ob-line2: var(--ob-ink); --ob-head: var(--ob-ink); }
.occubuy-hc .occubuy-btn { border-color: var(--ob-ink); }
.occubuy-hc .occubuy-btn:disabled { opacity: 1; background: var(--ob-card); color: var(--ob-ink); border-style: dashed; }
.occubuy-hc .occubuy-btn:focus-visible, .occubuy-hc .occubuy-a11y button:focus-visible { outline-width: 3px; }
`;

function injectStyles(): void {
  if (!document.getElementById(FONT_LINK_ID)) {
    const preconnect1 = document.createElement("link");
    preconnect1.rel = "preconnect";
    preconnect1.href = "https://fonts.googleapis.com";
    const preconnect2 = document.createElement("link");
    preconnect2.rel = "preconnect";
    preconnect2.href = "https://fonts.gstatic.com";
    preconnect2.crossOrigin = "anonymous";
    const fontLink = document.createElement("link");
    fontLink.id = FONT_LINK_ID;
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Outfit:wght@600;700&family=Sora:wght@400;600&display=swap";
    document.head.append(preconnect1, preconnect2, fontLink);
  }

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = WIDGET_CSS;
    document.head.appendChild(style);
  }
}

// Static HTML strings only - dynamic values (network/postMessage data) are set via
// textContent afterward, never interpolated.
function brandHeader(): string {
  return `<div class="occubuy-brand"><span class="occubuy-dot" aria-hidden="true"></span> Occubuy Score
    <span class="occubuy-a11y" role="group" aria-label="Display options">
      <button type="button" data-occubuy-a11y="l" aria-pressed="false" aria-label="Larger text" title="Larger text">A+</button>
      <button type="button" data-occubuy-a11y="d" aria-pressed="false" aria-label="Dark mode" title="Dark mode">&#9790;</button>
      <button type="button" data-occubuy-a11y="h" aria-pressed="false" aria-label="High contrast" title="High contrast">&#9680;</button>
    </span></div>`;
}

// Single screen per Nishad's 25 Aug direction (previously a 3-step panel flow) - all the
// access/privacy points collapsed into one well-laid-out list rather than split by page.
// Layout modelled on ConnectID's "Verify your identity" card (numbered-step list + single
// primary CTA + provider badge + short disclosure line) per the reference the user supplied
// 12 Sep, restyled with Occubuy's own palette/type instead of cloned 1:1 - the explicit
// consent checkbox stays (not in the reference) since it's the actual legal consent capture,
// not just a visual step.
function consentTemplate(): string {
  return `
    <div class="occubuy-container occubuy-fade-in" data-occubuy-step="consent">
      ${brandHeader()}
      <h2 class="occubuy-heading" tabindex="-1">Verify your rental score</h2>
      <p class="occubuy-sub">A strong Occubuy Score can help back up your application. It's calculated from your real bank transaction history, never a credit check.</p>

      <div class="occubuy-card">
        <div class="occubuy-card-title">Get started</div>
        <p class="occubuy-card-sub">Verify your income and spending through your own bank, in a few quick steps.</p>
        <ul class="occubuy-steps">
          <li class="occubuy-step"><span class="occubuy-step-dot" aria-hidden="true"></span><span class="occubuy-step-text">Select your bank</span></li>
          <li class="occubuy-step"><span class="occubuy-step-dot" aria-hidden="true"></span><span class="occubuy-step-text">Log in to your account</span></li>
          <li class="occubuy-step"><span class="occubuy-step-dot" aria-hidden="true"></span><span class="occubuy-step-text">Review your details and provide consent</span></li>
        </ul>

        <div class="occubuy-consent">
          <input type="checkbox" id="occubuy-consent-checkbox" data-occubuy-consent-checkbox />
          <label for="occubuy-consent-checkbox">I agree to share my details so Occubuy can verify my rental score with my bank.</label>
        </div>

        <button type="button" class="occubuy-btn" data-occubuy-consent-submit disabled>
          <span class="occubuy-btn-icon" aria-hidden="true">&#8635;</span>Verify with Occubuy Score
        </button>

        <div class="occubuy-provider-row">Secured by<span class="occubuy-provider-badge">Yodlee</span></div>

        <div class="occubuy-disclosure">
          <span class="occubuy-disclosure-icon" aria-hidden="true">&#9432;</span>
          <span>We never see your online banking login or password, and nothing in your account can be moved or changed.</span>
        </div>
      </div>

      <p class="occubuy-footnote">Takes about a minute. Your score stays private until you choose to share it with the partner, on the next screen.</p>
    </div>
  `;
}

function bankConnectionTemplate(): string {
  return `
    <div class="occubuy-container" data-occubuy-step="bankConnection">
      ${brandHeader()}
      <h2 class="occubuy-heading" tabindex="-1">Connect your bank</h2>
      <p class="occubuy-sub">Select the bank your income is paid into to continue.</p>
      <div class="occubuy-iframe-wrap" data-occubuy-fastlink-wrap>
        <iframe
          data-occubuy-fastlink-iframe
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerpolicy="no-referrer"
          title="Bank connection"
        ></iframe>
      </div>
      <button type="button" class="occubuy-btn occubuy-btn-secondary" data-occubuy-bank-cancel>Cancel</button>
    </div>
  `;
}

function pollingTemplate(): string {
  return `
    <div class="occubuy-container" data-occubuy-step="score">
      ${brandHeader()}
      <h2 class="occubuy-heading" tabindex="-1">Calculating your score</h2>
      <div class="occubuy-spinner-wrap">
        <div class="occubuy-spinner" aria-hidden="true"></div>
        <div class="occubuy-spinner-text" role="status">This usually takes a few seconds...</div>
      </div>
    </div>
  `;
}

function successTemplate(): string {
  return `
    <div class="occubuy-container" data-occubuy-step="score">
      ${brandHeader()}
      <div class="occubuy-success">
        <div class="occubuy-check" aria-hidden="true">&#10003;</div>
        <h2 class="occubuy-score-label" tabindex="-1">Your Occubuy Score</h2>
        <div class="occubuy-score-value" data-occubuy-score-value></div>
        <div class="occubuy-score-band" data-occubuy-score-band></div>
      </div>
      <p class="occubuy-sub occubuy-score-explainer">Calculated from your real income and spending patterns, not a credit check. This score is only visible to you until you choose to share it.</p>
      <div class="occubuy-improve">
        <div class="occubuy-improve-label">How to improve it</div>
        <p class="occubuy-improve-text" data-occubuy-improve-text></p>
      </div>
      <button type="button" class="occubuy-btn" data-occubuy-share>Share with Partner</button>
      <button type="button" class="occubuy-btn occubuy-btn-secondary" data-occubuy-decline>Don't share</button>
    </div>
  `;
}

function errorTemplate(): string {
  return `
    <div class="occubuy-container" data-occubuy-step="error">
      ${brandHeader()}
      <div class="occubuy-error" role="alert" tabindex="-1" data-occubuy-error-message></div>
      <button type="button" class="occubuy-btn" data-occubuy-error-retry hidden>Try again</button>
      <button type="button" class="occubuy-btn occubuy-btn-secondary" data-occubuy-error-dismiss>Close</button>
    </div>
  `;
}

function resolveContainer(container: string | HTMLElement): HTMLElement | null {
  if (typeof container === "string") {
    return document.querySelector<HTMLElement>(container);
  }
  return container;
}

// This is the actual public API
export function init(config: OccubuyInitConfig): OccubuyScoreInstance {
  if (!config?.apiKey) {
    throw new Error("[OccubuyScore] init() requires an apiKey.");
  }
  if (!config?.container) {
    throw new Error("[OccubuyScore] init() requires a container (CSS selector or HTMLElement).");
  }
  if (!config?.applicant) {
    throw new Error("[OccubuyScore] init() requires applicant (fullName, email, phone, dob, address).");
  }

  const resolved: ResolvedConfig = {
    environment: "sandbox",
    onComplete: () => {},
    onCancel: () => {},
    onDecline: () => {},
    onError: () => {},
    ...config,
  };

  let started = false;

  function start(): void {
    if (started) return;
    started = true;

    if (resolved.environment !== "sandbox") {
      throw new Error(
        '[OccubuyScore] Only the "sandbox" environment is currently supported (no production backend exists yet).'
      );
    }

    const maybeContainer = resolveContainer(resolved.container);
    if (!maybeContainer) {
      const label = typeof resolved.container === "string" ? `"${resolved.container}"` : "(element)";
      throw new Error(`[OccubuyScore] container ${label} was not found on the page.`);
    }
    const containerEl: HTMLElement = maybeContainer;
    const apiBase = resolved.apiBase ?? DEFAULT_API_BASE;

    injectStyles();
    if (!containerEl.hasAttribute("role")) containerEl.setAttribute("role", "region");
    if (!containerEl.hasAttribute("aria-label")) containerEl.setAttribute("aria-label", "Occubuy Score");

    // Display settings: the partner's defaults, then whatever this renter picked before on this
    // device. l = larger text, d = dark, h = high contrast.
    const a11y = resolved.accessibility ?? {};
    const prefersMedia = (query: string): boolean => {
      try {
        return window.matchMedia?.(query).matches ?? false;
      } catch {
        return false;
      }
    };
    const prefs: Record<"l" | "d" | "h", boolean> = {
      l: !!a11y.largeText,
      d: a11y.theme === "dark" || (a11y.theme === "auto" && prefersMedia("(prefers-color-scheme: dark)")),
      h: a11y.highContrast ?? prefersMedia("(prefers-contrast: more)"),
    };
    try {
      Object.assign(prefs, JSON.parse(localStorage.getItem(A11Y_KEY) ?? "{}"));
    } catch {
      /* defaults only */
    }
    containerEl.classList.toggle("occubuy-no-controls", a11y.showControls === false);
    function applyPrefs(): void {
      containerEl.classList.toggle("occubuy-large", prefs.l);
      containerEl.classList.toggle("occubuy-dark", prefs.d);
      containerEl.classList.toggle("occubuy-hc", prefs.h);
      containerEl.querySelectorAll<HTMLElement>("[data-occubuy-a11y]").forEach((button) => {
        button.setAttribute("aria-pressed", String(prefs[button.dataset.occubuyA11y as "l" | "d" | "h"]));
      });
    }
    containerEl.addEventListener("click", (event) => {
      const button = (event.target as Element | null)?.closest?.<HTMLElement>("[data-occubuy-a11y]");
      const key = button?.dataset.occubuyA11y as "l" | "d" | "h" | undefined;
      if (!key) return;
      prefs[key] = !prefs[key];
      try {
        localStorage.setItem(A11Y_KEY, JSON.stringify(prefs));
      } catch {
        /* works for this visit only */
      }
      applyPrefs();
    });

    // Every screen goes through here. After the first screen, focus moves to the new screen's
    // heading (or its error), so a screen reader announces where the renter is now. The first
    // screen never takes focus away from the partner's page.
    let firstScreen = true;
    function show(html: string): void {
      containerEl.innerHTML = html;
      applyPrefs();
      if (!firstScreen) containerEl.querySelector<HTMLElement>("h2, [role=alert]")?.focus();
      firstScreen = false;
    }

    // Sets custom properties on the container itself, not its innerHTML - survives every
    // later containerEl.innerHTML = ... swap between screens.
    for (const [field, cssVar] of BRANDING_CSS_VARS) {
      const colour = resolved.branding?.[field];
      if (colour) applyBrandColour(containerEl, cssVar, colour);
    }

    // Colours the partner set in the portal. Never waited on: the widget is already drawing with
    // its defaults, these get applied if and when they arrive. Colours passed to init() win.
    // Any failure (network, bad key, old backend, timeout) just leaves the defaults.
    fetch(`${apiBase}/partners/config`, {
      headers: { Authorization: `Bearer ${resolved.apiKey}` },
      ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? { signal: AbortSignal.timeout(3000) }
        : {}),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ branding?: Record<string, unknown> }>) : null))
      .then((config) => {
        if (!config?.branding || cancelled) return;
        for (const [field, cssVar] of BRANDING_CSS_VARS) {
          const colour = config.branding[field];
          if (!resolved.branding?.[field] && typeof colour === "string" && HEX_COLOUR.test(colour)) {
            applyBrandColour(containerEl, cssVar, colour);
          }
        }
      })
      .catch(() => {
        /* keep the default colours */
      });

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let pollAttempts = 0;
    let messageListener: ((event: MessageEvent) => void) | undefined;
    // handed back by POST /scores, has to ride along on every call after that for this scoreId
    let sessionToken: string | undefined;

    function authHeaders(extra?: Record<string, string>): Record<string, string> {
      const headers: Record<string, string> = { Authorization: `Bearer ${resolved.apiKey}` };
      if (sessionToken) headers[SESSION_HEADER] = sessionToken;
      return { ...headers, ...extra };
    }

    let fastlinkOpen = false;
    // onComplete / onCancel / onDecline end the flow: only the first one ever fires
    let finished = false;

    // Resume after a refresh (or the page reloading when a bank sends the renter back): once a
    // score exists, its id and session token are kept in sessionStorage for this tab only, and
    // cleared when the flow ends. Storage can be blocked, so every access is guarded.
    const flowKey = `occubuy-flow:${resolved.apiKey.slice(-12)}`;
    function saveFlow(scoreId: string): void {
      try {
        sessionStorage.setItem(flowKey, JSON.stringify({ scoreId, sessionToken, at: Date.now() }));
      } catch {
        /* no resume, the flow still works */
      }
    }
    function clearFlow(): void {
      try {
        sessionStorage.removeItem(flowKey);
      } catch {
        /* nothing stored */
      }
    }
    function savedFlow(): { scoreId: string; sessionToken: string } | null {
      try {
        const saved = JSON.parse(sessionStorage.getItem(flowKey) ?? "null");
        // the session token lives an hour; don't try one that's about to expire
        if (saved?.scoreId && saved.sessionToken && Date.now() - saved.at < 50 * 60 * 1000) return saved;
      } catch {
        /* fall through */
      }
      return null;
    }

    function cleanup(): void {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (messageListener) window.removeEventListener("message", messageListener);
      if (fastlinkOpen) {
        fastlinkOpen = false;
        try {
          window.fastlink?.close();
        } catch {
          /* already gone */
        }
      }
    }

    function end(callback: () => void): void {
      cleanup();
      clearFlow();
      if (finished) return;
      finished = true;
      callback();
    }

    function cancel(): void {
      end(() => resolved.onCancel({ status: "cancelled" }));
    }

    // retry: where "Try again" goes back to. Left out for problems a retry can't fix.
    function fail(code: OccubuyErrorCode, message: string, retry?: () => void): void {
      cleanup();
      show(errorTemplate());
      const messageEl = containerEl.querySelector("[data-occubuy-error-message]");
      const retryBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-error-retry]");
      const dismissBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-error-dismiss]");
      if (messageEl) messageEl.textContent = message;
      if (retry && retryBtn) {
        retryBtn.hidden = false;
        retryBtn.addEventListener("click", () => {
          cancelled = false;
          pollAttempts = 0;
          retry();
        });
      }
      dismissBtn?.addEventListener("click", cancel);
      resolved.onError({ code, message });
    }

    function renderConsent(): void {
      show(consentTemplate());

      const checkbox = containerEl.querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]");
      const submitBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-consent-submit]");
      if (!checkbox || !submitBtn) return;

      checkbox.addEventListener("change", () => {
        submitBtn.disabled = !checkbox.checked;
      });

      submitBtn.addEventListener("click", () => {
        if (!checkbox.checked) return;

        const validationError = validateApplicant(resolved.applicant);
        if (validationError) {
          fail("INVALID_APPLICANT", validationError);
          return;
        }

        submitBtn.disabled = true;

        fetch(`${apiBase}/api/scores`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ userId: crypto.randomUUID(), applicant: resolved.applicant }),
        })
          .then(async (res) => {
            if (!res.ok) {
              // setup problems on the partner's side get their own code, and the reason goes to
              // the console for the partner's developer; the renter just sees it isn't available
              const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
              if (body.code === "ORIGIN_NOT_ALLOWED" || body.code === "PARTNER_KEY_INVALID") {
                console.warn(`[Occubuy] ${body.message ?? body.code}`);
                throw body.code;
              }
              throw new Error(`HTTP ${res.status}`);
            }
            return res.json() as Promise<{ scoreId?: string; sessionToken?: string; fastlinkSession?: unknown }>;
          })
          .then((data) => {
            if (cancelled) return;
            if (!data.scoreId || !data.sessionToken) throw new Error("Malformed response");
            const session = normalizeFastLinkSession(data.fastlinkSession);
            if (!session) throw new Error("Malformed FastLink session");
            sessionToken = data.sessionToken;
            renderBankConnection(data.scoreId, session);
          })
          .catch((err) => {
            if (cancelled) return;
            if (err === "ORIGIN_NOT_ALLOWED" || err === "PARTNER_KEY_INVALID") {
              fail(err, "Verification isn't available on this website right now.");
            } else {
              fail("START_FAILED", "We couldn't start your verification. Please try again.", renderConsent);
            }
          });
      });
    }

    // Launches real Yodlee FastLink 4's actual protocol (see src/fastlink/) against
    // whichever provider the backend's fastlinkSession points at - a mock today, a real
    // provider later, without this function changing. FastLink is a form-POST target,
    // not a URL, and its success/exit events can arrive in either order - both handled
    // by buildFastLinkForm/parseFastLinkMessage/FastLinkFlowState rather than reimplemented here.
    function renderBankConnection(scoreId: string, session: FastLinkSession): void {
      show(bankConnectionTemplate());
      const cancelBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-bank-cancel]");
      if (!cancelBtn) return;
      cancelBtn.addEventListener("click", cancel);

      if (session.transport === "yodleeJs") {
        renderBankConnectionViaYodleeJs(scoreId, session);
      } else {
        renderBankConnectionViaPostMessage(scoreId, session);
      }
    }

    // Real Yodlee tenants' edge security (Imperva) blocks the hand-built form POST
    // below with "Error 15" - verified 8-9 Sep 2026 against a real sandbox account,
    // referrer policy and configName both ruled out as the cause, while Yodlee's own
    // official launch path (initialize.js + window.fastlink.open()) works on the
    // identical credentials. The backend sets fastlinkSession.transport accordingly -
    // see FastLinkTransport's doc comment in fastlink/models.ts for the full story.
    function renderBankConnectionViaYodleeJs(scoreId: string, session: FastLinkSession): void {
      const wrap = containerEl.querySelector<HTMLElement>("[data-occubuy-fastlink-wrap]");
      const iframe = containerEl.querySelector<HTMLIFrameElement>("[data-occubuy-fastlink-iframe]");
      if (!wrap) return;
      // window.fastlink.open() builds its own iframe inside the container - the
      // pre-built one is only for the postMessage transport.
      iframe?.remove();

      const flowState = new FastLinkFlowState();
      let pendingPayload: FastLinkSuccessPayload | undefined;
      let settled = false;

      function finish(): void {
        if (settled) return;
        settled = true;
        if (pendingPayload) completeBankConnection(scoreId, pendingPayload);
      }

      function handle(data: Record<string, unknown>, isExit: boolean): void {
        if (settled || cancelled) return;

        const success = latestSuccessSite(data);
        if (success) {
          pendingPayload = success;
          if (flowState.onSuccess().finish) finish();
        }

        if (isExit) {
          const decision = flowState.onExit(hasSuccessSite(data) || pendingPayload !== undefined);
          if (decision.finish) finish();
          else if (decision.cancel) {
            settled = true;
            cancel();
          }
        }
      }

      loadYodleeInitializeJs()
        .then((fastlink) => {
          if (cancelled) return;
          fastlinkOpen = true;
          fastlink.open(
            {
              fastLinkURL: session.fastlinkUrl,
              accessToken: session.accessToken,
              forceIframe: true,
              params: {
                ...(session.configName ? { configName: session.configName } : {}),
                ...session.extraParams,
              },
              onSuccess: (data) => handle(data, false),
              onError: (data) => handle(data, true),
              onClose: (data) => handle(data, true),
              onEvent: (data) => handle(data, false),
            },
            wrap.id || (wrap.id = "occubuy-fastlink-container")
          );
        })
        .catch(() => {
          if (!cancelled) {
            fail("BANK_CONNECTION_FAILED", "We couldn't load the bank connection tool. Please try again.", () =>
              renderBankConnection(scoreId, session)
            );
          }
        });
    }

    function renderBankConnectionViaPostMessage(scoreId: string, session: FastLinkSession): void {
      const iframe = containerEl.querySelector<HTMLIFrameElement>("[data-occubuy-fastlink-iframe]");
      if (!iframe) return;

      const expectedOrigin = fastLinkOrigin(session.fastlinkUrl);
      const flowState = new FastLinkFlowState();
      let pendingPayload: FastLinkSuccessPayload | undefined;

      function finish(): void {
        if (messageListener) window.removeEventListener("message", messageListener);
        if (pendingPayload) completeBankConnection(scoreId, pendingPayload);
      }

      messageListener = (event: MessageEvent) => {
        // Validates both origin and source - never trust postMessage without confirming
        // the sender is this exact iframe on this exact provider's origin.
        if (expectedOrigin !== undefined && event.origin !== expectedOrigin) return;
        if (event.source !== iframe.contentWindow) return;

        const parsed = parseFastLinkMessage(typeof event.data === "string" ? event.data : (event.data as object));

        // Success can ride on any message type, so this runs before the type switch below.
        const success = latestSuccessSite(parsed.data);
        if (success) {
          pendingPayload = success;
          if (flowState.onSuccess().finish) finish();
        }

        if (parsed.type === "POST_MESSAGE" && parsed.action === "exit") {
          const decision = flowState.onExit(hasSuccessSite(parsed.data) || pendingPayload !== undefined);
          if (decision.finish) finish();
          else if (decision.cancel) cancel();
        }
      };
      window.addEventListener("message", messageListener);

      // FastLink is a POST target, not a URL - buildFastLinkForm renders the
      // self-submitting form (accessToken + extraParams) directly into the iframe.
      iframe.srcdoc = buildFastLinkForm(session, window.location.href);
    }

    function completeBankConnection(scoreId: string, providerData: FastLinkSuccessPayload): void {
      fetch(`${apiBase}/api/scores/${encodeURIComponent(scoreId)}/complete`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          providerId: providerData.providerId,
          providerAccountId: providerData.providerAccountId,
          requestId: providerData.requestId,
          providerName: providerData.providerName,
          status: "SUCCESS",
          additionalStatus: providerData.additionalStatus,
        }),
      })
        .then(async (res) => {
          // 409: this score was already completed (a retry after a lost reply), so just read it
          if (res.status === 409) {
            saveFlow(scoreId);
            if (!cancelled) renderScorePolling(scoreId);
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          saveFlow(scoreId);
          // the backend scores during /complete and sends it back; poll only if it didn't
          const data = (await res.json().catch(() => ({}))) as { status?: string; score?: { value?: number } };
          if (cancelled) return;
          const value = data.score?.value;
          if (data.status === "COMPLETED" && typeof value === "number" && Number.isFinite(value)) {
            renderSuccess(scoreId, value);
          } else {
            renderScorePolling(scoreId);
          }
        })
        .catch(() => {
          if (!cancelled) {
            fail("BANK_CONNECTION_FAILED", "We couldn't confirm your bank connection. Please try again.", () => {
              show(pollingTemplate());
              completeBankConnection(scoreId, providerData);
            });
          }
        });
    }

    function renderScorePolling(scoreId: string): void {
      show(pollingTemplate());
      poll(scoreId);
    }

    function poll(scoreId: string, errorsInRow = 0): void {
      if (cancelled) return;
      pollAttempts += 1;
      if (pollAttempts > MAX_POLL_ATTEMPTS) {
        fail("POLL_TIMEOUT", "Verification is taking longer than expected. Please try again.", () => renderScorePolling(scoreId));
        return;
      }

      fetch(`${apiBase}/api/scores/${encodeURIComponent(scoreId)}`, {
        headers: authHeaders(),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ status?: string; score?: { value?: number }; retryAfter?: number }>;
        })
        .then((data) => {
          if (cancelled) return;
          const value = data.score?.value;
          if (data.status === "COMPLETED" && typeof value === "number" && Number.isFinite(value)) {
            renderSuccess(scoreId, value);
          } else {
            // the backend says how long to wait (seconds); never faster than our own interval
            const wait = Math.max(POLL_INTERVAL_MS, (Number(data.retryAfter) || 0) * 1000);
            pollTimer = setTimeout(() => poll(scoreId), wait);
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (errorsInRow + 1 >= MAX_POLL_ERRORS) {
            fail("POLL_FAILED", "We couldn't check your verification status. Please try again.", () =>
              renderScorePolling(scoreId)
            );
            return;
          }
          pollTimer = setTimeout(() => poll(scoreId, errorsInRow + 1), POLL_INTERVAL_MS * 2 ** (errorsInRow + 1));
        });
    }

    // score/band here is the customer's own preview from polling - onComplete must only
    // ever fire with POST .../share's response, never this closed-over roundedScore.
    function renderSuccess(scoreId: string, score: number): void {
      const roundedScore = Math.round(score);
      const band = scoreToBand(roundedScore);
      const verifiedAt = new Date().toISOString();
      let settled = false;

      show(successTemplate());
      const scoreValueEl = containerEl.querySelector("[data-occubuy-score-value]");
      const scoreBandEl = containerEl.querySelector("[data-occubuy-score-band]");
      const improveTextEl = containerEl.querySelector("[data-occubuy-improve-text]");
      const shareBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-share]");
      const declineBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-decline]");

      if (scoreValueEl) scoreValueEl.textContent = String(roundedScore);
      if (scoreBandEl) scoreBandEl.textContent = band;
      if (improveTextEl) improveTextEl.textContent = improvementCopy(band);

      shareBtn?.addEventListener("click", () => {
        if (settled) return;
        settled = true;
        shareBtn.disabled = true;
        if (declineBtn) declineBtn.disabled = true;

        // Fires off this response, not the closed-over roundedScore (see renderSuccess).
        // Band comes from the shared score, same cutoffs as the backend's utils/band.ts.
        fetch(`${apiBase}/api/scores/${encodeURIComponent(scoreId)}/share`, {
          method: "POST",
          headers: authHeaders(),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<{ score?: number; verifiedAt?: string; reference?: string }>;
          })
          .then((shared) => {
            const sharedScore = typeof shared.score === "number" ? Math.round(shared.score) : roundedScore;
            end(() =>
              resolved.onComplete({
                status: "success",
                score: sharedScore,
                band: scoreToBand(sharedScore),
                verifiedAt: shared.verifiedAt ?? verifiedAt,
                reference: shared.reference ?? scoreId,
              })
            );
          })
          .catch(() => {
            fail("SHARE_FAILED", "We couldn't share your score with the partner. Please try again.", () =>
              renderSuccess(scoreId, roundedScore)
            );
          });
      });

      declineBtn?.addEventListener("click", () => {
        if (settled) return;
        settled = true;
        declineBtn.disabled = true;
        if (shareBtn) shareBtn.disabled = true;

        // Decline must never surface as an error to the customer (C1.5), so it always
        // proceeds locally even if this POST fails - failure is logged server-side, not
        // blocking here.
        fetch(`${apiBase}/api/scores/${encodeURIComponent(scoreId)}/decline`, {
          method: "POST",
          headers: authHeaders(),
        })
          .catch(() => {
            /* best-effort - decline still proceeds locally, see comment above */
          })
          .then(() => end(() => resolved.onDecline({ status: "declined" })));
      });
    }

    // Picks up a flow this tab already got a score for (a refresh, or the page reloading after a
    // bank sent the renter back). Anything unexpected just starts over from consent.
    function resume(saved: { scoreId: string; sessionToken: string }): void {
      sessionToken = saved.sessionToken;
      show(pollingTemplate());
      fetch(`${apiBase}/api/scores/${encodeURIComponent(saved.scoreId)}`, { headers: authHeaders() })
        .then((res) => (res.ok ? (res.json() as Promise<{ status?: string; score?: { value?: number } }>) : null))
        .then((data) => {
          if (cancelled) return;
          const value = data?.score?.value;
          if (data?.status === "COMPLETED" && typeof value === "number") renderSuccess(saved.scoreId, value);
          else if (data?.status === "PROCESSING") renderScorePolling(saved.scoreId);
          else throw new Error("can't resume");
        })
        .catch(() => {
          clearFlow();
          sessionToken = undefined;
          if (!cancelled) renderConsent();
        });
    }

    const saved = savedFlow();
    if (saved) resume(saved);
    else renderConsent();
  }

  return { start };
}

// Also stick this on window so the plain <script src> version works too
if (typeof window !== "undefined") {
  (window as unknown as { OccubuyScore: { init: typeof init } }).OccubuyScore = { init };
}
