// One phone format everywhere (dev plan 3.2). The applicant form takes "0412 345 678",
// OTP used to demand "+61412345678" - same person, two different strings, so renter matching
// would miss. Everything that stores or compares a phone goes through this first.

// Australian mobiles only (04xx), which is all the applicant validator accepts anyway.
// Returns E.164 ("+61412345678") or null if it isn't an AU mobile.
export function normalizeAuMobile(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const compact = input.replace(/[\s\-().]/g, "");
  const match = /^(?:\+?61|0)(4\d{8})$/.exec(compact);
  return match ? `+61${match[1]}` : null;
}

// "+61412345678" -> "+61 4•• ••• 678" for logs/events, never the full number
export function maskPhone(e164: string): string {
  return e164.length > 6 ? `${e164.slice(0, 4)}•• ••• ${e164.slice(-3)}` : "•••";
}
