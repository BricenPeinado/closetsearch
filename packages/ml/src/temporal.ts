import { toTimestamp } from "./deterministic.js";
import type { TemporalBoundaries, TemporalSplit } from "./types.js";

export interface TemporalSplitValidation {
  valid: boolean;
  violations: string[];
}

function validateBoundaries(boundaries: TemporalBoundaries) {
  const trainEnd = toTimestamp(boundaries.trainEndExclusive, "trainEndExclusive");
  const validationEnd = toTimestamp(
    boundaries.validationEndExclusive,
    "validationEndExclusive",
  );

  if (trainEnd >= validationEnd) {
    throw new Error("trainEndExclusive must be earlier than validationEndExclusive.");
  }

  return {
    trainEnd,
    validationEnd,
  };
}

export function createTemporalSplit<T>(
  rows: T[],
  getTimestamp: (row: T) => string,
  boundaries: TemporalBoundaries,
): TemporalSplit<T> {
  const { trainEnd, validationEnd } = validateBoundaries(boundaries);
  const sortedRows = [...rows].sort((left, right) => {
    const timestampDelta =
      toTimestamp(getTimestamp(left), "row timestamp") -
      toTimestamp(getTimestamp(right), "row timestamp");

    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
  const split: TemporalSplit<T> = {
    train: [],
    validation: [],
    test: [],
  };

  for (const row of sortedRows) {
    const timestamp = toTimestamp(getTimestamp(row), "row timestamp");

    if (timestamp < trainEnd) {
      split.train.push(row);
    } else if (timestamp < validationEnd) {
      split.validation.push(row);
    } else {
      split.test.push(row);
    }
  }

  return split;
}

export function validateTemporalIsolation<T>(
  split: TemporalSplit<T>,
  getTimestamp: (row: T) => string,
  getId: (row: T) => string,
): TemporalSplitValidation {
  const violations: string[] = [];
  const partitions = [
    ["train", split.train],
    ["validation", split.validation],
    ["test", split.test],
  ] as const;
  const partitionById = new Map<string, string>();

  for (const [partition, rows] of partitions) {
    for (const row of rows) {
      const id = getId(row);
      const previousPartition = partitionById.get(id);

      if (previousPartition && previousPartition !== partition) {
        violations.push(`${id} appears in both ${previousPartition} and ${partition}.`);
      }

      partitionById.set(id, partition);
    }
  }

  const maxTrain = Math.max(
    ...split.train.map((row) => toTimestamp(getTimestamp(row), "train timestamp")),
    Number.NEGATIVE_INFINITY,
  );
  const minValidation = Math.min(
    ...split.validation.map((row) => toTimestamp(getTimestamp(row), "validation timestamp")),
    Number.POSITIVE_INFINITY,
  );
  const maxValidation = Math.max(
    ...split.validation.map((row) => toTimestamp(getTimestamp(row), "validation timestamp")),
    Number.NEGATIVE_INFINITY,
  );
  const minTest = Math.min(
    ...split.test.map((row) => toTimestamp(getTimestamp(row), "test timestamp")),
    Number.POSITIVE_INFINITY,
  );

  if (maxTrain >= minValidation) {
    violations.push("Training timestamps overlap or follow validation timestamps.");
  }

  if (maxValidation >= minTest) {
    violations.push("Validation timestamps overlap or follow test timestamps.");
  }

  if (split.train.length === 0 || split.validation.length === 0 || split.test.length === 0) {
    violations.push("Train, validation, and test partitions must all be non-empty.");
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

export function assertTemporalIsolation<T>(
  split: TemporalSplit<T>,
  getTimestamp: (row: T) => string,
  getId: (row: T) => string,
) {
  const validation = validateTemporalIsolation(split, getTimestamp, getId);

  if (!validation.valid) {
    throw new Error(`Temporal leakage validation failed: ${validation.violations.join(" ")}`);
  }
}
