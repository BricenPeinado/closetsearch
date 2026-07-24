import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { sendJson } from "../api-client";
import { getAuthErrorMessage } from "../user-session";

interface AccountActionShellProps {
  children: React.ReactNode;
  description: string;
  title: string;
}

interface AccountExportResponse {
  data: Record<string, unknown>;
  status: "exported";
}

export function normalizeAccountActionToken(value: string | null) {
  return value?.trim() ?? "";
}

function AccountActionShell({ children, description, title }: AccountActionShellProps) {
  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="page-description">{description}</p>
        </div>
      </header>
      <section className="auth-shell">{children}</section>
    </section>
  );
}

function ActionFeedback({ error, message }: { error?: string; message?: string }) {
  return (
    <>
      {message ? (
        <p aria-live="polite" className="form-success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function PasswordResetRequestPage() {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(undefined);
    setFeedback(undefined);
    setIsSubmitting(true);

    try {
      await sendJson<{ accepted: true }>("/auth/password-reset/request", "POST", {
        email: email.trim(),
      });
      setFeedback(
        "Request accepted. If this is a verified account and outbound email is configured, a one-time reset link will be sent. This response does not confirm whether an account exists.",
      );
    } catch (error: unknown) {
      setErrorMessage(getAuthErrorMessage(error, "The password reset request could not be sent."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AccountActionShell
      description="Request a short-lived, one-time reset link for a verified email address."
      title="Reset your password"
    >
      <form className="account-form" onSubmit={handleSubmit}>
        <label className="field-group" htmlFor="password-reset-email">
          <span>Email address</span>
          <input
            autoComplete="email"
            id="password-reset-email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <p className="page-description">
          Email delivery is disabled unless an operator configures an approved outbound provider.
        </p>
        <ActionFeedback error={errorMessage} message={feedback} />
        <div className="search-panel__actions">
          <button className="search-form__button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Requesting reset..." : "Request password reset"}
          </button>
          <Link className="secondary-button link-button" to="/login">
            Back to login
          </Link>
        </div>
      </form>
    </AccountActionShell>
  );
}

export function PasswordResetCompletePage({ onPasswordReset }: { onPasswordReset: () => void }) {
  const [searchParams] = useSearchParams();
  const token = normalizeAccountActionToken(searchParams.get("token"));
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(undefined);
    setFeedback(undefined);

    if (!token) {
      setErrorMessage("This reset link is missing its one-time token.");
      return;
    }

    if (password !== passwordConfirmation) {
      setErrorMessage("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      await sendJson<{ sessionsRevoked: number; status: "password_reset" }>(
        "/auth/password-reset/complete",
        "POST",
        { password, token },
      );
      setPassword("");
      setPasswordConfirmation("");
      setFeedback("Password updated. Every existing session was revoked; log in again.");
      onPasswordReset();
    } catch (error: unknown) {
      setErrorMessage(getAuthErrorMessage(error, "The password could not be reset."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AccountActionShell
      description="Choose a new password. Completing this action signs out every existing session."
      title="Choose a new password"
    >
      <form className="account-form" onSubmit={handleSubmit}>
        {!token ? (
          <p className="form-error" role="alert">
            This reset link is missing its one-time token. Request a new link.
          </p>
        ) : null}
        <label className="field-group" htmlFor="new-password">
          <span>New password</span>
          <input
            autoComplete="new-password"
            id="new-password"
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <label className="field-group" htmlFor="new-password-confirmation">
          <span>Confirm new password</span>
          <input
            autoComplete="new-password"
            id="new-password-confirmation"
            minLength={12}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            required
            type="password"
            value={passwordConfirmation}
          />
        </label>
        <p className="page-description">
          Use 12–128 characters and avoid your username, email name, or a common password.
        </p>
        <ActionFeedback error={errorMessage} message={feedback} />
        <div className="search-panel__actions">
          <button
            className="search-form__button"
            disabled={isSubmitting || !token || Boolean(feedback)}
            type="submit"
          >
            {isSubmitting ? "Updating password..." : "Update password"}
          </button>
          <Link className="secondary-button link-button" to="/forgot-password">
            Request a new link
          </Link>
        </div>
      </form>
    </AccountActionShell>
  );
}

export function EmailVerificationPage() {
  const [searchParams] = useSearchParams();
  const token = normalizeAccountActionToken(searchParams.get("token"));
  const [errorMessage, setErrorMessage] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleVerify() {
    if (!token) {
      setErrorMessage("This verification link is missing its one-time token.");
      return;
    }

    setErrorMessage(undefined);
    setFeedback(undefined);
    setIsSubmitting(true);

    try {
      await sendJson<{ status: "verified" }>("/auth/verify-email", "POST", { token });
      setFeedback("Email verified. The one-time link has now been consumed.");
    } catch (error: unknown) {
      setErrorMessage(getAuthErrorMessage(error, "The email address could not be verified."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AccountActionShell
      description="Confirm the email address attached to your account."
      title="Verify your email"
    >
      <section className="account-form">
        {!token ? (
          <p className="form-error" role="alert">
            This verification link is missing its one-time token. Request a new link from your
            profile.
          </p>
        ) : null}
        <ActionFeedback error={errorMessage} message={feedback} />
        <div className="search-panel__actions">
          <button
            className="search-form__button"
            disabled={isSubmitting || !token || Boolean(feedback)}
            onClick={handleVerify}
            type="button"
          >
            {isSubmitting ? "Verifying email..." : "Verify email"}
          </button>
          <Link className="secondary-button link-button" to="/profile">
            Back to profile
          </Link>
        </div>
      </section>
    </AccountActionShell>
  );
}

export function AccountExportPage() {
  const [searchParams] = useSearchParams();
  const token = normalizeAccountActionToken(searchParams.get("token"));
  const [exportData, setExportData] = useState<Record<string, unknown>>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handlePrepareExport() {
    if (!token) {
      setErrorMessage("This export link is missing its one-time token.");
      return;
    }

    setErrorMessage(undefined);
    setIsSubmitting(true);

    try {
      const response = await sendJson<AccountExportResponse>("/account/export", "POST", {
        token,
      });
      setExportData(response.data);
    } catch (error: unknown) {
      setErrorMessage(getAuthErrorMessage(error, "The account export could not be prepared."));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDownload() {
    if (!exportData) {
      return;
    }

    const objectUrl = URL.createObjectURL(
      new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "closetsearch-account-export.json";
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <AccountActionShell
      description="Consume the short-lived export link, then download your account data as JSON."
      title="Download account export"
    >
      <section className="account-form">
        {!token ? (
          <p className="form-error" role="alert">
            This export link is missing its one-time token. Request a new link from your profile.
          </p>
        ) : null}
        {exportData ? (
          <p aria-live="polite" className="form-success" role="status">
            Export prepared. This data is held only in this page until you navigate away.
          </p>
        ) : null}
        <ActionFeedback error={errorMessage} />
        <div className="search-panel__actions">
          {exportData ? (
            <button className="search-form__button" onClick={handleDownload} type="button">
              Download JSON export
            </button>
          ) : (
            <button
              className="search-form__button"
              disabled={isSubmitting || !token}
              onClick={handlePrepareExport}
              type="button"
            >
              {isSubmitting ? "Preparing export..." : "Prepare account export"}
            </button>
          )}
          <Link className="secondary-button link-button" to="/profile">
            Back to profile
          </Link>
        </div>
      </section>
    </AccountActionShell>
  );
}
