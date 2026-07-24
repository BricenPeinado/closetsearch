import { afterEach, describe, expect, it } from "vitest";
import {
  clearGaugeFamily,
  incrementCounter,
  observeHistogram,
  renderMetrics,
  resetMetrics,
  setGauge,
} from "./metrics.js";

describe("runtime metrics", () => {
  afterEach(() => {
    resetMetrics();
  });

  it("renders escaped counters, gauges, and cumulative histograms", () => {
    incrementCounter("closetsearch_provider_requests_total", {
      outcome: "success",
      provider: 'fixture-"safe"',
    });
    setGauge("closetsearch_database_pool_connections", { state: "idle" }, 2);
    observeHistogram(
      "closetsearch_provider_request_duration_ms",
      { provider: "fixture" },
      30,
      [10, 50],
    );
    observeHistogram(
      "closetsearch_provider_request_duration_ms",
      { provider: "fixture" },
      5,
      [10, 50],
    );

    const output = renderMetrics();

    expect(output).toContain(
      'closetsearch_provider_requests_total{outcome="success",provider="fixture-\\"safe\\""} 1',
    );
    expect(output).toContain("# TYPE closetsearch_provider_requests_total counter");
    expect(output).toContain('closetsearch_database_pool_connections{state="idle"} 2');
    expect(output).toContain("# TYPE closetsearch_database_pool_connections gauge");
    expect(output).toContain(
      'closetsearch_provider_request_duration_ms_bucket{le="10",provider="fixture"} 1',
    );
    expect(output).toContain(
      'closetsearch_provider_request_duration_ms_bucket{le="50",provider="fixture"} 2',
    );
    expect(output).toContain(
      'closetsearch_provider_request_duration_ms_bucket{le="+Inf",provider="fixture"} 2',
    );
    expect(output).toContain(
      'closetsearch_provider_request_duration_ms_sum{provider="fixture"} 35',
    );
  });

  it("ignores invalid observations and gauges", () => {
    observeHistogram("invalid_histogram", {}, Number.NaN);
    setGauge("invalid_gauge", {}, Number.POSITIVE_INFINITY);
    incrementCounter("invalid_counter", {}, -1);

    expect(renderMetrics()).not.toContain("invalid_histogram");
    expect(renderMetrics()).not.toContain("invalid_gauge");
    expect(renderMetrics()).not.toContain("invalid_counter");
  });

  it("clears stale gauge families and keeps histogram buckets consistent by metric name", () => {
    setGauge("provider_health", { provider: "removed" }, 1);
    setGauge("unrelated_gauge", {}, 2);
    clearGaugeFamily("provider_health");
    observeHistogram("request_latency", { route: "feed" }, 15, [10, 20]);
    observeHistogram("request_latency", { route: "search" }, 15, [5, 25]);

    const output = renderMetrics();

    expect(output).not.toContain("provider_health");
    expect(output).toContain("unrelated_gauge 2");
    expect(output).toContain('request_latency_bucket{le="20",route="search"} 1');
    expect(output).not.toContain('request_latency_bucket{le="25"');
  });
});
