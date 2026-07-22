/**
 * briven-engine delivery — email + SMS for OTP / magic link / password reset.
 *
 * Send order:
 *   SMS  → project Twilio-compatible secrets → else log
 *   Email → platform SMTP (BRIVEN_SMTP_*) → else log
 *
 * Product name is always briven-engine.
 */

import { log } from '../../lib/logger.js';
import { env } from '../../env.js';
import { sendViaSmtp, smtpConfigured } from '../../lib/smtp.js';
import { getBrivenEngineSmsSecrets } from './project-config.js';

export type EmailDeliveryInput = {
  email: string;
  subject?: string;
  body?: string;
  type?: string;
  userContext?: Record<string, unknown>;
  raw?: unknown;
  /** When set, can look up per-project SMTP later */
  projectId?: string;
};

export type SmsDeliveryInput = {
  phoneNumber: string;
  userInputCode?: string;
  urlWithLinkCode?: string;
  codeLifetime?: number;
  type?: string;
  userContext?: Record<string, unknown>;
  raw?: unknown;
  projectId?: string;
};

export type DeliveryResult = {
  ok: boolean;
  channel: 'email' | 'sms';
  engine: 'briven-engine';
  mode: 'log' | 'platform' | 'provider';
  message?: string;
};

function bodyFromSms(input: SmsDeliveryInput): string {
  const parts = [
    input.userInputCode ? `Your Briven Auth code: ${input.userInputCode}` : null,
    input.urlWithLinkCode ? `Sign in: ${input.urlWithLinkCode}` : null,
    input.codeLifetime
      ? `This code expires in ${Math.round(input.codeLifetime / 1000 / 60)} minutes.`
      : null,
  ].filter(Boolean);
  return parts.join('\n') || 'Your Briven Auth message';
}

/**
 * Send auth email via briven-engine.
 */
export async function sendBrivenEngineEmail(
  input: EmailDeliveryInput,
): Promise<DeliveryResult> {
  const subject = input.subject ?? 'Your Briven Auth sign-in';
  const text = input.body ?? 'Briven Auth message';
  const html = `<pre style="font-family:monospace">${escapeHtml(text)}</pre>`;

  log.info('briven_engine_email', {
    engine: 'briven-engine',
    to: maskEmail(input.email),
    subject,
    type: input.type,
    hasBody: Boolean(input.body),
  });

  if (smtpConfigured()) {
    try {
      await sendViaSmtp({
        to: input.email,
        subject,
        text,
        html,
      });
      return {
        ok: true,
        channel: 'email',
        engine: 'briven-engine',
        mode: 'platform',
        message: 'sent via platform SMTP',
      };
    } catch (err) {
      log.warn('briven_engine_email_smtp_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (env.BRIVEN_ENV !== 'production') {
    log.debug('briven_engine_email_dev_body', {
      email: input.email,
      bodyPreview: text.slice(0, 200),
    });
  }

  return {
    ok: true,
    channel: 'email',
    engine: 'briven-engine',
    mode: 'log',
    message: smtpConfigured() ? 'smtp failed; logged' : 'logged (no SMTP configured)',
  };
}

/**
 * Send auth SMS via briven-engine (Twilio-compatible HTTP when secrets present).
 */
export async function sendBrivenEngineSms(
  input: SmsDeliveryInput,
): Promise<DeliveryResult> {
  const body = bodyFromSms(input);

  log.info('briven_engine_sms', {
    engine: 'briven-engine',
    phone: maskPhone(input.phoneNumber),
    type: input.type,
    hasCode: Boolean(input.userInputCode),
    hasLink: Boolean(input.urlWithLinkCode),
  });

  const projectId =
    input.projectId ??
    (typeof input.userContext?.projectId === 'string'
      ? input.userContext.projectId
      : undefined);

  if (projectId) {
    try {
      const secrets = await getBrivenEngineSmsSecrets(projectId);
      if (secrets) {
        const sent = await sendTwilioCompatibleSms({
          accountSid: secrets.accountSid,
          authToken: secrets.authToken,
          from: secrets.fromNumber,
          to: input.phoneNumber,
          body,
        });
        if (sent.ok) {
          return {
            ok: true,
            channel: 'sms',
            engine: 'briven-engine',
            mode: 'provider',
            message: 'sent via project SMS provider',
          };
        }
        log.warn('briven_engine_sms_provider_failed', { message: sent.message });
      }
    } catch (err) {
      log.warn('briven_engine_sms_secrets_error', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (env.BRIVEN_ENV !== 'production') {
    log.debug('briven_engine_sms_dev', {
      phone: input.phoneNumber,
      bodyPreview: body.slice(0, 160),
    });
  }

  return {
    ok: true,
    channel: 'sms',
    engine: 'briven-engine',
    mode: 'log',
    message: projectId
      ? 'logged (no SMS secrets for project or provider failed)'
      : 'logged (no projectId for SMS provider lookup)',
  };
}

async function sendTwilioCompatibleSms(opts: {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
}): Promise<{ ok: boolean; message?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(opts.accountSid)}/Messages.json`;
  const auth = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64');
  const form = new URLSearchParams({
    To: opts.to,
    From: opts.from,
    Body: opts.body,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, message: `provider ${res.status}: ${t.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

function maskEmail(email: string): string {
  const [u, d] = email.split('@');
  if (!d) return '***';
  const user = u ?? '';
  return `${user.slice(0, 1)}***@${d}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function passwordlessSmsDeliveryService() {
  return {
    service: {
      sendSms: async (input: {
        phoneNumber: string;
        userInputCode?: string;
        urlWithLinkCode?: string;
        codeLifetime?: number;
        type: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userContext?: any;
      }) => {
        await sendBrivenEngineSms({
          phoneNumber: input.phoneNumber,
          userInputCode: input.userInputCode,
          urlWithLinkCode: input.urlWithLinkCode,
          codeLifetime: input.codeLifetime,
          type: input.type,
          userContext: input.userContext,
          projectId:
            typeof input.userContext?.projectId === 'string'
              ? input.userContext.projectId
              : undefined,
          raw: input,
        });
      },
    },
  };
}

export function passwordlessEmailDeliveryService() {
  return {
    service: {
      sendEmail: async (input: {
        email: string;
        userInputCode?: string;
        urlWithLinkCode?: string;
        codeLifetime?: number;
        type: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userContext?: any;
      }) => {
        const bodyParts = [
          input.userInputCode ? `Your code: ${input.userInputCode}` : null,
          input.urlWithLinkCode ? `Magic link: ${input.urlWithLinkCode}` : null,
        ].filter(Boolean);
        await sendBrivenEngineEmail({
          email: input.email,
          subject: 'Your Briven Auth sign-in',
          body: bodyParts.join('\n') || 'Briven Auth message',
          type: input.type,
          userContext: input.userContext,
          projectId:
            typeof input.userContext?.projectId === 'string'
              ? input.userContext.projectId
              : undefined,
          raw: input,
        });
      },
    },
  };
}
