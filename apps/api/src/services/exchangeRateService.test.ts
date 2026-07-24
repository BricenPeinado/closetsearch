import { describe, expect, it } from "vitest";
import {
  convertMoneyWithQuote,
  ExchangeRateService,
  type ExchangeRateQuote,
} from "./exchangeRateService.js";

const quote: ExchangeRateQuote = {
  baseCurrency: "USD",
  fetchedAt: "2026-07-24T12:00:00.000Z",
  quoteCurrency: "EUR",
  rate: "0.91666667",
  source: "deterministic-fixture",
};

describe("exchangeRateService", () => {
  it("converts exact minor units with deterministic rounding and provenance", () => {
    expect(
      convertMoneyWithQuote(
        {
          amount: 180,
          amountMinor: 18_000,
          currency: "USD",
          fractionDigits: 2,
        },
        quote,
      ),
    ).toEqual({
      amount: 165,
      amountMinor: 16_500,
      currency: "EUR",
      exchangeRate: "0.91666667",
      exchangeRateSource: "deterministic-fixture",
      exchangeRateTimestamp: "2026-07-24T12:00:00.000Z",
      fractionDigits: 2,
      sourceAmountMinor: 18_000,
      sourceCurrency: "USD",
    });
  });

  it("handles target currencies without fractional minor units", () => {
    expect(
      convertMoneyWithQuote(
        {
          amount: 1,
          amountMinor: 100,
          currency: "USD",
          fractionDigits: 2,
        },
        {
          ...quote,
          quoteCurrency: "JPY",
          rate: "150.5",
        },
      ),
    ).toMatchObject({
      amount: 151,
      amountMinor: 151,
      currency: "JPY",
      fractionDigits: 0,
    });
  });

  it("uses fresh cache, then bounded stale cache on provider failure", async () => {
    let now = 1_000;
    let requestCount = 0;
    const service = new ExchangeRateService({
      cacheTtlMs: 100,
      maxStalenessMs: 1_000,
      now: () => now,
      provider: {
        async getRate() {
          requestCount += 1;

          if (requestCount > 1) {
            throw new Error("provider unavailable");
          }

          return quote;
        },
      },
    });
    const money = {
      amount: 180,
      amountMinor: 18_000,
      currency: "USD",
      fractionDigits: 2,
    };

    await expect(service.convert(money, "EUR")).resolves.toMatchObject({
      amountMinor: 16_500,
    });
    await expect(service.convert(money, "EUR")).resolves.toMatchObject({
      amountMinor: 16_500,
    });
    expect(requestCount).toBe(1);

    now += 200;
    await expect(service.convert(money, "EUR")).resolves.toMatchObject({
      amountMinor: 16_500,
    });
    expect(requestCount).toBe(2);

    now += 1_001;
    await expect(service.convert(money, "EUR")).resolves.toBeUndefined();
  });

  it("never relabels original money when conversion is unavailable", async () => {
    const service = new ExchangeRateService({
      provider: {
        async getRate() {
          return undefined;
        },
      },
    });

    await expect(
      service.convert(
        {
          amount: 100,
          amountMinor: 10_000,
          currency: "USD",
        },
        "EUR",
      ),
    ).resolves.toBeUndefined();
  });
});
