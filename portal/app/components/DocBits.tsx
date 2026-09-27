import type { ReactNode } from "react";
import type { DocEndpoint, DocRow, DocStep } from "../content/developerDocs";
import { DOCS_UPDATED } from "../content/developerDocs";

// The building blocks every docs page uses, so the pages themselves are just content.

export function DocPage({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen" style={{ background: "var(--bg-app)", color: "var(--text-primary)" }}>
      <div className="mx-auto max-w-[760px] px-6 py-16">
        <header className="mb-14">
          <div className="mb-4 h-2 w-8 rounded-full" style={{ background: "var(--accent)" }} />
          <h1 className="text-3xl tracking-tight" style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>
            {title}
          </h1>
          <p className="mt-3 leading-relaxed" style={{ color: "var(--text-body)" }}>
            {intro}
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Updated {DOCS_UPDATED}
          </p>
        </header>
        {children}
      </div>
    </main>
  );
}

export function DocSection({ title, intro, children, last = false }: { title: string; intro?: ReactNode; children?: ReactNode; last?: boolean }) {
  return (
    <section className={last ? undefined : "mb-14"}>
      <h2 className={`text-xl ${intro ? "mb-2" : "mb-4"}`} style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>
        {title}
      </h2>
      {intro ? (
        <p className="leading-relaxed mb-5" style={{ color: "var(--text-body)" }}>
          {intro}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function Steps({ steps }: { steps: DocStep[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={step.title} className="flex gap-4">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
            style={{ background: "var(--accent)", color: "var(--n900)", fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            {i + 1}
          </span>
          <div>
            <p style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>{step.title}</p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-body)" }}>
              {step.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DocTable({ rows, codeColour = "var(--brand-ink)", headers }: { rows: DocRow[]; codeColour?: string; headers?: string[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-default)" }}>
      <table className="w-full text-sm">
        {headers ? (
          <thead>
            <tr style={{ background: "var(--surface-sunken)" }}>
              {headers.map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs" style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--text-primary)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row, i) => (
            <tr key={row[0]} style={i % 2 ? { background: "var(--surface-sunken)" } : undefined}>
              <td className="whitespace-nowrap px-4 py-3 align-top font-mono text-xs" style={{ color: codeColour }}>
                {row[0]}
              </td>
              {row.slice(1).map((cell, j) => (
                <td key={j} className={`px-4 py-3 align-top ${row.length === 3 && j === 0 ? "font-mono text-xs" : ""}`} style={{ color: "var(--text-body)" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="mt-3">
      {label ? (
        <p className="mb-1 text-xs" style={{ color: "var(--text-body)", fontFamily: "var(--font-display)", fontWeight: 600 }}>
          {label}
        </p>
      ) : null}
      <pre className="overflow-x-auto rounded-md p-3 text-xs" style={{ background: "var(--n900)", color: "var(--n100)" }}>
        {children}
      </pre>
    </div>
  );
}

export function Notes({ notes, tint = false }: { notes: string[]; tint?: boolean }) {
  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <div
          key={note}
          className="rounded-md border px-4 py-3 text-sm leading-relaxed"
          style={{ borderColor: "var(--border-default)", background: tint ? "var(--accent-subtle)" : "var(--surface-card)", color: "var(--text-body)" }}
        >
          {note}
        </div>
      ))}
    </div>
  );
}

export function Endpoint({ endpoint }: { endpoint: DocEndpoint }) {
  const methodColour = endpoint.method === "GET" ? "var(--text-muted)" : "var(--brand-ink)";
  return (
    <div className="border-l-2 pl-5" style={{ borderColor: methodColour }}>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs font-semibold" style={{ color: methodColour }}>
          {endpoint.method}
        </span>
        <span className="font-mono text-sm">{endpoint.path}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-body)" }}>
        {endpoint.description}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-body)" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>Auth:</span> {endpoint.auth}
      </p>
      {endpoint.request ? <Code label="Request body">{endpoint.request}</Code> : null}
      <Code label="Response">{endpoint.response}</Code>
      {endpoint.errors?.length ? (
        <p className="mt-2 text-xs" style={{ color: "var(--text-body)" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>Errors:</span>{" "}
          <span className="font-mono">{endpoint.errors.join(", ")}</span>
        </p>
      ) : null}
    </div>
  );
}
