export type AccountEmailKind = "account_export" | "email_verification" | "password_reset";

export interface AccountEmailMessage {
  actionUrl: string;
  expiresAt: string;
  kind: AccountEmailKind;
  to: string;
}

export type AccountEmailDelivery =
  | {
      status: "accepted";
      providerMessageId?: string;
    }
  | {
      reason: "not_configured";
      status: "disabled";
    };

export interface AccountEmailSender {
  readonly configured?: boolean;
  send(message: AccountEmailMessage): Promise<AccountEmailDelivery>;
}

export const disabledAccountEmailSender: AccountEmailSender = {
  configured: false,
  async send() {
    return {
      reason: "not_configured",
      status: "disabled",
    };
  },
};

export function createInjectedAccountEmailSender(
  deliver: (message: AccountEmailMessage) => Promise<AccountEmailDelivery>,
): AccountEmailSender {
  return {
    configured: true,
    send: deliver,
  };
}

const accountSubjects: Record<AccountEmailKind, string> = {
  account_export: "Your ClosetSearch account export",
  email_verification: "Verify your ClosetSearch email",
  password_reset: "Reset your ClosetSearch password",
};

export function createTransportAccountEmailSender(transport: EmailTransport): AccountEmailSender {
  if (!transport.configured) {
    return disabledAccountEmailSender;
  }

  return createInjectedAccountEmailSender(async (message) => {
    const result = await transport.send({
      idempotencyKey: `account:${message.kind}:${message.to}:${message.expiresAt}`,
      subject: accountSubjects[message.kind],
      text: `${accountSubjects[message.kind]}\n\nOpen this secure link:\n${message.actionUrl}\n\nThis link expires at ${message.expiresAt}. If you did not request this, ignore this message.`,
      to: message.to,
    });

    return {
      providerMessageId: result.providerMessageId,
      status: "accepted",
    };
  });
}

export function createAccountEmailSenderFromEnvironment(
  env: Record<string, string | undefined> = process.env,
) {
  return createTransportAccountEmailSender(createEmailTransportFromEnvironment(env));
}
import {
  createEmailTransportFromEnvironment,
  type EmailTransport,
} from "../services/notificationTransports.js";
