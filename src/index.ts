export type OccubuyEnvironment = "sandbox" | "production";

export interface OccubuyScoreResult {
  status: "success";
  score: number;
  band: "strong" | "moderate" | "limited";
  verifiedAt: string;
}

export interface OccubuyCancelResult {
  status: "cancelled";
}

export interface OccubuyInitConfig {
  apiKey: string;
  environment?: OccubuyEnvironment;
  onComplete?: (result: OccubuyScoreResult) => void;
  onCancel?: (result: OccubuyCancelResult) => void;
}

export interface OccubuyScoreInstance {
  start: () => void;
}

// TODO: widget URL per environment (e.g. https://sdk.occubuy.com.au/widget/v1)

export function init(config: OccubuyInitConfig): OccubuyScoreInstance {
  if (!config?.apiKey) {
    throw new Error("[OccubuyScore] init() requires an apiKey.");
  }

  const resolved: Required<OccubuyInitConfig> = {
    environment: "sandbox",
    onComplete: () => {},
    onCancel: () => {},
    ...config,
  };

  function start(): void {
    // TODO (next tasks):
    // - render sandboxed iframe (see prototype)
    // - postMessage handshake + origin validation
    // - error / retry / abandonment states
    console.log("[OccubuyScore] start() called", resolved);
  }

  return { start };
}

// Expose as a browser global too, for the <script src> build target
if (typeof window !== "undefined") {
  (window as unknown as { OccubuyScore: { init: typeof init } }).OccubuyScore = { init };
}
