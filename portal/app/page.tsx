import Link from "next/link";

export default function HomePage() {
  return (
    <main
      className="min-h-screen flex items-center"
      style={{ background: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      <div className="mx-auto max-w-[760px] px-6 py-16 text-center">
        <div
          className="mx-auto mb-6 h-2 w-8 rounded-full"
          style={{ background: "var(--accent)" }}
        />
        <h1
          className="text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
        >
          Occubuy Developer Portal
        </h1>
        <p className="mt-3 leading-relaxed" style={{ color: "var(--text-body)" }}>
          Everything a partner developer needs to connect to the Occubuy Score SDK.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link
            href="/docs"
            className="rounded-lg border p-6 text-left transition-colors"
            style={{ borderColor: "var(--border-default)", background: "var(--surface-card)" }}
          >
            <p style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>API Reference</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-body)" }}>
              Endpoints, auth, request/response shapes, error codes.
            </p>
          </Link>
          <Link
            href="/flow"
            className="rounded-lg border p-6 text-left transition-colors"
            style={{ borderColor: "var(--border-default)", background: "var(--surface-card)" }}
          >
            <p style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>SDK Flow</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-body)" }}>
              The full widget lifecycle, callbacks, and known issues.
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
