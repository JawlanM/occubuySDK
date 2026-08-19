import { connectDB } from "./config/db";
import { app } from "./app";

const PORT = process.env.PORT ?? 8787; 
async function main() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Occubuy backend listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});