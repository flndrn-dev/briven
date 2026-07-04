'use client';

import { useRef, type KeyboardEvent } from 'react';

interface Props {
  /** Committed tags (without the leading #). */
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  /** Free-text subject line typed alongside the chips. */
  text: string;
  onTextChange: (text: string) => void;
}

const MAX_TAGS = 4;

/** Only these #tags become chips — they drive priority routing in the admin
 *  dashboard. Typing any other #word is left as ordinary text. Exported so the
 *  contact form can show the same set as the "topic" reference grid (single
 *  source of truth — no drift between the chips and the legend). */
export const ROUTING_TAGS = ['support', 'billing', 'technical', 'self-hosting'] as const;

/** Strip leading #, lowercase, keep [a-z0-9-]. Returns '' when nothing usable. */
function normalizeTag(raw: string): string {
  return raw.replace(/^#+/, '').toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/**
 * Subject field with #tag chips (Briven teal). Type a `#tag` then space / tab /
 * enter and the trailing #token becomes a chip with an × to remove it;
 * backspace on an empty field pops the last chip. The remaining free text is the
 * short subject line. The tags are meant to route + triage the ticket in the
 * admin dashboard. Colours come from the shared theme tokens so the chip matches
 * the primary button exactly.
 */
export function SubjectTagsInput({ tags, onTagsChange, text, onTextChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function addTag(raw: string): boolean {
    const t = normalizeTag(raw);
    if (
      !t ||
      !(ROUTING_TAGS as readonly string[]).includes(t) ||
      tags.includes(t) ||
      tags.length >= MAX_TAGS
    ) {
      return false;
    }
    onTagsChange([...tags, t]);
    return true;
  }

  function removeTag(t: string) {
    onTagsChange(tags.filter((x) => x !== t));
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Backspace on an empty field pops the last chip.
    if (e.key === 'Backspace' && text === '' && tags.length > 0) {
      e.preventDefault();
      removeTag(tags[tags.length - 1]!);
      return;
    }
    // Commit a trailing #token to a chip on space / tab / enter. When there's no
    // trailing #token we let the key behave normally (space types, tab moves
    // focus, enter submits the form).
    if (e.key === ' ' || e.key === 'Tab' || e.key === 'Enter') {
      const match = /(?:^|\s)(#[A-Za-z0-9][A-Za-z0-9-]*)\s*$/.exec(text);
      // Only consume the token when it's a known routing tag; an unknown #word
      // is left in place as ordinary text.
      if (match && addTag(match[1]!)) {
        e.preventDefault();
        onTextChange(text.slice(0, match.index).replace(/\s+$/, ''));
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-muted)] text-[var(--text-xs)]">
        subject
      </span>

      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-11 flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 transition-colors focus-within:border-[var(--color-primary)]"
        style={{
          backgroundColor: 'var(--color-bg)',
          backgroundImage:
            'radial-gradient(135% 135% at 50% 135%, color-mix(in oklch, var(--color-primary) 16%, transparent), transparent 62%)',
        }}
      >
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-[6px] bg-[var(--color-primary)] px-2 py-0.5 font-mono font-medium text-[var(--color-text-inverse)] text-[var(--text-xs)]"
          >
            #{t}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(t);
              }}
              aria-label={`remove tag ${t}`}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full leading-none text-[var(--color-text-inverse)] opacity-75 transition hover:bg-black/20 hover:opacity-100"
            >
              ×
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          aria-label="subject"
          value={text}
          maxLength={200}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            tags.length > 0
              ? 'describe your issue…'
              : "what's this about? type #support, #billing, #technical or #self-hosting"
          }
          className="min-w-[10rem] flex-1 bg-transparent font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
        />
      </div>
    </div>
  );
}
