// The developer docs text, in one place. The same file is copied verbatim to the partner
// portal (occubuy-integration: src/developerDocs.ts), which shows it under Embed score >
// Developer docs. Edit it here, then copy it over; `npm run docs:check` in the partner portal
// fails if the two copies differ.
//
// Rule for this file: it describes what the SDK widget and backend actually do. If the code
// changes, this changes with it.

export const DOCS_UPDATED = "27 September 2026";
export const API_BASE = "https://occubuy-backend.onrender.com";
export const SCRIPT_URL = "https://occubuy-demo.onrender.com/sdk/v1/occubuy-sdk.js";

export interface DocStep {
  title: string;
  body: string;
}

export interface DocEndpoint {
  method: "GET" | "POST";
  path: string;
  auth: string;
  description: string;
  request?: string;
  response: string;
  errors?: string[];
}

// [name, meaning] or [code, http status, meaning]
export type DocRow = [string, string] | [string, string, string];

// ---- API reference ---------------------------------------------------------------------

export const apiReference = {
  title: "Occubuy Score API",
  intro:
    `What the widget sends to the Occubuy backend (${API_BASE}). The widget makes all of these calls for you. ` +
    "The only one your own server might call is GET /api/scores/{scoreId}, to read a score a renter has shared with you.",
  authIntro:
    "Two credentials, and most calls need both. Your partner key says which partner is calling; it is safe in your page source, " +
    "like a publishable key. The session token comes with each new score and proves a call belongs to that one renter's flow.",
  authSteps: [
    {
      title: "Get your partner key",
      body:
        "Generate it on the Embed score page of the partner portal. The page and working keys are only there once your account is " +
        "approved or live and has a live offering. Send it on every call as Authorization: Bearer <key>. Sandbox keys start with pk_sandbox_.",
    },
    {
      title: "Register your website",
      body:
        "Add every website the widget runs on under Allowed websites on the same page. With no website registered the widget won't " +
        "start (ORIGIN_NOT_ALLOWED). http://localhost works with a sandbox key, for testing.",
    },
    {
      title: "Create a score",
      body: "POST /api/scores returns a sessionToken for that score only. It expires after one hour.",
    },
    {
      title: "Send both on every later call",
      body:
        "complete, share, decline and the widget's status checks send Authorization: Bearer <key> and X-Occubuy-Session: <sessionToken>. " +
        "A session token sent with another partner's key gets SCORE_NOT_FOUND.",
    },
  ] as DocStep[],
  endpoints: [
    {
      method: "POST",
      path: "/api/scores",
      auth: "Partner key, from one of your allowed websites (checked with the browser's Origin header)",
      description:
        "Starts a verification. Returns the session token and the FastLink session the widget opens for the bank connection. " +
        "userId can be any id for this attempt; the widget sends a random one.",
      request: `{
  "userId": "3f1c2a90-...",
  "applicant": {
    "fullName": "Jordan Lee",
    "email": "jordan@example.com",
    "phone": "0412 345 678",
    "dob": "1995-05-05",
    "address": "1 Example St, Melbourne VIC 3000"
  }
}`,
      response: `201
{
  "scoreId": "6a8555cf11410758b44e311a",
  "sessionToken": "2efdd152...",
  "fastlinkSession": {
    "fastlinkUrl": "https://.../fastlink",
    "accessToken": "...",
    "configName": "Aggregation",
    "expiresAt": "2026-09-27T12:30:00.000Z",
    "transport": "yodleeJs"
  }
}`,
      errors: ["USER_ID_REQUIRED", "INVALID_APPLICANT", "PARTNER_KEY_INVALID", "ORIGIN_NOT_ALLOWED"],
    },
    {
      method: "POST",
      path: "/api/scores/{scoreId}/complete",
      auth: "Partner key + X-Occubuy-Session",
      description:
        "Sent once FastLink reports the bank is connected. The backend first confirms the bank link with Yodlee, then works out the " +
        "score and returns it straight away, so the widget doesn't have to wait for it. Can only happen once per score.",
      request: `{
  "providerId": 16441,
  "providerAccountId": 11107612,
  "requestId": "req_abc123",
  "providerName": "Dag Site",
  "status": "SUCCESS"
}`,
      response: `{
  "status": "COMPLETED",
  "score": { "value": 742, "band": "Very Good" }
}`,
      errors: [
        "INVALID_COMPLETE_PAYLOAD",
        "BANK_LINK_NOT_CONFIRMED",
        "BANK_CHECK_UNAVAILABLE",
        "INVALID_SCORE_STATE",
        "SESSION_INVALID",
        "SCORE_NOT_FOUND",
      ],
    },
    {
      method: "GET",
      path: "/api/scores/{scoreId}",
      auth:
        "Partner key, always. With X-Occubuy-Session as well you can read a score the renter hasn't shared yet (the widget does this " +
        "for the renter's own screen). With the key alone you only get it after the renter shares it.",
      description:
        "Reads a score. If it isn't ready yet you get PROCESSING and retryAfter, the number of seconds to wait before asking again.",
      response: `{
  "status": "COMPLETED",
  "score": { "value": 742, "band": "Very Good" }
}

while it's still being worked out:
{ "status": "PROCESSING", "retryAfter": 3 }`,
      errors: ["AUTH_REQUIRED", "NOT_SHARED", "SCORE_NOT_FOUND"],
    },
    {
      method: "POST",
      path: "/api/scores/{scoreId}/share",
      auth: "Partner key + X-Occubuy-Session",
      description:
        "The renter's choice to give you this score. Before this, your key can't read it. The score also appears under Shared Scores " +
        "in the partner portal. Calling it again returns the same result.",
      response: `{
  "score": 742,
  "band": "Very Good",
  "verifiedAt": "2026-09-27T12:31:00.000Z",
  "reference": "6a8555cf11410758b44e311a"
}`,
      errors: ["ALREADY_DECLINED", "INVALID_SCORE_STATE", "SESSION_INVALID", "SCORE_NOT_FOUND"],
    },
    {
      method: "POST",
      path: "/api/scores/{scoreId}/decline",
      auth: "Partner key + X-Occubuy-Session",
      description: "The renter chose not to share. This is final: a declined score can't be shared later.",
      response: `{ "status": "declined" }`,
      errors: ["SESSION_INVALID", "SCORE_NOT_FOUND"],
    },
    {
      method: "GET",
      path: "/partners/config",
      auth: "Partner key",
      description:
        "The widget calls this when it starts, to pick up the colours you saved under Widget colours in the partner portal. " +
        "Only colours you actually set come back; an empty object means Occubuy's own.",
      response: `{ "branding": { "primaryColor": "#1e3a8a", "headingColor": "#0f172a" } }`,
      errors: ["PARTNER_KEY_INVALID"],
    },
  ] as DocEndpoint[],
  otpIntro:
    "Ready on the backend but not used by the widget yet: no SMS provider is connected, so codes only appear in the server log. " +
    "Both calls need your partner key and an allowed website. A phone number can get 3 codes per 10 minutes, and each code allows 5 tries.",
  otpEndpoints: [
    {
      method: "POST",
      path: "/api/renters/send-otp",
      auth: "Partner key, from an allowed website",
      description: "Sends a 6 digit code to an Australian mobile number. The code works for 5 minutes; a new code replaces the old one.",
      request: `{ "phone": "0412 345 678" }`,
      response: `{ "status": "sent" }`,
      errors: ["INVALID_PHONE", "OTP_RATE_LIMITED"],
    },
    {
      method: "POST",
      path: "/api/renters/verify-otp",
      auth: "Partner key, from an allowed website",
      description: "Checks the code. The same phone number always gets the same renterId, whichever partner asks.",
      request: `{ "phone": "0412 345 678", "code": "123456" }`,
      response: `{ "renterId": "6a86..." }`,
      errors: ["INVALID_VERIFY_PAYLOAD", "OTP_INVALID", "OTP_TOO_MANY_ATTEMPTS"],
    },
  ] as DocEndpoint[],
  errors: [
    ["PARTNER_KEY_INVALID", "401", "Missing or unknown partner key, a revoked key, or an account that isn't approved or live."],
    ["ORIGIN_NOT_ALLOWED", "403", "The page's website isn't in your Allowed websites, or you haven't added any yet."],
    ["SESSION_INVALID", "401", "Session token missing, wrong, or older than one hour."],
    ["AUTH_REQUIRED", "401", "GET /api/scores/{scoreId} without a valid partner key."],
    ["SCORE_NOT_FOUND", "404", "No such score, or it belongs to another partner. It's a 404 either way, so nobody can tell which."],
    ["USER_ID_REQUIRED", "400", "POST /api/scores without a userId."],
    ["INVALID_APPLICANT", "400", "An applicant field failed its check. errors lists each field and why."],
    ["INVALID_COMPLETE_PAYLOAD", "400", "providerAccountId or requestId missing, or status isn't SUCCESS."],
    ["BANK_LINK_NOT_CONFIRMED", "400", "Yodlee doesn't have this bank link, it failed, or it's for another bank. The renter needs to connect again."],
    ["BANK_CHECK_UNAVAILABLE", "502", "Yodlee couldn't be reached to confirm the bank link. Safe to try again."],
    ["INVALID_SCORE_STATE", "409", "Not possible in the score's current state, for example completing it twice or sharing it before it's ready."],
    ["NOT_SHARED", "403", "The renter hasn't shared this score with you."],
    ["ALREADY_DECLINED", "409", "The renter declined this score, so it can't be shared."],
    ["INVALID_PHONE", "400", "Not an Australian mobile number."],
    ["OTP_RATE_LIMITED", "429", "Too many codes for this number. retryAfterSeconds (and the Retry-After header) says how long to wait."],
    ["INVALID_VERIFY_PAYLOAD", "400", "The code isn't 6 digits."],
    ["OTP_INVALID", "401", "Wrong, expired or already used code."],
    ["OTP_TOO_MANY_ATTEMPTS", "429", "5 wrong tries; the code no longer works. Ask for a new one."],
  ] as DocRow[],
};

