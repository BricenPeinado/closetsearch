import type { Money } from "@closetsearch/shared";

const zeroFractionCurrencies = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const threeFractionCurrencies = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

export function normalizeCurrencyCode(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : undefined;
}

export function getCurrencyFractionDigits(currency: string): number {
  if (zeroFractionCurrencies.has(currency)) {
    return 0;
  }

  if (threeFractionCurrencies.has(currency)) {
    return 3;
  }

  return 2;
}

function decimalStringToMinor(value: string, fractionDigits: number) {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);

  if (!match) {
    return undefined;
  }

  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const extraFraction = fraction.slice(fractionDigits);

  if (extraFraction.length > 0 && /[1-9]/.test(extraFraction)) {
    return undefined;
  }

  const paddedFraction = fraction
    .slice(0, fractionDigits)
    .padEnd(fractionDigits, "0");
  const scale = 10 ** fractionDigits;
  const amountMinor = Number(whole) * scale + Number(paddedFraction || "0");

  return Number.isSafeInteger(amountMinor) ? amountMinor : undefined;
}

export function createMoneyFromMajor(
  value: number | string,
  currencyValue: unknown,
): Money | undefined {
  const currency = normalizeCurrencyCode(currencyValue);

  if (!currency) {
    return undefined;
  }

  const fractionDigits = getCurrencyFractionDigits(currency);
  const normalizedValue =
    typeof value === "number"
      ? Number.isFinite(value) && value >= 0
        ? value.toFixed(fractionDigits)
        : ""
      : value.trim();
  const amountMinor = decimalStringToMinor(normalizedValue, fractionDigits);

  if (amountMinor === undefined) {
    return undefined;
  }

  return {
    amount: amountMinor / 10 ** fractionDigits,
    amountMinor,
    currency,
    fractionDigits,
  };
}

export function createMoneyFromMinor(
  value: number,
  currencyValue: unknown,
  fractionDigits?: number,
): Money | undefined {
  const currency = normalizeCurrencyCode(currencyValue);
  const normalizedFractionDigits =
    fractionDigits ?? (currency ? getCurrencyFractionDigits(currency) : undefined);

  if (
    !currency ||
    normalizedFractionDigits === undefined ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isInteger(normalizedFractionDigits) ||
    normalizedFractionDigits < 0 ||
    normalizedFractionDigits > 6
  ) {
    return undefined;
  }

  return {
    amount: value / 10 ** normalizedFractionDigits,
    amountMinor: value,
    currency,
    fractionDigits: normalizedFractionDigits,
  };
}
