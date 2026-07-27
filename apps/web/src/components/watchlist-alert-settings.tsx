import { useEffect, useState, type FormEvent } from "react";
import type { Watchlist } from "@closetsearch/shared";
import { fetchJson, sendJson } from "../api-client";

export type AlertEventType =
  "auction_ending" | "back_in_range" | "digest" | "new_listing" | "price_drop";

export interface DeliveryChannelReadiness {
  available: boolean;
  configured: boolean;
  consented?: boolean;
  identityPresent?: boolean;
  ready: boolean;
  suppressed?: boolean;
  verified?: boolean;
}

export interface DeliveryReadiness {
  email: DeliveryChannelReadiness;
  inApp: DeliveryChannelReadiness;
  push: DeliveryChannelReadiness;
  sms: DeliveryChannelReadiness;
}

interface WatchlistAlertSettings {
  channels: {
    email: boolean;
    inApp: boolean;
    sms: boolean;
  };
  eventTypes: AlertEventType[];
  watchlistId: string;
}

interface WatchlistAlertSettingsResponse {
  watchlistAlertSettings: WatchlistAlertSettings;
}

const eventOptions: Array<{ label: string; value: AlertEventType }> = [
  { label: "New listings", value: "new_listing" },
  { label: "Price drops", value: "price_drop" },
  { label: "Auction ending soon", value: "auction_ending" },
  { label: "Back in price range", value: "back_in_range" },
  { label: "Digest summary", value: "digest" },
];

function readinessCopy(channel: "email" | "sms", readiness: DeliveryChannelReadiness) {
  if (!readiness.configured) {
    return `${channel === "email" ? "Email" : "SMS"} delivery is not configured.`;
  }
  if (!readiness.identityPresent) {
    return `Add a ${channel === "email" ? "verified email address" : "phone number"} first.`;
  }
  if (!readiness.verified) {
    return `Verify your ${channel === "email" ? "email address" : "phone number"} first.`;
  }
  if (channel === "sms" && !readiness.consented) {
    return "SMS consent is required.";
  }
  if (readiness.suppressed) {
    return `${channel === "email" ? "Email" : "SMS"} delivery is suppressed after an opt-out or provider failure.`;
  }
  return `${channel === "email" ? "Email" : "SMS"} is ready.`;
}

export function WatchlistAlertSettingsPanel({
  deliveryReadiness,
  watchlist,
}: {
  deliveryReadiness: DeliveryReadiness;
  watchlist: Watchlist;
}) {
  const [settings, setSettings] = useState<WatchlistAlertSettings>({
    channels: {
      email: false,
      inApp: true,
      sms: false,
    },
    eventTypes: ["new_listing", "price_drop"],
    watchlistId: watchlist.id,
  });
  const [feedback, setFeedback] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "unavailable">("loading");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    void fetchJson<WatchlistAlertSettingsResponse>(
      `/me/watchlists/${encodeURIComponent(watchlist.id)}/alert-settings`,
      controller.signal,
    )
      .then((response) => {
        setSettings(response.watchlistAlertSettings);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Per-watchlist delivery settings are unavailable.",
          );
          setStatus("unavailable");
        }
      });

    return () => controller.abort();
  }, [watchlist.id]);

  function updateEvent(eventType: AlertEventType, enabled: boolean) {
    setSettings((current) => ({
      ...current,
      eventTypes: enabled
        ? Array.from(new Set([...current.eventTypes, eventType]))
        : current.eventTypes.filter((value) => value !== eventType),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setFeedback(undefined);
    setErrorMessage(undefined);

    try {
      const response = await sendJson<WatchlistAlertSettingsResponse>(
        `/me/watchlists/${encodeURIComponent(watchlist.id)}/alert-settings`,
        "PATCH",
        {
          channels: settings.channels,
          eventTypes: settings.eventTypes,
        },
      );
      setSettings(response.watchlistAlertSettings);
      setFeedback(`Saved delivery controls for ${watchlist.label}.`);
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Watchlist delivery settings could not be saved.",
      );
      setStatus("ready");
    }
  }

  return (
    <details className="watchlist-alert-settings">
      <summary>Alert types &amp; delivery</summary>
      {status === "loading" ? (
        <p aria-live="polite" className="page-description">
          Loading delivery settings…
        </p>
      ) : status === "unavailable" ? (
        <p className="form-error" role="status">
          {errorMessage}
        </p>
      ) : (
        <form className="watchlist-alert-settings__form" onSubmit={handleSubmit}>
          <fieldset className="notification-choice-group">
            <legend>Alert types</legend>
            <div className="notification-choice-grid">
              {eventOptions.map((option) => (
                <label className="choice-card" key={option.value}>
                  <input
                    checked={settings.eventTypes.includes(option.value)}
                    onChange={(event) => updateEvent(option.value, event.target.checked)}
                    type="checkbox"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="notification-choice-group">
            <legend>Delivery for this watchlist</legend>
            <div className="notification-choice-grid">
              <label className="choice-card">
                <input
                  checked={settings.channels.inApp}
                  disabled={!deliveryReadiness.inApp.ready && !settings.channels.inApp}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      channels: { ...current.channels, inApp: event.target.checked },
                    }))
                  }
                  type="checkbox"
                />
                <span>In-app</span>
                <small>Available in the alert inbox.</small>
              </label>
              <label className="choice-card">
                <input
                  checked={settings.channels.email}
                  disabled={!deliveryReadiness.email.ready && !settings.channels.email}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      channels: { ...current.channels, email: event.target.checked },
                    }))
                  }
                  type="checkbox"
                />
                <span>Email</span>
                <small>{readinessCopy("email", deliveryReadiness.email)}</small>
              </label>
              <label className="choice-card">
                <input
                  checked={settings.channels.sms}
                  disabled={!deliveryReadiness.sms.ready && !settings.channels.sms}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      channels: { ...current.channels, sms: event.target.checked },
                    }))
                  }
                  type="checkbox"
                />
                <span>SMS</span>
                <small>{readinessCopy("sms", deliveryReadiness.sms)}</small>
              </label>
            </div>
          </fieldset>

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
          <button className="secondary-button" disabled={status === "saving"} type="submit">
            {status === "saving" ? "Saving…" : "Save watchlist alerts"}
          </button>
        </form>
      )}
    </details>
  );
}
