interface MetricLabels {
  [key: string]: string;
}

const counters = new Map<string, number>();

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

export function incrementCounter(
  name: string,
  labels: MetricLabels = {},
  amount = 1,
) {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + amount);
}

export function renderMetrics() {
  const lines = [
    "# HELP closetsearch_http_requests_total Completed HTTP requests.",
    "# TYPE closetsearch_http_requests_total counter",
  ];

  for (const [key, value] of Array.from(counters.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`${key} ${value}`);
  }

  return `${lines.join("\n")}\n`;
}

export function resetMetrics() {
  counters.clear();
}
