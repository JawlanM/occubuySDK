"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/docs", label: "API Reference" },
  { href: "/flow", label: "SDK Flow" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav
      className="border-b"
      style={{ borderColor: "var(--border-default)", background: "var(--surface-card)" }}
    >
      <div className="mx-auto flex max-w-[760px] items-center gap-1 px-6">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="relative px-3 py-4 text-sm transition-colors"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                color: active ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {tab.label}
              {active && (
                <span
                  className="absolute inset-x-3 bottom-0 h-0.5"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
