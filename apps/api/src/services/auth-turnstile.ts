import { log } from '../lib/logger.js';
import { env } from '../env.js';

/**
 * Cloudflare Turnstile server-side verification.
 *
 * The frontend renders an invisible Turnstile widget and sends the
 * resulting token as `turnstileToken` on sign-up / sign-in requests.
 * This module verifies the token against Cloudflare's siteverify endpoint.
 *
 * Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileVerifyResult {
  success: boolean;
  /** Error codes from Cloudflare when verification fails. */
  errorCodes?: string[];
  /** Human-readable message for frontend display. */
  message?: string;
}

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
}

/**
 * Verify a Turnstile token. Returns `{success:true}` when the token is
 * valid. Returns `{success:false}` with error codes when invalid or when
 * the secret key is not configured.
 *
 * In development (BRIVEN_ENV === 'development'), verification is skipped
 * and always succeeds if no secret is configured — so local development
 * doesn't require a Turnstile key pair.
 */
export async function verifyTurnstileToken(token: string): Promise<TurnstileVerifyResult> {
  const secret = env.BRIVEN_TURNSTILE_SECRET_KEY;

  if (!secret) {
    if (env.BRIVEN_ENV === 'development') {
      return { success: true };
    }
    log.warn('turnstile_secret_missing');
    return {
      success: false,
      errorCodes: ['secret-missing'],
      message: 'Turnstile is not configured on the server',
    };
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });

    const body = (await response.json()) as TurnstileResponse;

    if (body.success) {
      return { success: true };
    }

    const errorCodes = body['error-codes'] ?? ['unknown'];
    return {
      success: false,
      errorCodes,
      message: `Turnstile verification failed: ${errorCodes.join(', ')}`,
    };
  } catch (err) {
    log.warn('turnstile_verify_error', {
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      errorCodes: ['network-error'],
      message: 'Could not verify Turnstile token. Please try again.',
    };
  }
}
