import { app } from "./app";
import { connectDb } from "./config/dataApi";

const PORT = process.env.PORT ?? 8787;

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
