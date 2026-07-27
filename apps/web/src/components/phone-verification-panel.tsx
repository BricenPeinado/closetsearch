import { useEffect, useState, type FormEvent } from "react";
import { sendJson } from "../api-client";
import type { DeliveryReadiness } from "./watchlist-alert-settings";

export interface PhoneIdentity {
  createdAt?: string;
  disabledAt?: string;
  id?: string;
  phoneE164: string;
  updatedAt?: string;
  userId?: string;
  verifiedAt?: string;
}

interface PhoneIdentityResponse {
  phoneIdentity: PhoneIdentity;
  userId: string;
}

interface VerificationRequestResponse {
  expiresAt: string;
  status: "requested";
}

interface VerificationResponse {
  phoneIdentity: PhoneIdentity;
  status: "verified";
}

interface RemovePhoneResponse {
  removed: boolean;
  userId: string;
}

export function PhoneVerificationPanel({
  deliveryReadiness,
  onChanged,
  phoneIdentity,
}: {
  deliveryReadiness: DeliveryReadiness;
  onChanged: () => void;
  phoneIdentity?: PhoneIdentity;
}) {
  const [phone, setPhone] = useState(phoneIdentity?.phoneE164 ?? "");
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [feedback, setFeedback] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [status, setStatus] = useState<"idle" | "saving" | "requesting" | "verifying" | "removing">(
    "idle",
  );

  useEffect(() => {
    setPhone(phoneIdentity?.phoneE164 ?? "");
  }, [phoneIdentity?.phoneE164]);

  async function handleSavePhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setFeedback(undefined);
    setErrorMessage(undefined);

    try {
      await sendJson<PhoneIdentityResponse>("/me/phone", "PUT", {
        consent,
        phone: phone.trim(),
      });
      setConsent(false);
      setFeedback("Phone saved. Request a verification code before enabling SMS.");
      onChanged();
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "The phone number could not be saved.",
      );
    } finally {
      setStatus("idle");
    }
  }

  async function handleRequestCode() {
    setStatus("requesting");
    setFeedback(undefined);
    setErrorMessage(undefined);

    try {
      const response = await sendJson<VerificationRequestResponse>(
        "/me/phone/verification",
        "POST",
        {},
      );
      setFeedback(
        `Verification code requested. It expires ${new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(response.expiresAt))}.`,
      );
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "A verification code could not be requested.",
      );
    } finally {
      setStatus("idle");
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("verifying");
    setFeedback(undefined);
    setErrorMessage(undefined);

    try {
      await sendJson<VerificationResponse>("/me/phone/verify", "POST", { code: code.trim() });
      setCode("");
      setFeedback("Phone verified. SMS can be enabled when delivery is configured.");
      onChanged();
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "The verification code could not be confirmed.",
      );
    } finally {
      setStatus("idle");
    }
  }

  async function handleRemovePhone() {
    setStatus("removing");
    setFeedback(undefined);
    setErrorMessage(undefined);

    try {
      await sendJson<RemovePhoneResponse>("/me/phone", "DELETE", {});
      setPhone("");
      setCode("");
      setConsent(false);
      setFeedback("Phone and SMS consent were removed.");
      onChanged();
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "The phone could not be removed.");
    } finally {
      setStatus("idle");
    }
  }

  const isBusy = status !== "idle";
  const hasPhone = Boolean(phoneIdentity?.phoneE164);

  return (
    <section aria-labelledby="phone-verification-heading" className="phone-verification-panel">
      <div>
        <p className="eyebrow">Optional SMS identity</p>
        <h3 id="phone-verification-heading">Phone verification</h3>
        <p className="page-description">
          SMS is opt-in. ClosetSearch will not enable it until the number is verified, explicit
          consent is recorded, and the delivery provider is configured.
        </p>
      </div>

      <form className="phone-verification-panel__form" onSubmit={handleSavePhone}>
        <label className="field-group" htmlFor="notification-phone">
          <span>Phone number</span>
          <input
            autoComplete="tel"
            id="notification-phone"
            inputMode="tel"
            onChange={(event) => setPhone(event.target.value)}
            pattern="\\+[1-9][0-9]{7,14}"
            placeholder="+12025550123"
            required
            type="tel"
            value={phone}
          />
          <small>Use international E.164 format, including the leading +.</small>
        </label>
        <label className="choice-card choice-card--consent">
          <input
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            required
            type="checkbox"
          />
          <span>I consent to receive ClosetSearch alert text messages.</span>
          <small>
            Message and data rates may apply. Frequency follows your alert settings. Reply STOP to
            opt out or HELP for help.
          </small>
        </label>
        <button className="secondary-button" disabled={isBusy || !consent} type="submit">
          {status === "saving" ? "Saving phone…" : hasPhone ? "Update phone" : "Add phone"}
        </button>
      </form>

      {hasPhone ? (
        <div className="phone-verification-panel__verification">
          <div className="readiness-line">
            <span
              aria-hidden="true"
              className={phoneIdentity?.verifiedAt ? "status-dot status-dot--ready" : "status-dot"}
            />
            <span>
              {phoneIdentity?.phoneE164} ·{" "}
              {phoneIdentity?.verifiedAt ? "Verified" : "Not yet verified"}
            </span>
          </div>
          {!phoneIdentity?.verifiedAt ? (
            <>
              <button
                className="secondary-button"
                disabled={isBusy || !deliveryReadiness.sms.configured}
                onClick={handleRequestCode}
                type="button"
              >
                {status === "requesting" ? "Requesting code…" : "Send verification code"}
              </button>
              {!deliveryReadiness.sms.configured ? (
                <p className="page-description">
                  Code delivery is unavailable until the SMS provider is configured.
                </p>
              ) : null}
              <form className="inline-verification-form" onSubmit={handleVerify}>
                <label className="field-group" htmlFor="notification-phone-code">
                  <span>Verification code</span>
                  <input
                    autoComplete="one-time-code"
                    id="notification-phone-code"
                    inputMode="numeric"
                    maxLength={8}
                    onChange={(event) => setCode(event.target.value)}
                    pattern="[0-9]{4,8}"
                    placeholder="123456"
                    required
                    value={code}
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={isBusy || code.length < 4}
                  type="submit"
                >
                  {status === "verifying" ? "Verifying…" : "Verify code"}
                </button>
              </form>
            </>
          ) : null}
          <button
            className="text-button text-button--danger"
            disabled={isBusy}
            onClick={handleRemovePhone}
            type="button"
          >
            {status === "removing" ? "Removing…" : "Remove phone and SMS consent"}
          </button>
        </div>
      ) : null}

      {feedback ? (
        <p aria-live="polite" className="form-success" role="status">
          {feedback}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="form-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
