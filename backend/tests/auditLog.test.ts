import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/config/dataApi", () => ({
  insertOne: vi.fn(),
}));

import * as dataApi from "../src/config/dataApi";
import { logEvent } from "../src/utils/auditLog";
import { PARTNER_EVENT_COLLECTION } from "../src/models/partnerEvent.model";

beforeEach(() => {
  vi.mocked(dataApi.insertOne).mockReset();
});

describe("logEvent", () => {
  it("writes to the partnerEvents collection with the given fields", async () => {
    vi.mocked(dataApi.insertOne).mockResolvedValue("event-1");

    logEvent("score.shared", { partnerId: "partner-1", scoreId: "score-1" });
    await Promise.resolve(); // let the fire-and-forget promise settle

    expect(dataApi.insertOne).toHaveBeenCalledWith(
      PARTNER_EVENT_COLLECTION,
      expect.objectContaining({
        eventType: "score.shared",
        partnerId: "partner-1",
        scoreId: "score-1",
      })
    );
  });

  it("does not throw when the write fails", async () => {
    vi.mocked(dataApi.insertOne).mockRejectedValue(new Error("db unreachable"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => logEvent("auth.session_invalid", { scoreId: "score-2" })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
