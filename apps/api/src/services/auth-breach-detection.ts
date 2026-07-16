import { createHash } from 'node:crypto';

import { log } from '../lib/logger.js';

/**
 * Password breach detection via Have I Been Pwned (HIBP) k-anonymity API.
 *
 * When enabled per tenant, every password set during sign-up or password
 * change is checked against the HIBP breach database. The check uses the
 * k-anonymity protocol: we send only the first 5 hex chars of the SHA-1
 * hash, and HIBP returns suffixes + breach counts. No full password or
 * full hash ever leaves our servers.
 *
 * Reference: https://haveibeenpwned.com/API/v3#SearchingPwnedPasswordsByRange
 */

const HIBP_API_URL = 'https://api.pwnedpasswords.com/range';

function sha1Prefix(password: string): string {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  return hash.slice(0, 5);
}

function sha1Suffix(password: string): string {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  return hash.slice(5);
}

export interface BreachCheckResult {
  breached: boolean;
  /** How many times this password appears in known breaches. 0 if not breached. */
  breachCount: number;
}

/**
 * Check whether a password has been breached. Returns `{breached:false}`
 * on any network or parsing error (fail-open so HIBP downtime doesn't
 * break sign-ups).
 */
export async function checkPasswordBreach(password: string): Promise<BreachCheckResult> {
  const prefix = sha1Prefix(password);
  const suffix = sha1Suffix(password);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${HIBP_API_URL}/${prefix}`, {
      method: 'GET',
      headers: {
        'Add-Padding': 'true',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      log.warn('hibp_api_error', { status: response.status });
      return { breached: false, breachCount: 0 };
    }

    const text = await response.text();
    const lines = text.split('\n');

    for (const line of lines) {
      const [lineSuffix, countStr] = line.split(':');
      if (lineSuffix?.trim() === suffix) {
        const count = parseInt(countStr?.trim() ?? '0', 10);
        return { breached: true, breachCount: count };
      }
    }

    return { breached: false, breachCount: 0 };
  } catch (err) {
    log.warn('hibp_check_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    // Fail-open: don't block sign-ups because HIBP is unreachable.
    return { breached: false, breachCount: 0 };
  }
}
