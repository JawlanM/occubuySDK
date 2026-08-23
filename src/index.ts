export type OccubuyEnvironment = "sandbox" | "production";

export interface OccubuyScoreResult {
  status: "success";
  score: number;
  band: "strong" | "moderate" | "limited";
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

export interface OccubuyInitConfig {
  apiKey: string;
  /** Where to render the widget, either a CSS selector like "#occubuy-widget" or the actual element. */
  container: string | HTMLElement;
  applicant: OccubuyApplicant;
  /**
   * Where the backend actually lives - defaults to localhost:8787 for local dev. Set this
   * to the real deployed backend URL once it's up on cPanel, e.g. "https://api.occubuy.example".
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

// Local dev default; override via config.apiBase for a real backend. One origin serves
// both the score API and the fake FastLink page.
const DEFAULT_API_BASE = "http://localhost:8787";
const SESSION_HEADER = "X-Occubuy-Session";

const MAX_POLL_ATTEMPTS = 40; // about 60 seconds at 1.5s each, just so it can't poll forever if something's stuck

// TODO: check with Nishad what the real score band cutoffs should be, this is just a guess for now.
function scoreToBand(score: number): OccubuyScoreResult["band"] {
  if (score >= 700) return "strong";
  if (score >= 400) return "moderate";
  return "limited";
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
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
    case "limited":
      return "Build a longer history of on-time payments and steady income landing in this account - even a few more months of consistent activity moves this the most.";
    case "moderate":
      return "Keep income arriving on a predictable schedule and pay down existing debt where you can - consistency over the next few months is what pushes this into Strong.";
    case "strong":
      return "This is already a strong score - keep income steady and avoid large new debts to hold it here.";
  }
}

interface FastLinkMessage {
  type: "FastLink";
  event: string;
  data?: Record<string, unknown>;
}

function isFastLinkMessage(value: unknown): value is FastLinkMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.type === "FastLink" && typeof record.event === "string";
}

// Widget styles, injected once. Every class is "occubuy-"-prefixed to avoid clashing
// with the partner's own page styles.
const STYLE_ID = "occubuy-style";
const FONT_LINK_ID = "occubuy-font-link";

const WIDGET_CSS = `
.occubuy-container {
  font-family: "Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: #faf8f3;
  border-radius: 16px;
  padding: 28px;
  max-width: 420px;
  box-shadow: 0 1px 2px rgba(35,32,27,0.06), 0 12px 28px rgba(35,32,27,0.08);
  box-sizing: border-box;
}
.occubuy-container * { box-sizing: border-box; }
.occubuy-brand { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: #4a2c85; margin-bottom: 16px; }
.occubuy-dot { width: 8px; height: 8px; border-radius: 50%; background: #f4855c; flex-shrink: 0; }
.occubuy-heading { font-weight: 700; font-size: 20px; color: #35205e; margin: 0 0 8px; line-height: 1.3; }
.occubuy-sub { font-weight: 400; font-size: 13.5px; color: #8a8272; margin: 0 0 20px; line-height: 1.55; }
.occubuy-steps { display: flex; gap: 6px; margin-bottom: 18px; }
.occubuy-step-dot { width: 6px; height: 6px; border-radius: 3px; background: #e7e0d0; transition: width 0.2s ease, background 0.2s ease; }
.occubuy-step-dot-active { width: 20px; background: #f4855c; }
.occubuy-panel[hidden] { display: none; }
@keyframes occubuy-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.occubuy-fade-in { animation: occubuy-fade-in 0.25s ease; }
.occubuy-access-list { margin: 0 0 20px; padding: 0 0 0 18px; font-size: 13px; color: #4a2c85; line-height: 1.6; }
.occubuy-access-list li { margin-bottom: 6px; }
.occubuy-consent {
  display: flex; gap: 10px; align-items: flex-start;
  background: #fff; border: 1px solid #e7e0d0; border-radius: 10px;
  padding: 14px 16px; margin-bottom: 20px;
}
.occubuy-consent input { margin-top: 3px; width: 16px; height: 16px; flex-shrink: 0; accent-color: #f4855c; }
.occubuy-consent label { font-size: 13px; color: #4a2c85; line-height: 1.55; cursor: pointer; }
.occubuy-btn {
  width: 100%; padding: 14px; border: none; border-radius: 12px;
  font-size: 14.5px; font-weight: 600; font-family: inherit; cursor: pointer; color: #fff;
  background: linear-gradient(135deg, #f4855c, #ea6a3c);
  box-shadow: 0 4px 12px rgba(234,106,60,0.28);
  transition: filter 0.15s ease, transform 0.05s ease, box-shadow 0.15s ease;
}
.occubuy-btn:hover:not(:disabled) { filter: brightness(1.05); box-shadow: 0 6px 16px rgba(234,106,60,0.36); }
.occubuy-btn:active:not(:disabled) { transform: scale(0.99); }
.occubuy-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
.occubuy-btn-secondary { background: none; color: #8a8272; box-shadow: none; border: 1px solid #e7e0d0; margin-top: 10px; }
.occubuy-btn-secondary:hover:not(:disabled) { background: #f4f1ea; filter: none; }
.occubuy-iframe-wrap { border: 1px solid #e7e0d0; border-radius: 14px; overflow: hidden; margin-bottom: 16px; background: #fff; }
.occubuy-iframe-wrap iframe { width: 100%; height: 220px; border: none; display: block; }
.occubuy-spinner-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 40px 0; }
.occubuy-spinner { width: 32px; height: 32px; border-radius: 50%; border: 3px solid #f1ecfa; border-top-color: #f4855c; animation: occubuy-spin 0.8s linear infinite; }
@keyframes occubuy-spin { to { transform: rotate(360deg); } }
.occubuy-spinner-text { font-size: 13px; color: #8a8272; text-align: center; }
.occubuy-success { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 20px; }
.occubuy-check {
  width: 52px; height: 52px; border-radius: 50%;
  background: linear-gradient(135deg, #f4855c, #ea6a3c); color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 12px;
}
.occubuy-score-label { font-size: 12.5px; color: #8a8272; margin-bottom: 2px; }
.occubuy-score-value { font-size: 40px; font-weight: 800; color: #35205e; margin: 4px 0 10px; }
.occubuy-score-band { display: inline-block; font-size: 12px; font-weight: 600; color: #35205e; background: #f1ecfa; padding: 4px 14px; border-radius: 999px; }
.occubuy-improve { background: #f1ecfa; border-radius: 10px; padding: 12px 14px; margin-bottom: 20px; }
.occubuy-improve-label { font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; color: #4a2c85; margin-bottom: 4px; }
.occubuy-improve-text { font-size: 13px; color: #4a2c85; line-height: 1.55; margin: 0; }
.occubuy-error { background: #fdf2f0; border: 1px solid #f3c6b8; color: #9a3b1f; border-radius: 10px; padding: 12px 14px; font-size: 13px; margin-bottom: 16px; }
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
    fontLink.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap";
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
  return `<div class="occubuy-brand"><span class="occubuy-dot"></span> Occubuy Score</div>`;
}

function consentTemplate(): string {
  return `
    <div class="occubuy-container" data-occubuy-step="consent">
      ${brandHeader()}
      <div class="occubuy-steps">
        <span class="occubuy-step-dot occubuy-step-dot-active" data-occubuy-step-dot="1"></span>
        <span class="occubuy-step-dot" data-occubuy-step-dot="2"></span>
        <span class="occubuy-step-dot" data-occubuy-step-dot="3"></span>
      </div>

      <div class="occubuy-panel occubuy-fade-in" data-occubuy-panel="1">
        <h2 class="occubuy-heading">Verify your rental score</h2>
        <p class="occubuy-sub">A strong Occubuy Score can help back up your application. We connect to your bank to calculate it from your real transaction history, never a credit check, and it takes about a minute.</p>
        <button type="button" class="occubuy-btn" data-occubuy-panel-next="2">Continue</button>
      </div>

      <div class="occubuy-panel" data-occubuy-panel="2" hidden>
        <h2 class="occubuy-heading">What we'll access</h2>
        <ul class="occubuy-access-list">
          <li>Your bank transaction history, via a secure Open Banking connection</li>
          <li>We never see your online banking login or password</li>
          <li>Read-only - nothing in your account can be moved or changed</li>
        </ul>
        <button type="button" class="occubuy-btn" data-occubuy-panel-next="3">Continue</button>
        <button type="button" class="occubuy-btn occubuy-btn-secondary" data-occubuy-panel-back="1">Back</button>
      </div>

      <div class="occubuy-panel" data-occubuy-panel="3" hidden>
        <h2 class="occubuy-heading">Your privacy, protected</h2>
        <ul class="occubuy-access-list">
          <li>Bank details are verified through Yodlee, a regulated Open Banking provider - Occubuy never stores your login</li>
          <li>Your score stays private. The partner only sees it if you choose to share it, on the next screen</li>
          <li>You can stop at any point before that - nothing is shared automatically</li>
        </ul>
        <div class="occubuy-consent">
          <input type="checkbox" id="occubuy-consent-checkbox" data-occubuy-consent-checkbox />
          <label for="occubuy-consent-checkbox">I agree to share my details so Occubuy can verify my rental score with my bank.</label>
        </div>
        <button type="button" class="occubuy-btn" data-occubuy-consent-submit disabled>Start Verification</button>
        <button type="button" class="occubuy-btn occubuy-btn-secondary" data-occubuy-panel-back="2">Back</button>
      </div>
    </div>
  `;
}

function bankConnectionTemplate(): string {
  return `
    <div class="occubuy-container" data-occubuy-step="bankConnection">
      ${brandHeader()}
      <h2 class="occubuy-heading">Connect your bank</h2>
      <p class="occubuy-sub">Select the bank your income is paid into to continue.</p>
      <div class="occubuy-iframe-wrap">
        <iframe
          name="occubuy-fastlink-frame"
          data-occubuy-fastlink-iframe
          sandbox="allow-scripts allow-same-origin"
          referrerpolicy="no-referrer"
          title="Bank connection"
        ></iframe>
      </div>
      <form data-occubuy-fastlink-form method="POST" target="occubuy-fastlink-frame" style="display:none;" aria-hidden="true"></form>
      <button type="button" class="occubuy-btn occubuy-btn-secondary" data-occubuy-bank-cancel>Cancel</button>
    </div>
  `;
}

function pollingTemplate(): string {
  return `
    <div class="occubuy-container" data-occubuy-step="score">
      ${brandHeader()}
      <h2 class="occubuy-heading">Calculating your score</h2>
      <div class="occubuy-spinner-wrap">
        <div class="occubuy-spinner"></div>
        <div class="occubuy-spinner-text">This usually takes a few seconds...</div>
      </div>
    </div>
  `;
}

function successTemplate(): string {
  return `
    <div class="occubuy-container" data-occubuy-step="score">
      ${brandHeader()}
      <div class="occubuy-success">
        <div class="occubuy-check">&#10003;</div>
        <div class="occubuy-score-label">Your Occubuy Score</div>
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
      <div class="occubuy-error" role="alert" data-occubuy-error-message></div>
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
    const fastlinkUrl = `${apiBase}/fastlink`;
    const fastlinkOrigin = apiBase;

    injectStyles();

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

    function cleanup(): void {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (messageListener) window.removeEventListener("message", messageListener);
    }

    function cancel(): void {
      cleanup();
      resolved.onCancel({ status: "cancelled" });
    }

    function fail(code: OccubuyErrorCode, message: string): void {
      cleanup();
      containerEl.innerHTML = errorTemplate();
      const messageEl = containerEl.querySelector("[data-occubuy-error-message]");
      const dismissBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-error-dismiss]");
      if (messageEl) messageEl.textContent = message;
      dismissBtn?.addEventListener("click", cancel);
      resolved.onError({ code, message });
    }

    function showConsentPanel(step: number): void {
      containerEl.querySelectorAll<HTMLElement>("[data-occubuy-panel]").forEach((panel) => {
        const isTarget = panel.dataset.occubuyPanel === String(step);
        panel.hidden = !isTarget;
        if (isTarget) {
          panel.classList.remove("occubuy-fade-in");
          void panel.offsetWidth;
          panel.classList.add("occubuy-fade-in");
        }
      });
      containerEl.querySelectorAll<HTMLElement>("[data-occubuy-step-dot]").forEach((dot) => {
        dot.classList.toggle("occubuy-step-dot-active", dot.dataset.occubuyStepDot === String(step));
      });
    }

    function renderConsent(): void {
      containerEl.innerHTML = consentTemplate();

      containerEl.querySelectorAll<HTMLButtonElement>("[data-occubuy-panel-next]").forEach((btn) => {
        btn.addEventListener("click", () => showConsentPanel(Number(btn.dataset.occubuyPanelNext)));
      });
      containerEl.querySelectorAll<HTMLButtonElement>("[data-occubuy-panel-back]").forEach((btn) => {
        btn.addEventListener("click", () => showConsentPanel(Number(btn.dataset.occubuyPanelBack)));
      });

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
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<{ scoreId?: string; sessionToken?: string }>;
          })
          .then((data) => {
            if (cancelled) return;
            if (!data.scoreId || !data.sessionToken) throw new Error("Malformed response");
            sessionToken = data.sessionToken;
            renderBankConnection(data.scoreId);
          })
          .catch(() => {
            if (!cancelled) fail("START_FAILED", "We couldn't start your verification. Please try again.");
          });
      });
    }

    function renderBankConnection(scoreId: string): void {
      containerEl.innerHTML = bankConnectionTemplate();
      const iframe = containerEl.querySelector<HTMLIFrameElement>("[data-occubuy-fastlink-iframe]");
      const form = containerEl.querySelector<HTMLFormElement>("[data-occubuy-fastlink-form]");
      const cancelBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-bank-cancel]");
      if (!iframe || !form || !cancelBtn) return;

      form.action = fastlinkUrl;
      cancelBtn.addEventListener("click", cancel);

      messageListener = (event: MessageEvent) => {
        // Validates both origin and source - never trust postMessage without confirming
        // the sender is this exact iframe.
        if (event.origin !== fastlinkOrigin) return;
        if (event.source !== iframe.contentWindow) return;
        if (!isFastLinkMessage(event.data)) return;

        if (event.data.event === "SUCCESS") {
          if (messageListener) window.removeEventListener("message", messageListener);
          completeBankConnection(scoreId, event.data.data ?? {});
        } else if (event.data.event === "CANCEL" || event.data.event === "EXIT") {
          cancel();
        }
      };
      window.addEventListener("message", messageListener);

      form.submit();
    }

    function completeBankConnection(scoreId: string, providerData: Record<string, unknown>): void {
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
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (cancelled) return;
          renderScorePolling(scoreId);
        })
        .catch(() => {
          if (!cancelled) fail("BANK_CONNECTION_FAILED", "We couldn't confirm your bank connection. Please try again.");
        });
    }

    function renderScorePolling(scoreId: string): void {
      containerEl.innerHTML = pollingTemplate();
      poll(scoreId);
    }

    function poll(scoreId: string): void {
      if (cancelled) return;
      pollAttempts += 1;
      if (pollAttempts > MAX_POLL_ATTEMPTS) {
        fail("POLL_TIMEOUT", "Verification is taking longer than expected. Please try again.");
        return;
      }

      fetch(`${apiBase}/api/scores/${encodeURIComponent(scoreId)}`, {
        headers: authHeaders(),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ status?: string; score?: { value?: number } }>;
        })
        .then((data) => {
          if (cancelled) return;
          const value = data.score?.value;
          if (data.status === "COMPLETED" && typeof value === "number" && Number.isFinite(value)) {
            renderSuccess(scoreId, value);
          } else {
            pollTimer = setTimeout(() => poll(scoreId), 1500);
          }
        })
        .catch(() => {
          if (!cancelled) fail("POLL_FAILED", "We couldn't check your verification status. Please try again.");
        });
    }

    // score/band here is the customer's own preview from polling - onComplete must only
    // ever fire with POST .../share's response, never this closed-over roundedScore.
    function renderSuccess(scoreId: string, score: number): void {
      const roundedScore = Math.round(score);
      const band = scoreToBand(roundedScore);
      const verifiedAt = new Date().toISOString();
      let settled = false;

      containerEl.innerHTML = successTemplate();
      const scoreValueEl = containerEl.querySelector("[data-occubuy-score-value]");
      const scoreBandEl = containerEl.querySelector("[data-occubuy-score-band]");
      const improveTextEl = containerEl.querySelector("[data-occubuy-improve-text]");
      const shareBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-share]");
      const declineBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-decline]");

      if (scoreValueEl) scoreValueEl.textContent = String(roundedScore);
      if (scoreBandEl) scoreBandEl.textContent = capitalize(band);
      if (improveTextEl) improveTextEl.textContent = improvementCopy(band);

      shareBtn?.addEventListener("click", () => {
        if (settled) return;
        settled = true;
        shareBtn.disabled = true;
        if (declineBtn) declineBtn.disabled = true;

        // Fires off this response, not the closed-over roundedScore (see renderSuccess).
        // Backend's band uses a different 5-value scale, so we keep our own.
        fetch(`${apiBase}/api/scores/${encodeURIComponent(scoreId)}/share`, {
          method: "POST",
          headers: authHeaders(),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<{ score?: number; verifiedAt?: string; reference?: string }>;
          })
          .then((shared) => {
            cleanup();
            resolved.onComplete({
              status: "success",
              score: typeof shared.score === "number" ? Math.round(shared.score) : roundedScore,
              band,
              verifiedAt: shared.verifiedAt ?? verifiedAt,
              reference: shared.reference ?? scoreId,
            });
          })
          .catch(() => {
            settled = false;
            shareBtn.disabled = false;
            if (declineBtn) declineBtn.disabled = false;
            fail("SHARE_FAILED", "We couldn't share your score with the partner. Please try again.");
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
          .then(() => {
            cleanup();
            resolved.onDecline({ status: "declined" });
          });
      });
    }

    renderConsent();
  }

  return { start };
}

// Also stick this on window so the plain <script src> version works too
if (typeof window !== "undefined") {
  (window as unknown as { OccubuyScore: { init: typeof init } }).OccubuyScore = { init };
}
