import type { ConvertedMoney, Listing, Money } from "@closetsearch/shared";

export interface ExchangeRateQuote {
  baseCurrency: string;
  fetchedAt: string;
  quoteCurrency: string;
  rate: string;
  source: string;
}

export interface ExchangeRateProvider {
  getRate(
    baseCurrency: string,
    quoteCurrency: string,
  ): Promise<ExchangeRateQuote | undefined>;
}

export interface ExchangeRateServiceOptions {
  cacheTtlMs?: number;
  maxStalenessMs?: number;
  now?: () => number;
  provider: ExchangeRateProvider;
}

interface CachedRate {
  cachedAt: number;
  quote: ExchangeRateQuote;
}

const defaultCacheTtlMs = 60 * 60 * 1_000;
const defaultMaxStalenessMs = 36 * 60 * 60 * 1_000;

const currencyFractionDigits: Record<string, number> = {
  BHD: 3,
  CLP: 0,
  IQD: 3,
  JPY: 0,
  JOD: 3,
  KRW: 0,
  KWD: 3,
  OMR: 3,
  TND: 3,
  VND: 0,
};

function normalizeCurrency(value: string) {
  return value.trim().toUpperCase();
}

function fractionDigitsForCurrency(currency: string) {
  return currencyFractionDigits[normalizeCurrency(currency)] ?? 2;
}

function parsePositiveDecimal(value: string) {
  const normalizedValue = value.trim();

  if (!/^\d+(?:\.\d+)?$/.test(normalizedValue)) {
    return undefined;
  }

  const [integerPart, fractionalPart = ""] = normalizedValue.split(".");
  const denominator = 10n ** BigInt(fractionalPart.length);
  const numerator = BigInt(`${integerPart}${fractionalPart}`);

  if (numerator <= 0n) {
    return undefined;
  }

  return { denominator, numerator };
}

function toMinorAmount(money: Money) {
  if (
    typeof money.amountMinor === "number" &&
    Number.isSafeInteger(money.amountMinor)
  ) {
    return money.amountMinor;
  }

  const fractionDigits =
    money.fractionDigits ?? fractionDigitsForCurrency(money.currency);
  const amountMinor = Math.round(money.amount * 10 ** fractionDigits);

  return Number.isSafeInteger(amountMinor) ? amountMinor : undefined;
}

export function convertMoneyWithQuote(
  money: Money,
  quote: ExchangeRateQuote,
): ConvertedMoney | undefined {
  const sourceCurrency = normalizeCurrency(money.currency);
  const targetCurrency = normalizeCurrency(quote.quoteCurrency);
  const amountMinor = toMinorAmount(money);
  const parsedRate = parsePositiveDecimal(quote.rate);

  if (
    sourceCurrency !== normalizeCurrency(quote.baseCurrency) ||
    amountMinor === undefined ||
    amountMinor < 0 ||
    !parsedRate
  ) {
    return undefined;
  }

  const sourceFractionDigits =
    money.fractionDigits ?? fractionDigitsForCurrency(sourceCurrency);
  const targetFractionDigits = fractionDigitsForCurrency(targetCurrency);
  const numerator =
    BigInt(amountMinor) *
    parsedRate.numerator *
    10n ** BigInt(targetFractionDigits);
  const denominator =
    parsedRate.denominator * 10n ** BigInt(sourceFractionDigits);
  const roundedMinor = (numerator + denominator / 2n) / denominator;
  const convertedMinor = Number(roundedMinor);

  if (!Number.isSafeInteger(convertedMinor)) {
    return undefined;
  }

  return {
    amount: convertedMinor / 10 ** targetFractionDigits,
    amountMinor: convertedMinor,
    currency: targetCurrency,
    exchangeRate: quote.rate,
    exchangeRateSource: quote.source,
    exchangeRateTimestamp: quote.fetchedAt,
    fractionDigits: targetFractionDigits,
    sourceAmountMinor: amountMinor,
    sourceCurrency,
  };
}

export class ExchangeRateService {
  private readonly cache = new Map<string, CachedRate>();
  private readonly cacheTtlMs: number;
  private readonly maxStalenessMs: number;
  private readonly now: () => number;

  constructor(private readonly options: ExchangeRateServiceOptions) {
    this.cacheTtlMs = options.cacheTtlMs ?? defaultCacheTtlMs;
    this.maxStalenessMs = options.maxStalenessMs ?? defaultMaxStalenessMs;
    this.now = options.now ?? Date.now;
  }

  async convert(
    money: Money,
    displayCurrency: string,
  ): Promise<ConvertedMoney | undefined> {
    const baseCurrency = normalizeCurrency(money.currency);
    const quoteCurrency = normalizeCurrency(displayCurrency);

    if (!baseCurrency || !quoteCurrency || baseCurrency === quoteCurrency) {
      return undefined;
    }

    const quote = await this.getRate(baseCurrency, quoteCurrency);
    return quote ? convertMoneyWithQuote(money, quote) : undefined;
  }

  clear() {
    this.cache.clear();
  }

  private async getRate(baseCurrency: string, quoteCurrency: string) {
    const key = `${baseCurrency}:${quoteCurrency}`;
    const now = this.now();
    const cached = this.cache.get(key);

    if (cached && now - cached.cachedAt <= this.cacheTtlMs) {
      return cached.quote;
    }

    try {
      const quote = await this.options.provider.getRate(
        baseCurrency,
        quoteCurrency,
      );

      if (
        quote &&
        normalizeCurrency(quote.baseCurrency) === baseCurrency &&
        normalizeCurrency(quote.quoteCurrency) === quoteCurrency &&
        parsePositiveDecimal(quote.rate)
      ) {
        this.cache.set(key, {
          cachedAt: now,
          quote,
        });
        return quote;
      }
    } catch {
      // A recent cached quote is safer than relabeling an unconverted amount.
    }

    if (cached && now - cached.cachedAt <= this.maxStalenessMs) {
      return cached.quote;
    }

    return undefined;
  }
}

const disabledRateProvider: ExchangeRateProvider = {
  async getRate() {
    return undefined;
  },
};

export const exchangeRateService = new ExchangeRateService({
  provider: disabledRateProvider,
});

export async function applyDisplayCurrency(
  listings: Listing[],
  displayCurrency: string | undefined,
  service = exchangeRateService,
) {
  const normalizedDisplayCurrency = displayCurrency
    ? normalizeCurrency(displayCurrency)
    : undefined;

  if (!normalizedDisplayCurrency) {
    return listings;
  }

  return Promise.all(
    listings.map(async (listing) => {
      const original = listing.pricing?.original ?? listing.price;
      const display = await service.convert(original, normalizedDisplayCurrency);

      return {
        ...listing,
        pricing: {
          ...listing.pricing,
          display,
          original,
        },
      };
    }),
  );
}
