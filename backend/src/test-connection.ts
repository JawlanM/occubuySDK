import { closeDb, findOne } from "./config/dataApi";
import { PARTNER_COLLECTION } from "./models/partner.model";

// harmless read - just proves MongoDB is reachable and configured correctly
findOne(PARTNER_COLLECTION, { partnerId: "__connection_test__" })
  .then(async () => {
    console.log("MongoDB reachable.");
    await closeDb();
    process.exit(0);
  })
  .catch((err) => {
    console.error("Connection failed:", err);
    process.exit(1);
  });
