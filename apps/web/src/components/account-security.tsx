import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { sendJson } from "../api-client";
import { getAuthErrorMessage, isAuthRequiredError } from "../user-session";

interface AccountEmailDelivery {
  providerMessageId?: string;
  reason?: "not_configured";
  status: "accepted" | "disabled";
}

interface EmailIdentity {
  createdAt: string;
  email: string;
  id: string;
  updatedAt: string;
  userId: string;
  verifiedAt?: string;
}

interface EmailIdentityResponse {
  identity: EmailIdentity;
}

type VerificationRequestResponse =
  | {
      status: "already_verified";
    }
  | {
      delivery: AccountEmailDelivery;
      expiresAt: string;
      status: "requested";
    };

interface AccountExportRequestResponse {
  delivery: AccountEmailDelivery;
  expiresAt: string;
  status: "requested";
}

export function getAccountDeliveryMessage(
  delivery: AccountEmailDelivery,
  action: "export" | "verification",
) {
  if (delivery.status === "accepted") {
    return action === "verification"
      ? "Verification instructions were accepted by the configured email provider."
      : "Export instructions were accepted by the configured email provider.";
  }

  return action === "verification"
    ? "The verification request was created, but outbound email is not configured. Request a new link after an operator enables email delivery."
    : "The export request was created, but outbound email is not configured. Request a new link after an operator enables email delivery.";
}

function Feedback({ error, message }: { error?: string; message?: string }) {
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

export function AccountSecurityPanel({
  onAccountDeleted,
  onAuthFailure,
  username,
}: {
  onAccountDeleted: () => void;
  onAuthFailure: () => void;
  username: string;
}) {
  const [email, setEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState<string>();
  const [emailError, setEmailError] = useState<string>();
  const [emailFeedback, setEmailFeedback] = useState<string>();
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [isRequestingVerification, setIsRequestingVerification] = useState(false);
  const [isRequestingExport, setIsRequestingExport] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [exportFeedback, setExportFeedback] = useState<string>();
  const [confirmationUsername, setConfirmationUsername] = useState("");
  const [deletionError, setDeletionError] = useState<string>();
  const [isDeleting, setIsDeleting] = useState(false);

  function handleProtectedError(
    error: unknown,
    fallbackMessage: string,
    setError: (value: string) => void,
  ) {
    if (isAuthRequiredError(error)) {
      onAuthFailure();
      return;
    }

    setError(getAuthErrorMessage(error, fallbackMessage));
  }

  async function handleSaveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError(undefined);
    setEmailFeedback(undefined);
    setIsSavingEmail(true);

    try {
      const response = await sendJson<EmailIdentityResponse>("/me/email", "PUT", {
        email: email.trim(),
      });
      setSavedEmail(response.identity.email);
      setEmail(response.identity.email);
      setEmailFeedback(
        response.identity.verifiedAt
          ? "This email address is verified."
          : "Email saved. Request a verification link to verify it.",
      );
    } catch (error: unknown) {
      handleProtectedError(error, "The email address could not be saved.", setEmailError);
    } finally {
      setIsSavingEmail(false);
    }
  }

  async function handleRequestVerification() {
    setEmailError(undefined);
    setEmailFeedback(undefined);
    setIsRequestingVerification(true);

    try {
      const response = await sendJson<VerificationRequestResponse>(
        "/me/email/verification",
        "POST",
        {},
      );

      setEmailFeedback(
        response.status === "already_verified"
          ? "Your saved email address is already verified."
          : getAccountDeliveryMessage(response.delivery, "verification"),
      );
    } catch (error: unknown) {
      handleProtectedError(error, "A verification request could not be created.", setEmailError);
    } finally {
      setIsRequestingVerification(false);
    }
  }

  async function handleRequestExport() {
    setExportError(undefined);
    setExportFeedback(undefined);
    setIsRequestingExport(true);

    try {
      const response = await sendJson<AccountExportRequestResponse>(
        "/me/account-export",
        "POST",
        {},
      );
      setExportFeedback(getAccountDeliveryMessage(response.delivery, "export"));
    } catch (error: unknown) {
      handleProtectedError(
        error,
        "The account export request could not be created.",
        setExportError,
      );
    } finally {
      setIsRequestingExport(false);
    }
  }

  async function handleDeleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (confirmationUsername !== username) {
      setDeletionError("Enter your username exactly to delete the account.");
      return;
    }

    setDeletionError(undefined);
    setIsDeleting(true);

    try {
      await sendJson<{ deleted: true }>("/me", "DELETE", {
        confirmationUsername,
      });
      onAccountDeleted();
    } catch (error: unknown) {
      handleProtectedError(error, "The account could not be deleted.", setDeletionError);
      setIsDeleting(false);
    }
  }

  return (
    <section aria-labelledby="account-security-heading" className="account-security">
      <div className="section-heading section-heading--split">
        <div>
          <h2 id="account-security-heading">Account security and data</h2>
          <p>
            Manage your email identity, request a portable export, or permanently delete your
            account.
          </p>
        </div>
        <Link className="secondary-button link-button" to="/forgot-password">
          Reset password
        </Link>
      </div>

      <div className="account-security__grid">
        <article className="profile-panel">
          <h2>Email verification</h2>
          <p>
            Outbound email works only when an operator configures an approved provider. Saving an
            address does not by itself send mail.
          </p>
          <form className="account-form account-form--embedded" onSubmit={handleSaveEmail}>
            <label className="field-group" htmlFor="account-email">
              <span>Email address</span>
              <input
                autoComplete="email"
                id="account-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </label>
            <div className="inline-actions">
              <button className="secondary-button" disabled={isSavingEmail} type="submit">
                {isSavingEmail ? "Saving email..." : "Save email"}
              </button>
              <button
                className="secondary-button"
                disabled={isRequestingVerification}
                onClick={handleRequestVerification}
                type="button"
              >
                {isRequestingVerification
                  ? "Requesting verification..."
                  : "Request verification link"}
              </button>
            </div>
            {savedEmail ? <p>Saved address: {savedEmail}</p> : null}
            <Feedback error={emailError} message={emailFeedback} />
          </form>
        </article>

        <article className="profile-panel">
          <h2>Account export</h2>
          <p>
            A verified email is required. The one-time export link expires quickly and is delivered
            only when outbound email is configured.
          </p>
          <button
            className="secondary-button"
            disabled={isRequestingExport}
            onClick={handleRequestExport}
            type="button"
          >
            {isRequestingExport ? "Requesting export..." : "Request account export"}
          </button>
          <Feedback error={exportError} message={exportFeedback} />
        </article>

        <article className="profile-panel profile-panel--danger">
          <h2>Delete account</h2>
          <p>
            This permanently removes the account and its stored saved data. Enter{" "}
            <strong>{username}</strong> exactly to confirm.
          </p>
          <form className="account-form account-form--embedded" onSubmit={handleDeleteAccount}>
            <label className="field-group" htmlFor="delete-account-username">
              <span>Confirm username</span>
              <input
                autoComplete="off"
                id="delete-account-username"
                onChange={(event) => setConfirmationUsername(event.target.value)}
                required
                value={confirmationUsername}
              />
            </label>
            <button
              className="danger-button"
              disabled={isDeleting || confirmationUsername !== username}
              type="submit"
            >
              {isDeleting ? "Deleting account..." : "Permanently delete account"}
            </button>
            <Feedback error={deletionError} />
          </form>
        </article>
      </div>
    </section>
  );
}
