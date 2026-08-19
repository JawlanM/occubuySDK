import { findOne } from "./config/dataApi";
import { PARTNER_COLLECTION } from "./models/partner.model";

// harmless read - just proves the Data API is reachable and configured correctly
findOne(PARTNER_COLLECTION, { partnerId: "__connection_test__" })
  .then(() => {
    console.log("Data API reachable.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Connection failed:", err);
    process.exit(1);
  });
