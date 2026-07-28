'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  projectId: string;
  /** Optional publishable pk_briven_auth_… (apps that inject via proxy can omit). */
  authPublicKey?: string | null;
}

// ── base64url helpers ────────────────────────────────────────────────────────

function base64urlToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const base64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

interface WebAuthnAllowedCredential {
  id: string;
  type: string;
  transports?: AuthenticatorTransport[];
}

interface WebAuthnAuthOptions {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: WebAuthnAllowedCredential[];
}

/**
 * Sign in with passkey — briven-engine FDI (not retired auth-tenant).
 *
 *   POST /api/auth/webauthn/signin/options
 *   navigator.credentials.get()
 *   POST /api/auth/webauthn/signin/finish  { challengeId, credential }
 */
export function PasskeySignIn({ projectId, authPublicKey }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fdi(path: string, body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-briven-project-id': projectId,
      rid: 'webauthn',
      'st-auth-mode': 'cookie',
    };
    if (authPublicKey?.startsWith('pk_briven_auth_')) {
      headers.authorization = `Bearer ${authPublicKey}`;
    }
    return fetch(`/api/auth${path}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
  }

  async function handlePasskeySignIn(): Promise<void> {
    if (!window.PublicKeyCredential) {
      setError('your browser does not support passkeys');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const rpId = window.location.hostname;
      const expectedOrigin = window.location.origin;

      const optRes = await fdi('/webauthn/signin/options', { rpId, expectedOrigin });
      if (!optRes.ok) {
        if (optRes.status === 401) {
          throw new Error(
            'passkey sign-in needs a project Auth public key (pk_briven_auth_…) on this host',
          );
        }
        if (optRes.status === 404 || optRes.status === 501) {
          throw new Error('passkey sign-in is not enabled for this project');
        }
        const err = (await optRes.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        throw new Error(err.message ?? err.code ?? `http ${optRes.status}`);
      }
      const data = (await optRes.json()) as {
        status?: string;
        challengeId?: string;
        options?: WebAuthnAuthOptions;
        challenge?: string;
      };
      if (data.status && data.status !== 'OK') {
        throw new Error(data.status);
      }
      const challengeId = String(data.challengeId ?? '');
      const options = (data.options ?? data) as WebAuthnAuthOptions;
      if (!options.challenge || !challengeId) {
        throw new Error('passkey challenge missing from server');
      }

      let credential: PublicKeyCredential | null = null;
      try {
        credential = (await navigator.credentials.get({
          publicKey: {
            challenge: base64urlToUint8Array(options.challenge),
            rpId: options.rpId ?? rpId,
            timeout: options.timeout,
            userVerification: options.userVerification,
            allowCredentials: (options.allowCredentials ?? []).map((c) => ({
              id: base64urlToUint8Array(c.id),
              type: c.type as PublicKeyCredentialType,
              transports: c.transports,
            })),
          },
        })) as PublicKeyCredential | null;
      } catch (getErr) {
        if (getErr instanceof DOMException && getErr.name === 'NotAllowedError') {
          throw new Error('passkey prompt was dismissed');
        }
        throw getErr;
      }

      if (!credential) throw new Error('passkey prompt was cancelled');

      const assertion = credential.response as AuthenticatorAssertionResponse;
      const credentialJson = {
        id: credential.id,
        rawId: uint8ArrayToBase64url(new Uint8Array(credential.rawId)),
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults(),
        authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
        response: {
          authenticatorData: uint8ArrayToBase64url(new Uint8Array(assertion.authenticatorData)),
          clientDataJSON: uint8ArrayToBase64url(new Uint8Array(assertion.clientDataJSON)),
          signature: uint8ArrayToBase64url(new Uint8Array(assertion.signature)),
          userHandle: assertion.userHandle
            ? uint8ArrayToBase64url(new Uint8Array(assertion.userHandle))
            : undefined,
        },
      };

      const verRes = await fdi('/webauthn/signin/finish', {
        challengeId,
        credential: credentialJson,
        response: credentialJson,
        rpId,
        expectedOrigin,
      });
      if (!verRes.ok) {
        const err = (await verRes.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        throw new Error(err.message ?? err.code ?? 'passkey verification failed');
      }

      router.push(`/auth/${projectId}/account`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'passkey sign-in failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void handlePasskeySignIn()}
        disabled={pending}
        className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
      >
        {pending ? 'waiting for passkey…' : 'sign in with passkey'}
      </button>
      {error ? (
        <p className="font-mono text-[11px] text-[var(--color-error)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
