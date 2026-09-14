import { Router, Request, Response } from "express";
import { randomUUID, randomInt } from "crypto";

// Fake bank-connection picker - not real Yodlee, but speaks FastLink 4's real message
// envelope ({type:"POST_MESSAGE", data:{sites:[...]}}, success then a separate exit
// message) so the SDK's real Yodlee-shaped parsing (src/fastlink/) runs against this
// unmodified. Swapping in a real provider later is a session-source change, not a
// SDK-side protocol change.
export const fastlinkRouter = Router();

fastlinkRouter.post("/fastlink", (_req: Request, res: Response) => {
  const html = `
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Fake FastLink</title></head>
<body style="font-family: sans-serif; padding: 24px;">
  <h3>Fake Bank Connection (demo only)</h3>
  <p>Pick a bank to simulate a successful connection:</p>
  <button onclick="linkBank('Test Bank A', 16441)">Test Bank A</button>
  <button onclick="linkBank('Test Bank B', 16442)">Test Bank B</button>
  <button onclick="cancelLink()">Cancel</button>

  <script>
    function site(providerName, providerId) {
      return {
        providerId: providerId,
        providerName: providerName,
        requestId: "${randomUUID()}",
        status: "SUCCESS",
        additionalStatus: "ACCT_SUMMARY_RECEIVED",
        providerAccountId: ${randomInt(10_000_000, 99_999_999)},
        fnToCall: "accountStatus"
      };
    }
    function post(envelope) {
      window.parent.postMessage(envelope, "*");
    }
    function linkBank(providerName, providerId) {
      var linked = site(providerName, providerId);
      // Real FastLink reports the success site and the exit message separately, in
      // non-deterministic order - that's what FastLinkFlowState (src/fastlink/) exists
      // to handle on the SDK side, so this mock exercises the real ordering.
      post({ type: "POST_MESSAGE", data: { sites: [linked] } });
      post({ type: "POST_MESSAGE", data: { action: "exit", sites: [linked] } });
    }
    function cancelLink() {
      post({ type: "POST_MESSAGE", data: { action: "exit", sites: [] } });
    }
  </script>
</body>
</html>`;

  res.status(200).type("html").send(html);
});
