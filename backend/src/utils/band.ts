// The one set of score bands (decided 26 Sep: the partner portal's five names, 200-point steps).
// Same cutoffs as scoreToBand() in the widget (src/index.ts), so what the renter sees, what
// onComplete returns, what the partner reads from GET /scores/:id and what lands in the portal
// all agree. Change both together.
export type ScoreBand = "Excellent" | "Very Good" | "Good" | "Fair" | "Poor";

export function scoreBand(value: number): ScoreBand {
  if (value >= 800) return "Excellent";
  if (value >= 600) return "Very Good";
  if (value >= 400) return "Good";
  if (value >= 200) return "Fair";
  return "Poor";
}
