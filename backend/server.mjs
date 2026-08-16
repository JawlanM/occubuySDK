// backend/server.mjs
//
// This is just a fake backend I made for the onboarding system demo, none of this is real.
// Scores are made up with Math.random, the auth is one hardcoded token so it's not
// actually secure, and everything lives in memory so restarting this file wipes it all.
//
// No npm packages needed, just run: node backend/server.mjs

import http from "node:http";
import crypto from "node:crypto";

// This is my "database", really it's just a plain JS object sitting in RAM.
// Every score gets stored here by its id, and it all disappears the second
// you stop the server with Ctrl+C.
const scores = {};

// This is the one fake password every request needs to send.
// The real version of this is POST /sdk/sessions, which isn't built yet on purpose.
const FAKE_TOKEN = "occubuy_dev_temp_token";

// Just reads the whole body off an incoming request
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

// Sends back a JSON response with the right headers
function sendJson(res, statusCode, obj) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    // Lets a page running on a different port actually call this server
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(obj));
}

// SERVER 1, running on port 8787. This has the 3 real score endpoints.
const apiServer = http.createServer(async (req, res) => {
  // Browsers send this "OPTIONS" request first just to check it's ok before the real one.
  // I just say yes and stop here, nothing else needs to happen.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST",
    });
    return res.end();
  }

  // Fake auth check that runs on every /api/ route
  const authHeader = req.headers["authorization"];
  if (req.url.startsWith("/api/") && authHeader !== `Bearer ${FAKE_TOKEN}`) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  // POST /api/scores, this kicks off a new verification
  if (req.method === "POST" && req.url === "/api/scores") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const scoreId = crypto.randomUUID();

    scores[scoreId] = {
      scoreId,
      userId: body.userId || "unknown",
      status: "PENDING",
      score: null,
    };

    console.log(`[scores] created ${scoreId} for user ${body.userId}`);

    return sendJson(res, 200, {
      scoreId,
      fastlinkSession: `fake-session-${scoreId}`,
    });
  }

  // POST /api/scores/:id/complete, this means the bank connection is done
  const completeMatch = req.url.match(/^\/api\/scores\/([^/]+)\/complete$/);
  if (req.method === "POST" && completeMatch) {
    const scoreId = completeMatch[1];
    const record = scores[scoreId];

    if (!record) return sendJson(res, 404, { error: "Not found" });

    record.status = "PROCESSING";
    console.log(`[scores] ${scoreId} marked PROCESSING`);

    return sendJson(res, 200, { status: record.status });
  }

  // GET /api/scores/:id, this is what gets polled to check the result
  const pollMatch = req.url.match(/^\/api\/scores\/([^/]+)$/);
  if (req.method === "GET" && pollMatch) {
    const scoreId = pollMatch[1];
    const record = scores[scoreId];

    if (!record) return sendJson(res, 404, { error: "Not found" });

    // The first time this gets polled after being marked PROCESSING, just
    // finish it right here. Kind of fakes the delay a real score calc would take.
    if (record.status === "PROCESSING") {
      record.status = "COMPLETED";
      record.score = Math.floor(Math.random() * 1000);
      console.log(`[scores] ${scoreId} COMPLETED with score ${record.score}`);
    }

    return sendJson(res, 200, {
      status: record.status,
      score: record.score,
    });
  }

  // Nothing matched any route above
  sendJson(res, 404, { error: "Not found" });
});

apiServer.listen(8787, () => {
  console.log("API server running on http://localhost:8787");
});

// SERVER 2, running on port 8788. This is the fake FastLink bank connection page.
// It only responds to POST on purpose, not GET, because that's actually how
// real Yodlee FastLink works too. It's a form POST target, not a page you just go to.
const fastlinkServer = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/fastlink") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found (this endpoint only accepts POST /fastlink)");
  }

  // Sends back a tiny fake "pick your bank" page. Clicking a button on it
  // sends a fake success message back to whatever embedded this page,
  // which is the SDK once it's built on Day 2.
  const html = `
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Fake FastLink</title></head>
<body style="font-family: sans-serif; padding: 24px;">
  <h3>Fake Bank Connection (demo only)</h3>
  <p>Pick a bank to simulate a successful connection:</p>
  <button onclick="sendSuccess('Commonwealth Bank')">Commonwealth Bank</button>
  <button onclick="sendSuccess('ANZ')">ANZ</button>

  <script>
    function sendSuccess(bankName) {
      // This shape is roughly what a real FastLink success event looks like.
      // The exact shape gets sorted out on Day 2 when porting the real
      // fastlink-events.ts over from the reference repo.
      window.parent.postMessage({
        type: "FastLink",
        event: "SUCCESS",
        data: { bank: bankName, accountId: "fake-account-123" }
      }, "*");
    }
  </script>
</body>
</html>`;

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
});

fastlinkServer.listen(8788, () => {
  console.log("Fake FastLink server running on http://localhost:8788");
});
