// Re-pushes every shared score the portal never confirmed as a lead. Same thing as
// POST /api/internal/leads/retry, for running by hand with this backend's .env.
// Usage: npm run leads:retry
import { retryPendingLeadPushes } from "../services/leadPush";

retryPendingLeadPushes()
  .then((result) => {
    console.log("Lead push retry:", result);
    process.exit(result.failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error("Lead push retry failed:", error);
    process.exit(1);
  });
