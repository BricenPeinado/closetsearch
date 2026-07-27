import { describe, expect, it } from "vitest";
import {
  containsJapaneseText,
  currencyFractionDigits,
  formatDateTime,
  formatMinorMoney,
  formatMoney,
  getPreferredTimeZone,
} from "./product-formatting";

describe("product formatting", () => {
  it("formats zero-decimal JPY amounts without treating minor values as cents", () => {
    expect(currencyFractionDigits("JPY", "en-US")).toBe(0);
    expect(formatMinorMoney(24_800, "JPY", "en-US")).toContain("24,800");
    expect(
      formatMoney(
        {
          amount: 24_800,
          amountMinor: 24_800,
          currency: "JPY",
          fractionDigits: 0,
        },
        "ja-JP",
      ),
    ).toContain("24,800");
  });

  it("keeps exact two-decimal currencies and explicit timezones", () => {
    expect(formatMinorMoney(12_345, "USD", "en-US")).toBe("$123.45");
    expect(
      formatDateTime("2026-07-26T16:00:00.000Z", {
        locale: "en-US",
        timeZone: "Asia/Tokyo",
      }),
    ).toMatch(/Jul 27, 2026.+1:00 AM.+GMT\+9/);
  });

  it("detects Japanese text and falls back from invalid timezone input", () => {
    expect(containsJapaneseText("コムデギャルソン ジャケット")).toBe(true);
    expect(containsJapaneseText("Comme des Garçons jacket")).toBe(false);
    expect(getPreferredTimeZone("Not/AZone")).not.toBe("Not/AZone");
  });
});
