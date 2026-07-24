export type AccountEmailKind =
  | "account_export"
  | "email_verification"
  | "password_reset";

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
  send(message: AccountEmailMessage): Promise<AccountEmailDelivery>;
}

export const disabledAccountEmailSender: AccountEmailSender = {
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
    send: deliver,
  };
}
