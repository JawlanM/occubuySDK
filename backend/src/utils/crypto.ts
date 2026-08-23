import { randomBytes, createHash, timingSafeEqual } from "crypto";

// Never store the raw key/token, only the hash. The pepper is server-only, so a Mongo
// dump alone can't be brute-forced.
function pepper(): string {
  return process.env.OCCUBUY_HASH_PEPPER ?? "dev-only-pepper-change-me";
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(`${secret}:${pepper()}`).digest("hex");
}

// timingSafeEqual so someone can't guess the key byte by byte from response speed
export function secretMatchesHash(secret: string, hash: string): boolean {
  const candidate = Buffer.from(hashSecret(secret));
  const stored = Buffer.from(hash);
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export function generateApiKey(prefix: string): { fullKey: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString("hex");
  const fullKey = `pk_sandbox_${prefix}_${secret}`;
  return { fullKey, prefix: `pk_sandbox_${prefix}`, hash: hashSecret(fullKey) };
}

export function generateSessionToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("hex");
  return { token, hash: hashSecret(token) };
}
