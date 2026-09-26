import Link from "next/link";

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
            The policy framing behind the consent flow, and what's still genuinely
            unresolved. For the mechanics themselves, what each screen shows, exactly
            what{" "}
            <code className="font-mono text-xs">/share</code> and{" "}
            <code className="font-mono text-xs">/decline</code> do — see{" "}
            <Link href="/flow" className="underline" style={{ color: "var(--brand-ink)" }}>
              SDK Flow
            </Link>{" "}
            and{" "}
            <Link href="/docs" className="underline" style={{ color: "var(--brand-ink)" }}>
              API Reference
            </Link>
            .
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
            at the API level: a partner's key only ever returns a result once the
            renter has shared, and ownership is checked unconditionally, so a partner
            can't even confirm a score exists for someone else's renter.
          </p>
        </section>

        {/* Revocation & retention - confirmed policy, but out of this project's surface */}
        <section className="mb-14">
          <h2
            className="text-xl mb-3"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            Revocation & retention
          </h2>
          <p className="leading-relaxed mb-4" style={{ color: "var(--text-body)" }}>
            Confirmed policy: a renter has up to <strong>12 months</strong> after
            sharing to revoke access or delete their score.
          </p>
          <div
            className="rounded-md border px-4 py-3 text-sm leading-relaxed"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--surface-card)",
              color: "var(--text-body)",
            }}
          >
            <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)", fontWeight: 600 }}>
              Out of scope for this SDK/backend:{" "}
            </span>
            revocation itself is performed through the Occubuy mobile app, not through
            any endpoint documented here. This team's web SDK and backend have no way
            to trigger, receive, or test a revocation, there is nothing to build or
            verify on this side of the integration for it.
          </div>
        </section>

        {/* Open questions - honest, the actual reason this page exists */}
        <section>
          <h2
            className="text-xl mb-3"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            Open questions — not yet specified
          </h2>
          <div className="space-y-3">
            {[
              "What happens at the 12-month mark itself: does the score/data get automatically deleted once the window closes, or does only the right to revoke expire while the data otherwise persists? Not yet specified either way.",
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
