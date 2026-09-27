import { app } from "./app";
import { connectDb } from "./config/dataApi";
import { isProduction } from "./utils/crypto";

const PORT = process.env.PORT ?? 8787;

// without a real pepper every key and session hash would use the public dev value
if (isProduction() && !process.env.OCCUBUY_HASH_PEPPER) {
  console.error("OCCUBUY_HASH_PEPPER must be set in production. Not starting.");
  process.exit(1);
}

// connect before taking traffic: if Atlas is unreachable the process exits, so Render keeps
// the previous deploy running instead of switching to one that fails every request
connectDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Occubuy backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Could not connect to MongoDB:", err);
    process.exit(1);
  });
