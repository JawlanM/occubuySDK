// stand-in for the portal's "issue a key" screen since that doesn't exist yet
// run: npm run seed:partner (from backend/)
// running it again won't duplicate the partner, but it also won't reprint the key -
// delete the doc first if you actually need a new one
import { connectDB } from "../config/db";
import { Partner } from "../models/partner.model";
import { generateApiKey } from "../utils/crypto";

const PARTNER_ID = process.argv[2] ?? "jmrealestate";
const LEGAL_NAME = process.argv[3] ?? "JM Realestate Pty Ltd";

async function main(): Promise<void> {
  await connectDB();

  const existing = await Partner.findOne({ partnerId: PARTNER_ID });
  if (existing) {
    console.log(`Partner "${PARTNER_ID}" already exists (apiKeyPrefix: ${existing.apiKeyPrefix}).`);
    console.log("The full key is never stored, so it can't be reprinted - delete this partner doc and re-run to rotate.");
    process.exit(0);
  }

  const { fullKey, prefix, hash } = generateApiKey(PARTNER_ID);
  const now = new Date();

  await Partner.create({
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