// ---- SDK flow ----------------------------------------------------------------------------

export const sdkFlow = {
  title: "SDK Flow",
  intro: "What happens between init() and a finished verification, and what your page gets back.",
  setupSteps: [
    { title: "Add a container", body: "Put it where the widget should appear, usually on the page where renters apply." },
    { title: "Load the script", body: "The hosted v1 script keeps working when we release updates. Breaking changes would ship as v2." },
    { title: "Start it with the renter's details", body: "Pass what your application form already collected. init() only prepares the widget; nothing shows until .start()." },
  ] as DocStep[],
  setupCode: `<div id="occubuy-widget"></div>
<script src="${SCRIPT_URL}"></script>
<script>
  OccubuyScore.init({
    apiKey: "pk_sandbox_...",
    container: "#occubuy-widget",
    applicant: {
      fullName: "Jordan Lee",
      email: "jordan@example.com",
      phone: "0412 345 678",
      dob: "1995-05-05",
      address: "1 Example St, Melbourne VIC 3000"
    },
    onComplete: function (result) { /* shared with you */ },
    onDecline: function () { /* carry on with your normal application */ }
  }).start();
</script>`,
  options: [
    ["apiKey", "Required. Your partner key."],
    ["container", "Required. A CSS selector such as \"#occubuy-widget\", or the element itself."],
    ["applicant", "Required. fullName, email, phone, dob (YYYY-MM-DD) and address, from your own form. Checked with the same rules as the backend before anything is sent."],
    ["branding", "Optional. primaryColor, primaryColorDark, headingColor (hex). Usually you set these in the partner portal instead; values passed here win."],
    ["accessibility", "Optional starting display settings. See Accessibility below."],
    ["maxHeight", "Optional. How tall the widget gets on your page, as a CSS length such as \"560px\". Longer content scrolls inside the widget, with its header kept in view, instead of stretching your page. Default 640px, or the window height minus 32px if that's smaller."],
    ["onComplete, onDecline, onCancel, onError", "Optional callbacks. See Callbacks below."],
    ["apiBase", "Leave it out. The hosted script already points at the Occubuy backend."],
    ["environment", "\"sandbox\", the only one for now."],
  ] as DocRow[],
  sequence: [
    { title: "Consent screen", body: "The renter reads what will happen and ticks the consent box. Nothing is sent until they click Verify." },
    { title: "POST /api/scores", body: "Starts the score. The widget makes up its own userId; you don't pass one." },
    {
      title: "Bank connection",
      body:
        "Yodlee FastLink opens inside the widget. Real banks go through Yodlee's official script (transport yodleeJs); the test " +
        "provider uses a plain iframe (postMessage). If the renter cancels, FastLink is closed.",
    },
    { title: "POST /api/scores/{scoreId}/complete", body: "The backend confirms the bank link with Yodlee, works out the score and sends it back." },
    {
      title: "Score screen",
      body:
        "The renter sees their score and band first. Nothing has reached you yet. If the score wasn't ready in the complete response, " +
        "the widget asks GET /api/scores/{scoreId}, waiting as long as retryAfter says (at least 1.5 seconds), up to 40 times.",
    },
    {
      title: "Share or don't share",
      body:
        "Share sends it to you: onComplete fires and the score appears under Shared Scores in the portal. Don't share ends the flow " +
        "with onDecline, and that score can't be shared later. If the decline call itself fails, the flow still ends quietly for the renter.",
    },
  ] as DocStep[],
  behaviour: [
    {
      title: "Try again",
      body:
        "When something fails the widget shows what happened and a Try again button that goes back to the step that failed. " +
        "Problems a retry can't fix (website not allowed, bad key, bad applicant details) only get Close.",
    },
    {
      title: "Picking up after a reload",
      body:
        "Once a score exists, the widget remembers it for that browser tab. If the page reloads (a refresh, or a bank sending the " +
        "renter back), it opens at the score screen instead of starting again. It forgets it when the flow ends, or after 50 minutes.",
    },
  ] as DocStep[],
  callbacks: [
    ["onComplete", "The renter shared. Gets { status: \"success\", score, band, verifiedAt, reference }; reference is the scoreId."],
    ["onDecline", "The renter chose not to share. Gets { status: \"declined\" }."],
    ["onCancel", "The renter closed the widget or cancelled the bank step. Gets { status: \"cancelled\" }."],
    ["onError", "Gets { code, message } each time something fails, while the widget shows its own error screen. The flow can carry on if the renter taps Try again."],
  ] as DocRow[],
  callbacksNote: "Only one of onComplete, onDecline and onCancel ever fires for a flow.",
  errors: [
    ["INVALID_APPLICANT", "The applicant passed to init() failed a check. No Try again: fix the data you pass in."],
    ["ORIGIN_NOT_ALLOWED", "This website isn't in your Allowed websites. The exact reason is logged in the browser console. No Try again."],
    ["PARTNER_KEY_INVALID", "The key is unknown or revoked, or your account isn't approved or live. No Try again."],
    ["START_FAILED", "Starting the score failed (network or server). Try again goes back to the consent screen."],
    ["BANK_CONNECTION_FAILED", "FastLink didn't load, or the bank link couldn't be confirmed. Try again reopens the bank step, retries the check, or starts over if Yodlee refused the link."],
    ["POLL_FAILED", "Three status checks in a row failed. Try again checks again."],
    ["POLL_TIMEOUT", "The score still wasn't ready after 40 checks (one to two minutes). Try again checks again."],
    ["SHARE_FAILED", "Sharing failed. Try again goes back to the score screen so the renter can share again."],
  ] as DocRow[],
  accessibilityIntro:
    "Three buttons in the widget's header: Larger text, Dark mode and High contrast. Any renter can switch them, and the choice " +
    "is remembered on their device. Screen reader support is always on: each new screen moves focus to its heading, progress " +
    "and errors are announced, and decorative icons are hidden. All text meets WCAG AA contrast.",
  accessibilityCode: `OccubuyScore.init({
  // ...
  accessibility: {
    theme: "auto",        // "light" (default), "dark", or "auto" to follow the renter's device
    largeText: false,
    highContrast: false,  // turns on by itself when the renter's device asks for more contrast
    showControls: true    // false hides the three buttons (not recommended)
  }
});`,
  accessibilityNote: "These are only starting values. A renter's own choice on their device wins.",
  bands: [
    ["Excellent", "800 to 1000"],
    ["Very Good", "600 to 799"],
    ["Good", "400 to 599"],
    ["Fair", "200 to 399"],
    ["Poor", "0 to 199"],
  ] as DocRow[],
  beforeYouIntegrate: [
    { title: "Account", body: "Approved or live, with a live offering. The Embed score page only appears then, and only those accounts' keys work." },
    { title: "Allowed websites", body: "At least one. Changes apply straight away." },
    {
      title: "Key",
      body:
        "Generated on the Embed score page. It's sent to the Occubuy backend as you generate it and works straight away. " +
        "Generating a new key or pressing Revoke stops the old one immediately, so update your pages at the same time.",
    },
    { title: "Colours", body: "Set under Widget colours. Button text switches between dark and white to stay readable on your colour." },
  ] as DocStep[],
  knownIssues: [
    "Scores are placeholders: a random number until Occubuy connects its real scoring. The flow, bands and sharing are real.",
    "Some Yodlee test banks (CDR Sandbox) open the bank in a new tab even though FastLink is set to stay inside the widget. If the page reloads when the renter comes back after the score exists, the widget picks up again; a bank step that was still open has to be done again.",
    "The renter phone check (OTP) is ready on the backend but not shown in the widget until an SMS provider is connected.",
  ],
};

