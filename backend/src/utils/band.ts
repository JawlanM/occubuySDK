// The one set of score bands (decided 26 Sep: keep the SDK's). Same cutoffs as scoreToBand() in
// the widget (src/index.ts), so what the renter sees, what onComplete returns, what the partner
// reads from GET /scores/:id and what lands in the portal all agree. Change both together.
export type ScoreBand = "strong" | "moderate" | "limited";

export function scoreBand(value: number): ScoreBand {
  if (value >= 700) return "strong";
  if (value >= 400) return "moderate";
  return "limited";
}
