// No longer the production path for key issuance - the portal (occubuy-integration-main,
// POST /api/partners/me/api-key) owns that now, and authenticatePartnerKey() in
// middleware/auth.ts verifies against the portal instead of this collection. A key this
// script prints will NOT authenticate real requests against a portal-backed backend -
// generate the key from the portal itself for that. This is left in place only to seed a
// local "partners" doc for inspecting the data shape or for tests that mock dataApi
// directly instead of going through the portal.
// Run: npm run seed:partner (from backend/). Re-running won't duplicate the partner
// or reprint the key - delete the doc first to rotate.
import { IPartner, PARTNER_COLLECTION } from "../models/partner.model";
import { findOne, insertOne } from "../config/dataApi";
import { generateApiKey } from "../utils/crypto";

const PARTNER_ID = process.argv[2] ?? "jmrealestate";
const LEGAL_NAME = process.argv[3] ?? "JM Realestate Pty Ltd";

async function main(): Promise<void> {
  const existing = await findOne<IPartner>(PARTNER_COLLECTION, { partnerId: PARTNER_ID });
  if (existing) {
    console.log(`Partner "${PARTNER_ID}" already exists (apiKeyPrefix: ${existing.apiKeyPrefix}).`);
    console.log("The full key is never stored, so it can't be reprinted - delete this partner doc and re-run to rotate.");
    process.exit(0);
  }

  const { fullKey, prefix, hash } = generateApiKey(PARTNER_ID);
  const now = new Date().toISOString();

  await insertOne(PARTNER_COLLECTION, {
    partnerId: PARTNER_ID,
    legalName: LEGAL_NAME,
    abn: "00000000000",
    apiKeyPrefix: prefix,
    apiKeyHash: hash,
    category: "property",
    status: "approved",
    primaryContact: { name: "Demo Contact", email: "demo@example.test", phone: "0400000000" },
    audit: { createdAt: now, createdBy: "seed-script", updatedAt: now, updatedBy: "seed-script" },
  });

  console.log(`Partner "${PARTNER_ID}" created.`);
  console.log(`\nAPI key (copy this now, it is never shown again):\n\n  ${fullKey}\n`);
  console.log("Paste it into demo/mockPartnerWebApp.html as the apiKey passed to OccubuyScore.init().");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to create partner:", err);
  process.exit(1);
});