// ---- Consent & data ------------------------------------------------------------------------

export const consent = {
  title: "Consent & Data",
  intro:
    "What the renter agrees to, what you can see and when, and what happens when they change their mind. " +
    "For the calls themselves see the API reference and SDK flow.",
  principle:
    "Nothing reaches a partner without the renter doing something. The renter sees their score the moment it's ready; you don't, " +
    "until they choose Share. This is enforced by the API, not just the widget: your key only reads a score after it's shared, and " +
    "ownership is checked every time, so a partner can't even find out whether a score exists for someone else's renter.",
  consentScreen:
    "Occubuy owns the consent screen's wording and you can't change it; you can change its colours. The renter has to tick the " +
    "consent box before anything is sent. Occubuy never sees their online banking login or password, and nothing in their account " +
    "can be moved or changed.",
  withdrawal: [
    {
      title: "Not available yet",
      body:
        "Renters will be able to withdraw a shared score from the Occubuy mobile app, for up to 12 months after sharing it. " +
        "That isn't switched on yet, so for now a shared score stays in your Shared Scores.",
    },
    { title: "After 12 months", body: "The right to withdraw ends. The data isn't deleted automatically at that point." },
  ] as DocStep[],
  openQuestions: ["How long data is kept once the 12 months are over isn't decided yet. It's with Occubuy."],
};
