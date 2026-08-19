import { Router, Request, Response } from "express";
import { randomUUID, randomInt } from "crypto";

// same fake bank picker that used to live in server.mjs, just moved here so there's one
// server instead of two. still not real FastLink, we're keeping it fake for now
export const fastlinkRouter = Router();

fastlinkRouter.post("/fastlink", (_req: Request, res: Response) => {
  const html = `
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Fake FastLink</title></head>
<body style="font-family: sans-serif; padding: 24px;">
  <h3>Fake Bank Connection (demo only)</h3>
  <p>Pick a bank to simulate a successful connection:</p>
  <button onclick="sendSuccess('Commonwealth Bank', 16441)">Commonwealth Bank</button>
  <button onclick="sendSuccess('ANZ', 16442)">ANZ</button>

  <script>
    function sendSuccess(bankName, providerId) {
      // this shape has to match what /complete expects in scores.routes.ts
      window.parent.postMessage({
        type: "FastLink",
        event: "SUCCESS",
        data: {
          providerId: providerId,
          providerAccountId: ${randomInt(10_000_000, 99_999_999)},
          requestId: "${randomUUID()}",
          providerName: bankName,
          status: "SUCCESS"
        }
      }, "*");
    }
  </script>
</body>
</html>`;

  res.status(200).type("html").send(html);
});
