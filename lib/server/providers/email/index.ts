import "server-only";
import { getServerEnv } from "../../env";
import { createBrevoEmailProvider } from "./brevo";
import { createCaptureEmailProvider } from "./capture";
import { selectEmailProvider } from "./delivery-mode";
import type { EmailProvider } from "./types";

export type { EmailProvider, EmailSendResult, OutboundEmail } from "./types";
export { dispatchQuotaPool, resolveEmailDeliveryMode, selectEmailProvider, type EmailDeliveryMode } from "./delivery-mode";

let brevo: EmailProvider | undefined;
let capture: EmailProvider | undefined;

/** Resolves the provider for one recipient under the current `EMAIL_DELIVERY_MODE` (A9). */
export function providerForRecipient(toEmail: string): EmailProvider | null {
  brevo ??= createBrevoEmailProvider();
  capture ??= createCaptureEmailProvider();
  return selectEmailProvider(toEmail, getServerEnv(), brevo, capture);
}
