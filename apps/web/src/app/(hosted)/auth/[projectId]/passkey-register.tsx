'use client';

import { useState } from 'react';

interface Props {
  projectId: string;
  /** Optional publishable pk_briven_auth_… */
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

/**
 * Register a passkey — briven-engine FDI (session cookie required).
 *
 * SuperTokens model: sign in first (magic link / OTP / password), then add passkey.
 */
export function PasskeyRegister({ projectId, authPublicKey }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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

  async function handleRegister(): Promise<void> {
    if (!window.PublicKeyCredential) {
      setError('your browser does not support passkeys');
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const rpId = window.location.hostname;
      const expectedOrigin = window.location.origin;

      const optRes = await fdi('/webauthn/register/options', { rpId, expectedOrigin });
      if (!optRes.ok) {
        if (optRes.status === 401) {
          throw new Error('sign in first, then add a passkey');
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
        options?: WebAuthnCreationOptions;
      };
      if (data.status && data.status !== 'OK') {
        throw new Error(data.status);
      }
      const challengeId = String(data.challengeId ?? '');
      const opts = (data.options ?? data) as WebAuthnCreationOptions;
      if (!opts.challenge || !challengeId) {
        throw new Error('passkey registration challenge missing');
      }

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
      const credentialJson = {
        id: credential.id,
        rawId: uint8ArrayToBase64url(new Uint8Array(credential.rawId)),
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults(),
        authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
        response: {
          clientDataJSON: uint8ArrayToBase64url(new Uint8Array(attestation.clientDataJSON)),
          attestationObject: uint8ArrayToBase64url(new Uint8Array(attestation.attestationObject)),
          transports: attestation.getTransports ? attestation.getTransports() : [],
        },
      };

      const verRes = await fdi('/webauthn/register/finish', {
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
        throw new Error(err.message ?? err.code ?? 'passkey registration failed');
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
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void handleRegister()}
        disabled={pending || success}
        className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
      >
        {success ? 'passkey saved' : pending ? 'waiting for passkey…' : 'add a passkey'}
      </button>
      {error ? (
        <p className="font-mono text-[11px] text-[var(--color-error)]" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
          next time you can sign in with this passkey on this site
        </p>
      ) : null}
    </div>
  );
}
