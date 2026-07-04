import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '../env.js';
import { log } from './logger.js';

/**
 * Generic SMTP fallback transport for transactional email.
 *
 * This is the second leg of the send chain in `lib/email.ts`: mittera.eu
 * is the primary sender, and this SMTP transport engages only when mittera
 * is unconfigured or a mittera send fails. It exists so sign-in / magic-link
 * / OTP mail keeps flowing while mittera's own sender is sandbox-limited.
 *
 * Deliberately provider-agnostic — it speaks plain SMTP, so it works with a
 * self-run mailserver or any provider's SMTP endpoint. No lock-in, and in
 * particular no dependency on a competitor of mittera itself. The operator
 * supplies `BRIVEN_SMTP_*` credentials whenever they're ready; until then
 * `smtpConfigured()` returns false and the chain falls through to the
 * existing stdout-only dev behavior.
 */

/** True only when every var the SMTP transport needs is present. */
export function smtpConfigured(): boolean {
  return Boolean(
    env.BRIVEN_SMTP_HOST &&
      env.BRIVEN_SMTP_PORT &&
      env.BRIVEN_SMTP_USER &&
      env.BRIVEN_SMTP_PASS &&
      env.BRIVEN_SMTP_FROM,
  );
}

let transporter: Transporter | null = null;

/**
 * Lazily build (and cache) the nodemailer transport. Implicit TLS is used
 * for port 465 (the SMTPS convention); every other port negotiates STARTTLS
 * via `requireTLS`, so credentials never cross the wire in cleartext.
 */
function getTransport(): Transporter {
  if (transporter) return transporter;
  const port = env.BRIVEN_SMTP_PORT!;
  transporter = nodemailer.createTransport({
    host: env.BRIVEN_SMTP_HOST!,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: env.BRIVEN_SMTP_USER!, pass: env.BRIVEN_SMTP_PASS! },
  });
  return transporter;
}

export interface SmtpSendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Optional From: override (a tenant's verified sender). For deliverability
   * the supplied domain must be authorized on the fallback SMTP server; if it
   * isn't, drop the override so the message sends from `BRIVEN_SMTP_FROM`.
   * The primary (mittera) path handles per-tenant senders properly once it's
   * out of its sandbox — this fallback prioritizes "the mail arrives".
   */
  from?: string;
}

/** Send one message through the SMTP fallback. Throws on transport failure. */
export async function sendViaSmtp(args: SmtpSendArgs): Promise<void> {
  const info = await getTransport().sendMail({
    from: args.from ?? env.BRIVEN_SMTP_FROM!,
    sender: env.BRIVEN_SMTP_FROM!,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  });
  // Recipient is NOT logged (CLAUDE.md §5.1); the messageId is the
  // correlation key an operator greps for to confirm a fallback send.
  log.info('smtp_send_ok', { messageId: info.messageId });
}
