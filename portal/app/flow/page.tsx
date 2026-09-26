export default function FlowPage() {
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
                        SDK Flow
                    </h1>
                    <p className="mt-3 leading-relaxed" style={{ color: "var(--text-body)" }}>
                        What actually happens between <code className="font-mono text-sm">init()</code> and
                        a completed verification, useful once you're past the API reference and
                        need to know what your own page has to react to.
                    </p>
                </header>

                {/* Setup */}
                <section className="mb-14">
                    <h2
                        className="text-xl mb-3"
                        style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                    >
                        Before anything renders
                    </h2>
                    <p className="leading-relaxed mb-4" style={{ color: "var(--text-body)" }}>
                        Your page calls <code className="font-mono text-sm">OccubuyScore.init()</code> with
                        your API key, a container element, and an applicant object, whatever your
                        own form already collected. We never collect this data ourselves.
                    </p>
                    <pre
                        className="overflow-x-auto rounded-md p-3 text-xs"
                        style={{ background: "var(--n900)", color: "var(--n100)" }}
                    >
                        {`OccubuyScore.init({
  apiKey: "pk_sandbox_...",
  container: "#occubuy-widget",
  applicant: {
    fullName: "...",
    email: "...",
    phone: "...",
    dob: "...",
    address: "..."
  }
});`}
                    </pre>
                    <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-body)" }}>
                        <code className="font-mono">init()</code> only sets things up, nothing renders
                        until <code className="font-mono">.start()</code> is called.
                    </p>
                </section>

                {/* Sequence */}
                <section className="mb-14">
                    <h2
                        className="text-xl mb-6"
                        style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                    >
                        The sequence
                    </h2>
                    <ol className="space-y-5">
                        {[
                            {
                                title: "Consent screen",
                                body: "The first thing renders is not a score request. We own the wording; you can restyle colours but not edit the text. A legal-consent checkbox must be ticked before \"Verify\" even enables. Nothing hits our API before this.",
                            },
                            {
                                title: "POST /api/scores",
                                body: "Fires when the renter clicks Verify. The SDK generates its own userId (crypto.randomUUID()) — you don't supply one. Response includes scoreId, sessionToken, and a fastlinkSession.",
                            },
                            {
                                title: "FastLink opens",
                                body: "Two possible transports, chosen by the backend response: postMessage (a pre-built iframe, used for the mock provider and basic real flows) or yodleeJs (the official Yodlee widget — required for real bank connections, since Yodlee's own edge security blocks a hand-built form-post).",
                            },
                            {
                                title: "POST /api/scores/{id}/complete",
                                body: "Sent once the bank connection finishes, carrying provider info and a success/fail status.",
                            },
                            {
                                title: "Polling GET /api/scores/{id}",
                                body: "request is polled every 1.5s, until COMPLETED or FAILED, or the widget gives up with a timeout error.",
                            },
                            {
                                title: "Share or decline",
                                body: "The renter's explicit choice. A failed request never surfaces as an error to the renter. Once declined, sharing is locked out for that score permanently.",
                            },
                        ].map((step, i) => (
                            <li key={step.title} className="flex gap-4">
                                <span
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs text-white"
                                    style={{
                                        background: "var(--accent)",
                                        fontFamily: "var(--font-display)",
                                        fontWeight: 600,
                                    }}
                                >
                                    {i + 1}
                                </span>
                                <div>
                                    <p style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>
                                        {step.title}
                                    </p>
                                    <p className="text-sm leading-relaxed" style={{ color: "var(--text-body)" }}>
                                        {step.body}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </section>

                {/* Callbacks */}
                <section className="mb-14">
                    <h2
                        className="text-xl mb-2"
                        style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                    >
                        Callbacks your page reacts to
                    </h2>
                    <p className="leading-relaxed mb-4" style={{ color: "var(--text-body)" }}>
                        The API reference covers our backend traffic, this is what actually comes
                        back to <em>your</em> integration.
                    </p>
                    <div
                        className="overflow-hidden rounded-lg border"
                        style={{ borderColor: "var(--border-default)" }}
                    >
                        <table className="w-full text-sm">
                            <tbody>
                                {[
                                    ["onComplete", "The renter shared a completed score with you."],
                                    ["onCancel", "The renter closed the widget before finishing."],
                                    ["onDecline", "The renter explicitly chose not to share."],
                                    ["onError", "Something failed — see error codes below."],
                                ].map(([name, meaning], i) => (
                                    <tr
                                        key={name}
                                        style={i % 2 ? { background: "var(--surface-sunken)" } : undefined}
                                    >
                                        <td
                                            className="whitespace-nowrap px-4 py-3 font-mono text-xs"
                                            style={{ color: "var(--brand-ink)" }}
                                        >
                                            {name}
                                        </td>
                                        <td className="px-4 py-3" style={{ color: "var(--text-body)" }}>
                                            {meaning}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* SDK error codes */}
                <section className="mb-14">
                    <h2
                        className="text-xl mb-2"
                        style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                    >
                        SDK error codes
                    </h2>
                    <p className="leading-relaxed mb-4" style={{ color: "var(--text-body)" }}>
                        Different from the backend's own error codes on the API Reference tab,
                        these are what <code className="font-mono text-sm">onError</code> receives, and
                        each one stops the flow where it is.
                    </p>
                    <div
                        className="overflow-hidden rounded-lg border"
                        style={{ borderColor: "var(--border-default)" }}
                    >
                        <table className="w-full text-sm">
                            <tbody>
                                {[
                                    ["INVALID_APPLICANT", "The applicant object passed to init() was incomplete or malformed."],
                                    ["START_FAILED", "POST /api/scores itself failed or returned something unexpected."],
                                    ["BANK_CONNECTION_FAILED", "FastLink reported a failed connection."],
                                    ["POLL_FAILED", "A polling request errored."],
                                    ["POLL_TIMEOUT", "Score never completed within the ~60s polling window."],
                                    ["SHARE_FAILED", "The share request failed."],
                                ].map(([code, meaning], i) => (
                                    <tr
                                        key={code}
                                        style={i % 2 ? { background: "var(--surface-sunken)" } : undefined}
                                    >
                                        <td
                                            className="whitespace-nowrap px-4 py-3 font-mono text-xs"
                                            style={{ color: "var(--danger)" }}
                                        >
                                            {code}
                                        </td>
                                        <td className="px-4 py-3" style={{ color: "var(--text-body)" }}>
                                            {meaning}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Prerequisites */}
                <section className="mb-14">
                    <h2
                        className="text-xl mb-3"
                        style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                    >
                        Before you integrate
                    </h2>
                    <ul className="space-y-2 text-sm leading-relaxed" style={{ color: "var(--text-body)" }}>
                        <li>
                            <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)", fontWeight: 600 }}>
                                CORS:{" "}
                            </span>
                            your site's origin must be added to <code className="font-mono">ALLOWED_ORIGINS</code>{" "}
                            on our backend, or the browser blocks the calls outright.
                        </li>
                        <li>
                            <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)", fontWeight: 600 }}>
                                API key:{" "}
                            </span>
                            generated through the partner portal, not this reference, the portal pushes
                            it straight to our backend, so it's ready to use immediately after generation.
                        </li>
                    </ul>
                </section>

                {/* Known issues - honest, not hidden */}
                <section>
                    <h2
                        className="text-xl mb-3"
                        style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                    >
                        Known issues
                    </h2>
                    <div className="space-y-3">
                        {[
                            "The score band shown is currently recomputed locally by the widget rather than using the band our backend actually returns — an inconsistency, not intentional behaviour.",
                            "GET /partners/config exists on the backend but isn't called by the SDK yet, branding currently comes entirely from what you pass into init(). Available, not yet wired up.",
                            "Some Yodlee sandbox providers open a new browser tab instead of staying in the iframe, even with forceIframe set. Open item, not yet resolved.",
                            "Scores are currently randomly generated — there's no real scoring engine wired up yet. This is a known placeholder, not a bug to report.",
                        ].map((note) => (
                            <div
                                key={note}
                                className="rounded-md border px-4 py-3 text-sm leading-relaxed"
                                style={{
                                    borderColor: "var(--border-default)",
                                    background: "var(--surface-card)",
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
