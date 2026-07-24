interface MetricLabels {
  [key: string]: string;
}

interface MetricState {
  labels: MetricLabels;
  name: string;
  value: number;
}

interface HistogramState {
  buckets: number[];
  counts: number[];
  count: number;
  labels: MetricLabels;
  name: string;
  sum: number;
}

const counters = new Map<string, MetricState>();
const gauges = new Map<string, MetricState>();
const histograms = new Map<string, HistogramState>();
const histogramBuckets = new Map<string, number[]>();
const defaultLatencyBucketsMs = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];

function escapeLabel(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function metricKey(name: string, labels: MetricLabels) {
  const serializedLabels = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(",");

  return serializedLabels ? `${name}{${serializedLabels}}` : name;
}

export function incrementCounter(name: string, labels: MetricLabels = {}, amount = 1) {
  if (!Number.isFinite(amount) || amount < 0) {
    return;
  }

  const key = metricKey(name, labels);
  const existing = counters.get(key);
  counters.set(key, {
    labels: { ...labels },
    name,
    value: (existing?.value ?? 0) + amount,
  });
}

export function setGauge(name: string, labels: MetricLabels = {}, value: number) {
  if (!Number.isFinite(value)) {
    return;
  }

  gauges.set(metricKey(name, labels), {
    labels: { ...labels },
    name,
    value,
  });
}

export function clearGaugeFamily(name: string) {
  for (const [key, gauge] of gauges) {
    if (gauge.name === name) {
      gauges.delete(key);
    }
  }
}

export function observeHistogram(
  name: string,
  labels: MetricLabels,
  value: number,
  buckets: number[] = defaultLatencyBucketsMs,
) {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }

  const normalizedBuckets = Array.from(
    new Set(
      buckets
        .filter((bucket) => Number.isFinite(bucket) && bucket >= 0)
        .sort((left, right) => left - right),
    ),
  );
  const familyBuckets = histogramBuckets.get(name) ?? normalizedBuckets;
  histogramBuckets.set(name, familyBuckets);
  const key = metricKey(name, labels);
  const existing = histograms.get(key);
  const histogram = existing
    ? existing
    : {
        buckets: familyBuckets,
        counts: familyBuckets.map(() => 0),
        count: 0,
        labels: { ...labels },
        name,
        sum: 0,
      };

  histogram.count += 1;
  histogram.sum += value;
  histogram.buckets.forEach((upperBound, index) => {
    if (value <= upperBound) {
      histogram.counts[index] = (histogram.counts[index] ?? 0) + 1;
    }
  });
  histograms.set(key, histogram);
}

function appendMetricStates(
  lines: string[],
  states: Iterable<MetricState>,
  type: "counter" | "gauge",
) {
  const byName = new Map<string, MetricState[]>();

  for (const state of states) {
    const family = byName.get(state.name) ?? [];
    family.push(state);
    byName.set(state.name, family);
  }

  for (const [name, family] of Array.from(byName.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`# HELP ${name} ClosetSearch runtime ${type}.`, `# TYPE ${name} ${type}`);
    for (const state of family.sort((left, right) =>
      metricKey(left.name, left.labels).localeCompare(metricKey(right.name, right.labels)),
    )) {
      lines.push(`${metricKey(state.name, state.labels)} ${state.value}`);
    }
  }
}

export function renderMetrics() {
  const lines: string[] = [];

  appendMetricStates(lines, counters.values(), "counter");
  appendMetricStates(lines, gauges.values(), "gauge");

  const histogramNames = Array.from(
    new Set(Array.from(histograms.values(), (histogram) => histogram.name)),
  ).sort();

  for (const name of histogramNames) {
    lines.push(`# HELP ${name} Bounded runtime latency distribution.`, `# TYPE ${name} histogram`);
    const family = Array.from(histograms.values())
      .filter((histogram) => histogram.name === name)
      .sort((left, right) =>
        metricKey(left.name, left.labels).localeCompare(metricKey(right.name, right.labels)),
      );

    for (const histogram of family) {
      histogram.buckets.forEach((upperBound, index) => {
        lines.push(
          `${metricKey(`${histogram.name}_bucket`, {
            ...histogram.labels,
            le: String(upperBound),
          })} ${histogram.counts[index] ?? 0}`,
        );
      });
      lines.push(
        `${metricKey(`${histogram.name}_bucket`, {
          ...histogram.labels,
          le: "+Inf",
        })} ${histogram.count}`,
        `${metricKey(`${histogram.name}_sum`, histogram.labels)} ${histogram.sum}`,
        `${metricKey(`${histogram.name}_count`, histogram.labels)} ${histogram.count}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function resetMetrics() {
  counters.clear();
  gauges.clear();
  histograms.clear();
  histogramBuckets.clear();
}
