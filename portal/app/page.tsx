export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#F7F8FA] text-[#10151F]">
      <div className="mx-auto max-w-[760px] px-6 py-16">
        {/* Header */}
        <header className="mb-14">
          <div className="mb-4 h-2 w-8 rounded-full bg-[#0F62FE]" />
          <h1 className="text-3xl font-semibold tracking-tight">Occubuy Score API</h1>
          <p className="mt-3 text-[#5B6472] leading-relaxed">
            Everything a partner backend needs to create a renter score, hand off to
            FastLink, and receive the result, connect your platform to Occubuy without
            touching the scoring model itself.
          </p>
        </header>

        {/* Authentication */}
        <section className="mb-14">
          <h2 className="text-xl font-semibold mb-2">Authentication</h2>
          <p className="text-[#5B6472] leading-relaxed mb-6">
            Two credentials, two jobs. Your partner key identifies your platform and is
            safe to embed in your own page source. Your session token proves a specific
            request is allowed to touch one specific score
          </p>

          <ol className="space-y-4">
            {[
              {
                title: "Get your partner key",
                body: "Issued when your platform is approved. Send it as Authorization: Bearer <key> on the request that creates a score.",
              },
              {
                title: "Create a score",
                body: "The response includes a sessionToken, scoped to that one score.",
              },
              {
                title: "Use the session token for everything after",
                body: "Send it as X-Occubuy-Session on every call for that score, completing the bank connection, polling, sharing, or declining.",
              },
            ].map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0F62FE] text-xs font-medium text-white">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium">{step.title}</p>
                  <p className="text-sm text-[#5B6472] leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Endpoints */}
        <section className="mb-14">
          <h2 className="text-xl font-semibold mb-6">Endpoints</h2>

          <div className="space-y-8">
            <Endpoint
              method="POST"
              path="/scores"
              auth="Authorization: Bearer <partner key>"
              description="Registers a new score verification. Returns a session token and a FastLink session for the renter to connect their bank."
              request={`{
  "userId": "usr_9f2a1c",
  "applicant": { /* see integration guide for required fields */ }
}`}
              response={`{
  "scoreId": "6a8555cf11410758b44e311a",
  "sessionToken": "2efdd152...",
  "fastlinkSession": {
    "fastlinkUrl": "https://.../fastlink",
    "accessToken": "...",
    "configName": "Verification",
    "expiresAt": "2026-09-09T12:30:00.000Z"
  }
}`}
            />

            <Endpoint
              method="POST"
              path="/scores/{scoreId}/complete"
              auth="X-Occubuy-Session: <sessionToken>"
              description="Called once FastLink reports a successful bank connection. Moves the score into processing."
              request={`{
  "providerId": 16441,
  "providerAccountId": 11107612,
  "requestId": "req_abc123",
  "providerName": "Demo Bank",
  "status": "SUCCESS"
}`}
              response={`{ "status": "PROCESSING" }`}
            />

            <Endpoint
              method="GET"
              path="/scores/{scoreId}"
              auth="X-Occubuy-Session, or your partner key once the renter has shared"
              description="Poll until status is COMPLETED or FAILED. A partner key only returns a result after the renter explicitly shares."
              response={`{
  "status": "COMPLETED",
  "score": { "value": 742, "band": "Good" }
}`}
            />

            <Endpoint
              method="POST"
              path="/scores/{scoreId}/share"
              auth="X-Occubuy-Session: <sessionToken>"
              description="The renter's explicit consent to hand this score to your platform. Nothing is visible to your partner key before this."
              response={`{
  "score": 742,
  "band": "Good",
  "verifiedAt": "2026-09-09T12:31:00.000Z",
  "reference": "6a8555cf11410758b44e311a"
}`}
            />

            <Endpoint
              method="POST"
              path="/scores/{scoreId}/decline"
              auth="X-Occubuy-Session: <sessionToken>"
              description="The renter declines to share. A declined score can't later be shared."
              response={`{ "status": "declined" }`}
            />
          </div>
        </section>

        {/* Errors */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Error codes</h2>
          <div className="overflow-hidden rounded-lg border border-[#E1E4EA]">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["PARTNER_KEY_INVALID", "Missing or unrecognised partner key."],
                  ["SESSION_INVALID", "Session token missing, wrong, or expired."],
                  ["AUTH_REQUIRED", "Neither credential was valid for this request."],
                  ["SCORE_NOT_FOUND", "No score with this id, or one you're not allowed to see."],
                  ["INVALID_COMPLETE_PAYLOAD", "Missing providerAccountId, requestId, or status."],
                  ["INVALID_SCORE_STATE", "This action doesn't apply to the score's current status."],
                  ["NOT_SHARED", "The renter hasn't shared this score with you yet."],
                  ["ALREADY_DECLINED", "This score was already declined and can't be shared."],
                ].map(([code, meaning], i) => (
                  <tr key={code} className={i % 2 ? "bg-[#FBFBFC]" : ""}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[#0F62FE]">
                      {code}
                    </td>
                    <td className="px-4 py-3 text-[#5B6472]">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function Endpoint({
  method,
  path,
  auth,
  description,
  request,
  response,
}: {
  method: "GET" | "POST";
  path: string;
  auth: string;
  description: string;
  request?: string;
  response: string;
}) {
  const methodColor = method === "GET" ? "#0F62FE" : "#0E9F6E";

  return (
    <div className="border-l-2 pl-5" style={{ borderColor: methodColor }}>
      <div className="flex items-baseline gap-3">
        <span
          className="font-mono text-xs font-semibold"
          style={{ color: methodColor }}
        >
          {method}
        </span>
        <span className="font-mono text-sm">{path}</span>
      </div>
      <p className="mt-2 text-sm text-[#5B6472] leading-relaxed">{description}</p>
      <p className="mt-1 text-xs text-[#5B6472]">
        <span className="font-medium">Auth:</span> {auth}
      </p>

      {request && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-[#5B6472]">Request body</p>
          <pre className="overflow-x-auto rounded-md bg-[#0B1220] p-3 text-xs text-[#D6E4FF]">
            {request}
          </pre>
        </div>
      )}

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium text-[#5B6472]">Response</p>
        <pre className="overflow-x-auto rounded-md bg-[#0B1220] p-3 text-xs text-[#D6E4FF]">
          {response}
        </pre>
      </div>
    </div>
  );
}
