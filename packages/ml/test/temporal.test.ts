import { describe, expect, it } from "vitest";
import {
  createTemporalSplit,
  validateTemporalIsolation,
} from "../src/temporal.js";

describe("temporal dataset isolation", () => {
  const boundaries = {
    trainEndExclusive: "2026-02-01T00:00:00.000Z",
    validationEndExclusive: "2026-03-01T00:00:00.000Z",
  };

  it("keeps rows sharing a timestamp in the same partition", () => {
    const rows = [
      { id: "train-1", at: "2026-01-15T00:00:00.000Z" },
      { id: "train-2", at: "2026-01-15T00:00:00.000Z" },
      { id: "validation", at: "2026-02-15T00:00:00.000Z" },
      { id: "test", at: "2026-03-15T00:00:00.000Z" },
    ];
    const split = createTemporalSplit(rows, (row) => row.at, boundaries);

    expect(split.train.map((row) => row.id)).toEqual(["train-1", "train-2"]);
    expect(
      validateTemporalIsolation(
        split,
        (row) => row.at,
        (row) => row.id,
      ),
    ).toEqual({
      valid: true,
      violations: [],
    });
  });

  it("detects duplicate row identities crossing partitions", () => {
    const validation = validateTemporalIsolation(
      {
        train: [{ id: "duplicate", at: "2026-01-01T00:00:00.000Z" }],
        validation: [
          { id: "duplicate", at: "2026-02-01T00:00:00.000Z" },
        ],
        test: [{ id: "test", at: "2026-03-01T00:00:00.000Z" }],
      },
      (row) => row.at,
      (row) => row.id,
    );

    expect(validation.valid).toBe(false);
    expect(validation.violations.join(" ")).toContain("appears in both");
  });
});
