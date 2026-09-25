// Widget colours a partner sets in the portal (dev plan P5). Same field names as the widget's
// OccubuyBranding (src/index.ts), so what's stored here is passed straight through.
export type WidgetBranding = {
  primaryColor?: string;
  primaryColorDark?: string;
  headingColor?: string;
};

const FIELDS = ["primaryColor", "primaryColorDark", "headingColor"] as const;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// {} or null = "back to Occubuy's colours". Anything that isn't a hex colour is rejected
// outright - these values end up as CSS on the partner's page.
export function normalizeBranding(value: unknown): WidgetBranding | null {
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !(FIELDS as readonly string[]).includes(key))) return null;
  const branding: WidgetBranding = {};
  for (const field of FIELDS) {
    const colour = input[field];
    if (colour === undefined || colour === "") continue;
    if (typeof colour !== "string" || !HEX.test(colour)) return null;
    branding[field] = colour.toLowerCase();
  }
  return branding;
}
