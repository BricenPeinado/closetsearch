import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  AccountExportPage,
  EmailVerificationPage,
  normalizeAccountActionToken,
  PasswordResetCompletePage,
  PasswordResetRequestPage,
  readAccountActionToken,
} from "./account-action-pages";
import { AccountSecurityPanel, getAccountDeliveryMessage } from "./account-security";

describe("account action helpers", () => {
  it("normalizes missing and whitespace-padded one-time tokens", () => {
    expect(normalizeAccountActionToken(null)).toBe("");
    expect(normalizeAccountActionToken("  one-time-token  ")).toBe("one-time-token");
    expect(readAccountActionToken("#token=fragment-token")).toBe("fragment-token");
    expect(readAccountActionToken("token=encoded%20token")).toBe("encoded token");
    expect(readAccountActionToken("#other=value")).toBe("");
  });

  it("distinguishes configured delivery from disabled outbound email", () => {
    expect(getAccountDeliveryMessage({ status: "accepted" }, "verification")).toContain(
      "accepted by the configured email provider",
    );
    expect(
      getAccountDeliveryMessage({ reason: "not_configured", status: "disabled" }, "export"),
    ).toContain("outbound email is not configured");
  });
});

describe("account security surfaces", () => {
  it("renders accessible email, export, reset, and exact-username deletion controls", () => {
    const html = renderToString(
      <MemoryRouter>
        <AccountSecurityPanel
          onAccountDeleted={vi.fn()}
          onAuthFailure={vi.fn()}
          username="archivist"
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Account security and data");
    expect(html).toContain('type="email"');
    expect(html).toContain("Request verification link");
    expect(html).toContain("Request account export");
    expect(html).toContain("Permanently delete account");
    expect(html).toContain("<strong>archivist</strong>");
  });

  it("keeps password reset requests account-enumeration safe and delivery-truthful", () => {
    const html = renderToString(
      <MemoryRouter>
        <PasswordResetRequestPage />
      </MemoryRouter>,
    );

    expect(html).toContain("short-lived, one-time reset link");
    expect(html).toContain("Email delivery is disabled unless");
    expect(html).toContain('autoComplete="email"');
  });

  it("requires explicit user actions before consuming one-time tokens", () => {
    const resetHtml = renderToString(
      <MemoryRouter initialEntries={["/reset-password#token=reset-token"]}>
        <PasswordResetCompletePage onPasswordReset={vi.fn()} />
      </MemoryRouter>,
    );
    const verifyHtml = renderToString(
      <MemoryRouter initialEntries={["/verify-email#token=verify-token"]}>
        <EmailVerificationPage />
      </MemoryRouter>,
    );
    const exportHtml = renderToString(
      <MemoryRouter initialEntries={["/account/export#token=export-token"]}>
        <AccountExportPage />
      </MemoryRouter>,
    );

    expect(resetHtml).toContain("Update password");
    expect(resetHtml).toContain('minLength="12"');
    expect(verifyHtml).toContain("Verify email");
    expect(exportHtml).toContain("Prepare account export");
    expect(verifyHtml).not.toContain("Verifying email...");
    expect(exportHtml).not.toContain("Preparing export...");
  });

  it("disables completion when an action URL has no token", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <PasswordResetCompletePage onPasswordReset={vi.fn()} />
      </MemoryRouter>,
    );

    expect(html).toContain("missing its one-time token");
    expect(html).toContain("disabled");
  });
});
