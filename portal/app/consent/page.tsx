export default function ConsentPage() {
  return (
    <main
      className="min-h-screen"
      style={{ background: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      <div className="mx-auto max-w-[760px] px-6 py-16">
        <header className="mb-14">
          <div
            className="mb-4 h-2 w-8 rounded-full"
            style={{ background: "var(--accent)" }}
          />
          <h1
            className="text-3xl tracking-tight"
            style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
          >
            Consent & Data
          </h1>
          <p className="mt-3 leading-relaxed" style={{ color: "var(--text-body)" }}>
            What a renter sees, what a partner can and can't access, and exactly when
            each becomes true.
          </p>
        </header>

        {/* Principle */}
        <section className="mb-14">
          <h2
            className="text-xl mb-3"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            The principle
          </h2>
          <p className="leading-relaxed" style={{ color: "var(--text-body)" }}>
            Nothing crosses to a partner without an explicit renter action. A completed
            score is visible to the renter the moment it's ready, it is not visible to
            the partner until the renter actively chooses to share it. This is enforced
            at the API level.
          </p>
        </section>

        {/* Before consent */}
        <section className="mb-14">
          <h2
            className="text-xl mb-3"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            Before consent
          </h2>
          <ul className="space-y-2 text-sm leading-relaxed" style={{ color: "var(--text-body)" }}>
            <li>
              <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)", fontWeight: 600 }}>
                Applicant data:{" "}
              </span>
              collected entirely by the partner's own form, before the widget ever
              renders. We never collect this ourselves, it's passed into{" "}
              <code className="font-mono text-xs">init()</code>.
            </li>
            <li>
              <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)", fontWeight: 600 }}>
                The consent screen:{" "}
              </span>
              the first thing rendered is not a score request. We own the wording; a
              partner can restyle colours but cannot edit the text. An explicit
              legal-consent checkbox has to be ticked before "Verify" even enables.
              Nothing hits our API before this point.
            </li>
          </ul>
        </section>

        {/* At consent */}
        <section className="mb-14">
          <h2
            className="text-xl mb-3"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            Seeing the result, then deciding
          </h2>
          <p className="leading-relaxed mb-4" style={{ color: "var(--text-body)" }}>
            The renter sees their own completed score first. Sharing it with the
            partner is a separate, never automatic.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div
              className="rounded-lg border p-4"
              style={{ borderColor: "var(--border-default)", background: "var(--surface-card)" }}
            >
              <p style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--success)" }}>
                Share
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-body)" }}>
                Returns the score, band, timestamp, and a reference to the partner.
                Best-effort push to the partner's own portal as a lead, if that push
                fails, it never affects what the renter sees.
              </p>
            </div>
            <div
              className="rounded-lg border p-4"
              style={{ borderColor: "var(--border-default)", background: "var(--surface-card)" }}
            >
              <p style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--danger)" }}>
                Decline
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-body)" }}>
                Even if the request fails, the renter
                still sees it go through locally. Declining never surfaces as an error
                to them. Permanent: once declined, sharing is locked out for that score
                for good.
              </p>
            </div>
          </div>
        </section>

        {/* What partners can see */}
        <section className="mb-14">
          <h2
            className="text-xl mb-3"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            What a partner can actually access
          </h2>
          <p className="leading-relaxed" style={{ color: "var(--text-body)" }}>
            A partner's key only ever returns a result once the renter has shared,
            attempting to read a score before that returns "not shared," not the data
            itself. Ownership is checked unconditionally: if a score doesn't belong to
            the partner asking, the response is a plain 404, not a 403. So a partner
            can't even confirm a score exists for someone else's renter, let alone read it.
          </p>
        </section>

        {/* Open questions - honest */}
        <section>
          <h2
            className="text-xl mb-3"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            Open questions, not yet built
          </h2>
          <div className="space-y-3">
            {[
              "Revocation after sharing: once a score has been shared and the partner has it, there is currently no way for a renter to withdraw that access later. No endpoint exists for this today, it's an open design question, not an implemented feature.",
              "Data retention: how long a renter's score or bank-connection data is kept has not been specified. Nothing currently expires or auto-deletes this data.",
            ].map((note) => (
              <div
                key={note}
                className="rounded-md border px-4 py-3 text-sm leading-relaxed"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--accent-subtle)",
                  color: "var(--text-body)",
                }}
              >
                {note}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
