'use client';

import { useState } from 'react';

interface Props {
  projectId: string;
}

// ── base64url helpers ────────────────────────────────────────────────────────

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

interface WebAuthnCredentialDescriptor {
  id: string;
  type: string;
  transports?: AuthenticatorTransport[];
}

interface WebAuthnCreationOptions {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: WebAuthnCredentialDescriptor[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
}

interface ErrorBody {
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
}

/**
 * "Register a passkey" button for the hosted account page.
 *
 * Flow (@better-auth/passkey@1.6.9, two-leg WebAuthn ceremony — endpoint ids
 * confirmed from the installed plugin dist):
 *   1. GET  /api/v1/auth-tenant/passkey/generate-register-options — creation
 *      options (requires a fresh session; this lives on the post-login account
 *      page so the cookie rides along)
 *   2. navigator.credentials.create() — browser creates the passkey
 *   3. POST /api/v1/auth-tenant/passkey/verify-registration — body { response }
 *      (the serialised credential) to verify and store
 */
export function PasskeyRegister({ projectId }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleRegister(): Promise<void> {
    if (!window.PublicKeyCredential) {
      setError('your browser does not support passkeys');
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      // Step 1: registration options (plugin requires a fresh session). GET.
      const optRes = await fetch('/api/v1/auth-tenant/passkey/generate-register-options', {
        method: 'GET',
        credentials: 'include',
        headers: { 'x-briven-project-id': projectId },
      });
      if (!optRes.ok) {
        if (optRes.status === 404 || optRes.status === 501) {
          throw new Error('passkey registration is not available for this account');
        }
        const err = (await optRes.json().catch(() => ({}))) as ErrorBody;
        throw new Error(err.error?.message ?? err.message ?? err.code ?? `http ${optRes.status}`);
      }
      const opts = (await optRes.json()) as WebAuthnCreationOptions;

      // Step 2: browser creates the passkey. Challenge + every credential id
      // arrive base64url-encoded and must be decoded to byte buffers.
      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: base64urlToUint8Array(opts.challenge),
          rp: opts.rp,
          user: {
            id: base64urlToUint8Array(opts.user.id),
            name: opts.user.name,
            displayName: opts.user.displayName,
          },
          pubKeyCredParams: opts.pubKeyCredParams,
          timeout: opts.timeout,
          excludeCredentials: (opts.excludeCredentials ?? []).map((c) => ({
            id: base64urlToUint8Array(c.id),
            type: c.type as PublicKeyCredentialType,
            transports: c.transports,
          })),
          authenticatorSelection: opts.authenticatorSelection,
          attestation: opts.attestation,
        },
      })) as PublicKeyCredential | null;

      if (!credential) throw new Error('passkey creation was cancelled');

      const attestation = credential.response as AuthenticatorAttestationResponse;

      // Step 3: serialise the credential to @simplewebauthn JSON, wrapped in
      // `{ response }`, and verify. The plugin joins `response.transports`
      // unconditionally, so it must be present (empty array when none).
      const verRes = await fetch('/api/v1/auth-tenant/passkey/verify-registration', {
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
              clientDataJSON: uint8ArrayToBase64url(new Uint8Array(attestation.clientDataJSON)),
              attestationObject: uint8ArrayToBase64url(
                new Uint8Array(attestation.attestationObject),
              ),
              transports: attestation.getTransports ? attestation.getTransports() : [],
            },
          },
        }),
      });

      if (!verRes.ok) {
        const err = (await verRes.json().catch(() => ({}))) as ErrorBody;
        throw new Error(
          err.error?.message ?? err.message ?? err.code ?? 'passkey registration failed',
        );
      }

      setSuccess(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('passkey prompt was dismissed');
      } else {
        setError(err instanceof Error ? err.message : 'passkey registration failed');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-4">
      <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">passkey</p>
      {success ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          passkey registered — you can now sign in without a password.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void handleRegister()}
          disabled={pending}
          className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
        >
          {pending ? 'registering…' : 'register a passkey'}
        </button>
      )}
      {error ? (
        <p className="font-mono text-[11px] text-[var(--color-error)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
