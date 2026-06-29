'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  projectId: string;
}

// ── base64url helpers (no external dep needed) ───────────────────────────────

function base64urlToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const base64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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

interface ErrorBody {
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
}

/**
 * "Sign in with passkey" button for the hosted sign-in flow.
 *
 * Flow (@better-auth/passkey@1.6.9, two-leg WebAuthn ceremony — endpoint ids
 * confirmed from the installed plugin dist):
 *   1. GET  /api/v1/auth-tenant/passkey/generate-authenticate-options — challenge
 *   2. navigator.credentials.get() — browser prompts the user
 *   3. POST /api/v1/auth-tenant/passkey/verify-authentication — body { response }
 *      (the serialised assertion); the api sets the session cookie on success
 */
export function PasskeySignIn({ projectId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePasskeySignIn(): Promise<void> {
    if (!window.PublicKeyCredential) {
      setError('your browser does not support passkeys');
      return;
    }
    setPending(true);
    setError(null);
    try {
      // Step 1: authentication options (challenge). GET.
      const optRes = await fetch('/api/v1/auth-tenant/passkey/generate-authenticate-options', {
        method: 'GET',
        credentials: 'include',
        headers: { 'x-briven-project-id': projectId },
      });
      if (!optRes.ok) {
        if (optRes.status === 404 || optRes.status === 501) {
          throw new Error('passkey sign-in is not enabled for this account');
        }
        const err = (await optRes.json().catch(() => ({}))) as ErrorBody;
        throw new Error(err.error?.message ?? err.message ?? err.code ?? `http ${optRes.status}`);
      }
      const opts = (await optRes.json()) as WebAuthnAuthOptions;

      // Step 2: browser WebAuthn credential retrieval. Challenge + allowed
      // credential ids arrive base64url-encoded and must be decoded.
      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: base64urlToUint8Array(opts.challenge),
          rpId: opts.rpId,
          timeout: opts.timeout,
          userVerification: opts.userVerification,
          allowCredentials: (opts.allowCredentials ?? []).map((c) => ({
            id: base64urlToUint8Array(c.id),
            type: c.type as PublicKeyCredentialType,
            transports: c.transports,
          })),
        },
      })) as PublicKeyCredential | null;

      if (!credential) throw new Error('passkey prompt was cancelled');

      const assertion = credential.response as AuthenticatorAssertionResponse;

      // Step 3: serialise the assertion to @simplewebauthn JSON, wrapped in
      // `{ response }`, and verify; the api sets the session cookie on success.
      const verRes = await fetch('/api/v1/auth-tenant/passkey/verify-authentication', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-briven-project-id': projectId,
        },
        body: JSON.stringify({
          response: {
            id: credential.id,
            rawId: uint8ArrayToBase64url(new Uint8Array(credential.rawId)),
            type: credential.type,
            clientExtensionResults: credential.getClientExtensionResults(),
            authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
            response: {
              authenticatorData: uint8ArrayToBase64url(
                new Uint8Array(assertion.authenticatorData),
              ),
              clientDataJSON: uint8ArrayToBase64url(new Uint8Array(assertion.clientDataJSON)),
              signature: uint8ArrayToBase64url(new Uint8Array(assertion.signature)),
              userHandle: assertion.userHandle
                ? uint8ArrayToBase64url(new Uint8Array(assertion.userHandle))
                : undefined,
            },
          },
        }),
      });

      if (!verRes.ok) {
        const err = (await verRes.json().catch(() => ({}))) as ErrorBody;
        throw new Error(
          err.error?.message ?? err.message ?? err.code ?? 'passkey verification failed',
        );
      }

      router.push(`/auth/${projectId}/account`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('passkey prompt was dismissed');
      } else {
        setError(err instanceof Error ? err.message : 'passkey sign-in failed');
      }
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
