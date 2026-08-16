export type OccubuyEnvironment = "sandbox" | "production";

export interface OccubuyScoreResult {
  status: "success";
  score: number;
  band: "strong" | "moderate" | "limited";
  verifiedAt: string;
}

export interface OccubuyCancelResult {
  status: "cancelled";
}

export interface OccubuyDeclineResult {
  status: "declined";
}

export interface OccubuyInitConfig {
  apiKey: string;
  /** Where to render the widget, either a CSS selector like "#occubuy-widget" or the actual element. */
  container: string | HTMLElement;
  environment?: OccubuyEnvironment;
  onComplete?: (result: OccubuyScoreResult) => void;
  onCancel?: (result: OccubuyCancelResult) => void;
  /** Fires if the customer sees their score but decides not to share it with the partner. */
  onDecline?: (result: OccubuyDeclineResult) => void;
}

export interface OccubuyScoreInstance {
  start: () => void;
}

type ResolvedConfig = OccubuyInitConfig & {
  environment: OccubuyEnvironment;
  onComplete: (result: OccubuyScoreResult) => void;
  onCancel: (result: OccubuyCancelResult) => void;
  onDecline: (result: OccubuyDeclineResult) => void;
};

// Everything below points at the fake sandbox backend in backend/server.mjs for now.
// There's no real production backend yet, that's waiting on the POST /sdk/sessions
// design doc getting reviewed first.
const SANDBOX_API_BASE = "http://localhost:8787";
const SANDBOX_FASTLINK_URL = "http://localhost:8788/fastlink";
const SANDBOX_FASTLINK_ORIGIN = "http://localhost:8788";
// TODO: swap this for a real per session token once POST /sdk/sessions actually exists.
const SANDBOX_DEV_TOKEN = "occubuy_dev_temp_token";
const AUTH_HEADER = `Bearer ${SANDBOX_DEV_TOKEN}`;

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

interface FastLinkMessage {
  type: "FastLink";
  event: string;
}

function isFastLinkMessage(value: unknown): value is FastLinkMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.type === "FastLink" && typeof record.event === "string";
}

// Styling for the widget. Gets added to the page once and doesn't need
// any CSS from the partner at all. Every class starts with "occubuy-"
// so it never clashes with whatever's already on their site.
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

// These are just plain HTML strings, nothing dynamic ever gets stuffed
// into them directly. Anything coming from the network or from postMessage
// gets written in afterwards with textContent instead, never glued into the string.
function brandHeader(): string {
  return `<div class="occubuy-brand"><span class="occubuy-dot"></span> Occubuy Score</div>`;
}

