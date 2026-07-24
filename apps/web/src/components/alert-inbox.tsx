import { useEffect, useState } from "react";
import type { AuthResponse } from "@closetsearch/shared";
import { Link } from "react-router-dom";
import { fetchJson, sendJson } from "../api-client";
import { getAuthErrorMessage, isAuthRequiredError } from "../user-session";

interface AlertReason {
  code: string;
  label: string;
}

export interface InboxAlert {
  dismissedAt?: string;
  firstMatchedAt: string;
  id: string;
  lastMatchedAt: string;
  listingId: string;
  reasons: AlertReason[];
  seenAt?: string;
  state: "dismissed" | "seen" | "unseen";
  userId: string;
  watchlistId: string;
}

interface AlertInboxResponse {
  alerts: InboxAlert[];
  unseenCount: number;
  userId: string;
}

export function describeAlertReasons(reasons: AlertReason[]) {
  return (
    reasons
      .map((reason) => reason.label.trim())
      .filter(Boolean)
      .join(" • ") || "Watchlist criteria matched"
  );
}

function formatAlertDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently matched";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function AlertInboxPage({
  onAuthFailure,
  session,
}: {
  onAuthFailure: () => void;
  session: AuthResponse | null;
}) {
  const [alerts, setAlerts] = useState<InboxAlert[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [isLoading, setIsLoading] = useState(Boolean(session));
  const [reloadCount, setReloadCount] = useState(0);
  const [pendingAlertId, setPendingAlertId] = useState<string>();

  useEffect(() => {
    if (!session) {
      setAlerts([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setErrorMessage(undefined);

    void fetchJson<AlertInboxResponse>("/me/alerts", controller.signal)
      .then((response) => {
        setAlerts(response.alerts);
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        if (isAuthRequiredError(error)) {
          onAuthFailure();
          return;
        }

        setErrorMessage(getAuthErrorMessage(error, "The alert inbox could not be loaded."));
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [onAuthFailure, reloadCount, session]);

  async function updateAlert(alert: InboxAlert, action: "dismiss" | "seen") {
    setPendingAlertId(alert.id);
    setErrorMessage(undefined);
    setFeedback(undefined);

    try {
      const response = await sendJson<{
        alertMatchId: string;
        state: "dismissed" | "seen";
      }>(`/me/alerts/${action}`, "POST", {
        alertMatchId: alert.id,
      });
      setAlerts((currentAlerts) =>
        currentAlerts.map((currentAlert) =>
          currentAlert.id === response.alertMatchId
            ? { ...currentAlert, state: response.state }
            : currentAlert,
        ),
      );
      setFeedback(response.state === "seen" ? "Alert marked as seen." : "Alert dismissed.");
    } catch (error: unknown) {
      if (isAuthRequiredError(error)) {
        onAuthFailure();
        return;
      }

      setErrorMessage(getAuthErrorMessage(error, "The alert could not be updated."));
    } finally {
      setPendingAlertId(undefined);
    }
  }

  const unseenCount = alerts.filter((alert) => alert.state === "unseen").length;

  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          <h1>Alerts</h1>
          <p className="page-description">
            New and changed listings that match your enabled watchlists.
          </p>
        </div>
        {session ? <span className="info-chip">{unseenCount} unseen</span> : null}
      </header>

      {!session ? (
        <section className="state-card">
          <h2>Log in to view alerts</h2>
          <p>Your alert inbox is tied to your account and enabled watchlists.</p>
          <div className="state-card__action">
            <Link className="search-form__button link-button" to="/login">
              Log in
            </Link>
          </div>
        </section>
      ) : (
        <section aria-labelledby="alert-inbox-heading" className="recent-searches">
          <div className="section-heading section-heading--split">
            <div>
              <h2 id="alert-inbox-heading">In-app inbox</h2>
              <p>
                In-app matching runs only with the production PostgreSQL worker. Email additionally
                requires a configured provider and verified address. Push and SMS are unavailable.
              </p>
            </div>
            <Link className="secondary-button link-button" to="/profile">
              Manage watchlists
            </Link>
          </div>

          {feedback ? (
            <p aria-live="polite" className="form-success" role="status">
              {feedback}
            </p>
          ) : null}
          {errorMessage ? (
            <section className="state-card" role="alert">
              <h2>Alert inbox unavailable</h2>
              <p>{errorMessage}</p>
              <div className="state-card__action">
                <button
                  className="secondary-button"
                  onClick={() => setReloadCount((value) => value + 1)}
                  type="button"
                >
                  Try again
                </button>
              </div>
            </section>
          ) : null}
          {isLoading ? (
            <section aria-live="polite" className="state-card" role="status">
              <h2>Loading alerts</h2>
              <p>Checking your durable in-app inbox.</p>
            </section>
          ) : null}
          {!isLoading && !errorMessage && alerts.length === 0 ? (
            <section className="state-card">
              <h2>No alert matches yet</h2>
              <p>
                Keep an enabled watchlist. The worker will add an alert when a new or changed
                listing matches its criteria.
              </p>
            </section>
          ) : null}
          {!isLoading && alerts.length > 0 ? (
            <div className="alert-inbox-list">
              {alerts.map((alert) => (
                <article
                  aria-labelledby={`alert-${alert.id}-title`}
                  className={`recent-search-card alert-inbox-card alert-inbox-card--${alert.state}`}
                  key={alert.id}
                >
                  <div className="section-heading section-heading--split">
                    <div>
                      <p className="eyebrow">
                        {alert.state === "unseen"
                          ? "New match"
                          : alert.state === "dismissed"
                            ? "Dismissed"
                            : "Seen"}
                      </p>
                      <h2 id={`alert-${alert.id}-title`}>Watchlist match</h2>
                    </div>
                    <span className="info-chip">{formatAlertDate(alert.lastMatchedAt)}</span>
                  </div>
                  <p>{describeAlertReasons(alert.reasons)}</p>
                  <p className="alert-inbox-card__metadata">
                    Listing {alert.listingId} • Watchlist {alert.watchlistId}
                  </p>
                  <div className="inline-actions">
                    {alert.state === "unseen" ? (
                      <button
                        aria-label={`Mark alert ${alert.id} as seen`}
                        className="secondary-button"
                        disabled={pendingAlertId === alert.id}
                        onClick={() => void updateAlert(alert, "seen")}
                        type="button"
                      >
                        {pendingAlertId === alert.id ? "Updating..." : "Mark seen"}
                      </button>
                    ) : null}
                    {alert.state !== "dismissed" ? (
                      <button
                        aria-label={`Dismiss alert ${alert.id}`}
                        className="secondary-button"
                        disabled={pendingAlertId === alert.id}
                        onClick={() => void updateAlert(alert, "dismiss")}
                        type="button"
                      >
                        {pendingAlertId === alert.id ? "Updating..." : "Dismiss"}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      )}
    </section>
  );
}
