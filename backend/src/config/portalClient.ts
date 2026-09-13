import dotenv from "dotenv";

dotenv.config();

// occubuy-integration-main (Team 132's partner portal) is the source of truth for partner
// identity/API keys (see integration-memory.md Phase 0-3). This backend talks to it two
// ways: authenticatePartnerKey() (middleware/auth.ts) asks it to verify a partner key, and
// pushLeadToPortal() below tells it about a score once the customer actually shares it.
// Both calls are gated by the same shared secret, never exposed past these two backends.
export function portalBaseUrl(): string {
  return process.env.PORTAL_BASE_URL ?? "http://localhost:4001";
}

export function internalSecret(): string {
  return process.env.OCCUBUY_INTERNAL_SECRET ?? "";
}

export interface PortalLeadPayload {
  partnerId: string;
  scoreId: string;
  score: number;
  band: string;
  verifiedAt: string;
}

// Fire-and-forget from the caller's point of view (POST /scores/:id/share) - this rejects
// on any non-2xx or network failure so the caller can log it, but must never be allowed to
// change what the customer's own /share response looks like. Portal upserts on scoreId, so
// a caller-side retry after a failure here is safe to just call again.
export async function pushLeadToPortal(payload: PortalLeadPayload): Promise<void> {
  const res = await fetch(`${portalBaseUrl()}/api/internal/leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": internalSecret(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Portal lead push failed: HTTP ${res.status}`);
  }
}