function consentTemplate(): string {
  return `
    <div class="occubuy-container" data-occubuy-step="consent">
      ${brandHeader()}
      <h2 class="occubuy-heading">Verify your rental score</h2>
      <p class="occubuy-sub">A strong Occubuy Score can help back up your application. We connect to your bank to calculate it from your real transaction history, never a credit check, and it takes about a minute. You'll see your score first, and decide yourself whether to share it.</p>
      <div class="occubuy-consent">
        <input type="checkbox" id="occubuy-consent-checkbox" data-occubuy-consent-checkbox />
        <label for="occubuy-consent-checkbox">I agree to share my details so Occubuy can verify my rental score with my bank.</label>
      </div>
      <button type="button" class="occubuy-btn" data-occubuy-consent-submit disabled>Start Verification</button>
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
      <form data-occubuy-fastlink-form action="${SANDBOX_FASTLINK_URL}" method="POST" target="occubuy-fastlink-frame" style="display:none;" aria-hidden="true"></form>
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
      <p class="occubuy-sub occubuy-score-explainer">Calculated from your real income and spending patterns, not a credit check. Paying down debt and keeping a consistent income history improves it over time. This score is only visible to you until you choose to share it.</p>
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

  const resolved: ResolvedConfig = {
    environment: "sandbox",
    onComplete: () => {},
    onCancel: () => {},
    onDecline: () => {},
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

    injectStyles();

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let pollAttempts = 0;
    let messageListener: ((event: MessageEvent) => void) | undefined;

    function cleanup(): void {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (messageListener) window.removeEventListener("message", messageListener);
    }

    function cancel(): void {
      cleanup();
      resolved.onCancel({ status: "cancelled" });
    }

    function fail(message: string): void {
      cleanup();
      containerEl.innerHTML = errorTemplate();
      const messageEl = containerEl.querySelector("[data-occubuy-error-message]");
      const dismissBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-error-dismiss]");
      if (messageEl) messageEl.textContent = message;
      dismissBtn?.addEventListener("click", cancel);
    }

    function renderConsent(): void {
      containerEl.innerHTML = consentTemplate();
      const checkbox = containerEl.querySelector<HTMLInputElement>("[data-occubuy-consent-checkbox]");
      const submitBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-consent-submit]");
      if (!checkbox || !submitBtn) return;

      checkbox.addEventListener("change", () => {
        submitBtn.disabled = !checkbox.checked;
      });

      submitBtn.addEventListener("click", () => {
        if (!checkbox.checked) return;
        submitBtn.disabled = true;

        fetch(`${SANDBOX_API_BASE}/api/scores`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: AUTH_HEADER },
          body: JSON.stringify({ userId: resolved.apiKey }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<{ scoreId?: string }>;
          })
          .then((data) => {
            if (cancelled) return;
            if (!data.scoreId) throw new Error("Malformed response");
            renderBankConnection(data.scoreId);
          })
          .catch(() => {
            if (!cancelled) fail("We couldn't start your verification. Please try again.");
          });
      });
    }

    function renderBankConnection(scoreId: string): void {
      containerEl.innerHTML = bankConnectionTemplate();
      const iframe = containerEl.querySelector<HTMLIFrameElement>("[data-occubuy-fastlink-iframe]");
      const form = containerEl.querySelector<HTMLFormElement>("[data-occubuy-fastlink-form]");
      const cancelBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-bank-cancel]");
      if (!iframe || !form || !cancelBtn) return;

      cancelBtn.addEventListener("click", cancel);

      messageListener = (event: MessageEvent) => {
        // Checking both origin and source here. Never trust "*" for this,
        // only accept messages that actually came from the FastLink iframe made above.
        if (event.origin !== SANDBOX_FASTLINK_ORIGIN) return;
        if (event.source !== iframe.contentWindow) return;
        if (!isFastLinkMessage(event.data)) return;

        if (event.data.event === "SUCCESS") {
          if (messageListener) window.removeEventListener("message", messageListener);
          completeBankConnection(scoreId);
        } else if (event.data.event === "CANCEL" || event.data.event === "EXIT") {
          cancel();
        }
      };
      window.addEventListener("message", messageListener);

      form.submit();
    }

    function completeBankConnection(scoreId: string): void {
      fetch(`${SANDBOX_API_BASE}/api/scores/${encodeURIComponent(scoreId)}/complete`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (cancelled) return;
          renderScorePolling(scoreId);
        })
        .catch(() => {
          if (!cancelled) fail("We couldn't confirm your bank connection. Please try again.");
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
        fail("Verification is taking longer than expected. Please try again.");
        return;
      }

      fetch(`${SANDBOX_API_BASE}/api/scores/${encodeURIComponent(scoreId)}`, {
        headers: { Authorization: AUTH_HEADER },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ status?: string; score?: number }>;
        })
        .then((data) => {
          if (cancelled) return;
          if (data.status === "COMPLETED" && typeof data.score === "number" && Number.isFinite(data.score)) {
            renderSuccess(data.score);
          } else {
            pollTimer = setTimeout(() => poll(scoreId), 1500);
          }
        })
        .catch(() => {
          if (!cancelled) fail("We couldn't check your verification status. Please try again.");
        });
    }

    function renderSuccess(score: number): void {
      const roundedScore = Math.round(score);
      const band = scoreToBand(roundedScore);
      const verifiedAt = new Date().toISOString();

      containerEl.innerHTML = successTemplate();
      const scoreValueEl = containerEl.querySelector("[data-occubuy-score-value]");
      const scoreBandEl = containerEl.querySelector("[data-occubuy-score-band]");
      const shareBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-share]");
      const declineBtn = containerEl.querySelector<HTMLButtonElement>("[data-occubuy-decline]");

      if (scoreValueEl) scoreValueEl.textContent = String(roundedScore);
      if (scoreBandEl) scoreBandEl.textContent = capitalize(band);

      shareBtn?.addEventListener("click", () => {
        cleanup();
        resolved.onComplete({ status: "success", score: roundedScore, band, verifiedAt });
      });

      declineBtn?.addEventListener("click", () => {
        cleanup();
        resolved.onDecline({ status: "declined" });
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
