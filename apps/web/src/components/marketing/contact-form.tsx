'use client';

import { useState } from 'react';

import { ROUTING_TAGS, SubjectTagsInput } from './subject-tags-input';

interface Props {
  apiOrigin: string;
  /** Pre-selected topic (e.g. from a /contact?topic=privacy deep link). Falls
   *  back to 'general' when absent or not a known topic. */
  initialTopic?: string;
  /** Country auto-detected server-side from the visitor's IP. The field is
   *  LOCKED — the visitor can't edit it. `null` when it can't be resolved. */
  initialCountry?: { code: string; name: string } | null;
  /** Pre-fill the name field (e.g. the logged-in user's name on the
   *  in-dashboard support page). Stays editable. */
  initialName?: string;
  /** Pre-fill the email field (e.g. the logged-in user's email). Stays
   *  editable so they can reply from a different address if they want. */
  initialEmail?: string;
}

type Topic =
  | 'general'
  | 'support'
  | 'sales'
  | 'self-host'
  | 'security'
  | 'privacy'
  | 'legal'
  | 'other';

const TOPICS: readonly { value: Topic; label: string }[] = [
  { value: 'general', label: 'general' },
  { value: 'support', label: 'support' },
  { value: 'sales', label: 'sales' },
  { value: 'self-host', label: 'self-host' },
  { value: 'security', label: 'security' },
  { value: 'privacy', label: 'privacy' },
  { value: 'legal', label: 'legal' },
  { value: 'other', label: 'other' },
];

/** Coerce an untrusted URL value to a known topic; default 'general'. */
function coerceTopic(value: string | undefined): Topic {
  return TOPICS.some((t) => t.value === value) ? (value as Topic) : 'general';
}

interface SubmittedState {
  requestId: string;
}

const FIELD_CLASS =
  'rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]';

/**
 * Public, unauthenticated contact form. Embedded on /contact so anyone
 * can reach us before signing up. Posts to /v1/contact on the api origin
 * (rate-limited 5/hr per IP) and renders an inline success state with the
 * briven reference id. We collect the sender's email so we can reply
 * privately — but we never render an email address back to the page.
 *
 * The `country` field is locked: it's pre-filled from a server-side geo-IP
 * lookup and submitted with the message, but the visitor can't change it.
 */
export function ContactForm({
  apiOrigin,
  initialTopic,
  initialCountry,
  initialName,
  initialEmail,
}: Props) {
  const [name, setName] = useState(initialName ?? '');
  const [email, setEmail] = useState(initialEmail ?? '');
  // Locked, read-only value sent to the backend. Never editable in the UI.
  const country = initialCountry ?? null;
  const [subject, setSubject] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  // Topic still routes the ticket server-side; it now defaults from the page
  // (e.g. 'support' on the dashboard) and from the #tags typed in the subject —
  // the explicit dropdown was redundant, so it was removed.
  const [topic] = useState<Topic>(coerceTopic(initialTopic));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedState | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    // Serialise the #tag chips + free text into the single subject string the
    // api already accepts (the admin dashboard reads the #tags back out for
    // routing). No backend change needed until structured tags land.
    const subjectPayload = [tags.map((t) => `#${t}`).join(' '), subject.trim()]
      .filter(Boolean)
      .join(' ')
      .trim();
    try {
      const res = await fetch(`${apiOrigin}/v1/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          topic,
          message: message.trim(),
          // Optional extras — only sent when present so the backend's
          // optional() schema stays happy on older clients.
          ...(subjectPayload ? { subject: subjectPayload } : {}),
          ...(country ? { country: country.name } : {}),
        }),
      });
      if (res.status === 429) {
        setError('too many messages from this address recently. wait an hour and try again.');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? `submit failed: ${res.status}`);
        return;
      }
      const data = (await res.json()) as { requestId: string };
      setSubmitted({ requestId: data.requestId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit failed');
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] p-6">
        <p className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h4)]">
          got it · we&apos;ll get back to you within one business day
        </p>
        <p className="mt-3 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
          your message is queued. we&apos;ll reply to the address you gave us — keep an eye
          on your inbox. no marketing emails, ever.
        </p>
        <p className="mt-4 font-mono text-xs text-[var(--color-text-subtle)]">
          reference:{' '}
          <code className="text-[var(--color-text-muted)]">{submitted.requestId}</code>
        </p>
        <p className="mt-3 font-mono text-[10px] text-[var(--color-text-subtle)]">
          if you don&apos;t hear back within one business day, wait an hour and send it again,
          quoting the reference above.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6"
    >
      {/* 1 — name + email side by side */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            name <span className="text-[var(--color-text-subtle)]">(required)</span>
          </span>
          <input
            type="text"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="your name"
            className={FIELD_CLASS}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            email <span className="text-[var(--color-text-subtle)]">(required)</span>
          </span>
          <input
            type="email"
            required
            maxLength={320}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="so we can reply"
            className={FIELD_CLASS}
          />
        </label>
      </div>

      {/* 2 — country, full width + locked (auto-filled from geo-IP) */}
      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">country</span>
        <input
          type="text"
          readOnly
          disabled
          aria-readonly="true"
          value={country ? country.name : 'unknown'}
          className="cursor-not-allowed rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] opacity-80 outline-none"
        />
        <span className="font-mono text-[11px] text-[var(--color-text-subtle)]">
          based on your location — contact support to change.
        </span>
      </label>

      {/* 3 — subject (#tag chips) with the available routing topics shown tight
          beneath it, so the form reads as one clean block. */}
      <div className="flex flex-col gap-2">
        <SubjectTagsInput
          tags={tags}
          onTagsChange={setTags}
          text={subject}
          onTextChange={setSubject}
        />

        <div className="flex flex-col gap-1.5">
          <span className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[10px]">
            topic
          </span>
          <div className="grid grid-cols-4 gap-2">
            {ROUTING_TAGS.map((t) => (
              <span
                key={t}
                className="font-mono text-[var(--color-text-subtle)] text-[var(--text-xs)]"
              >
                #{t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 4 — message */}
      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          message{' '}
          <span className="text-[var(--color-text-subtle)]">(required)</span>
        </span>
        <textarea
          required
          rows={6}
          maxLength={8000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="what can we help with?"
          className={FIELD_CLASS}
        />
      </label>

      {error ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{error}</p>
      ) : null}

      {/* 5 — submit */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !name.trim() || !email.trim() || !message.trim()}
          className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 font-sans font-medium text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'sending…' : 'send message'}
        </button>
        <span className="font-mono text-[11px] text-[var(--color-text-subtle)]">
          we read what you send to help you. no marketing emails, ever.
        </span>
      </div>
    </form>
  );
}
