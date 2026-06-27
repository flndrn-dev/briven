'use client';

import { useEffect, useState } from 'react';

/**
 * Footer language selector. English is the main (default) language; the others
 * are written in their OWN language so a speaker recognises their own.
 *
 * Scope note: this control records the visitor's preferred locale in the
 * standard `NEXT_LOCALE` cookie so the choice is remembered and is ready for
 * i18n. It does NOT yet translate page text — full multilingual content is a
 * separate, larger build. Until then, picking a language is remembered but the
 * copy stays English.
 */
const LANGUAGES: readonly { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'tr', label: 'Türkçe' },
];

function readLocaleCookie(): string {
  if (typeof document === 'undefined') return 'en';
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : 'en';
}

export function LanguageSelector() {
  // Default to English on the server + first paint; sync to the saved choice
  // after mount (cookies aren't readable during SSR here).
  const [locale, setLocale] = useState('en');

  useEffect(() => {
    setLocale(readLocaleCookie());
  }, []);

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    setLocale(next);
    // Site-wide, one year. Lax so normal top-level navigations carry it.
    document.cookie = `NEXT_LOCALE=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <label className="inline-flex items-center gap-1.5" title="language">
      <span className="sr-only">language</span>
      {/* lucide globe — inherits text color */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-[var(--color-text-subtle)]"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <select
        value={locale}
        onChange={onChange}
        aria-label="select language"
        className="cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-transparent py-0.5 pl-1.5 pr-5 font-mono text-[10px] text-[var(--color-text-muted)] outline-none transition-colors hover:text-[var(--color-text)] focus:border-[var(--color-border)]"
      >
        {LANGUAGES.map((language) => (
          <option
            key={language.code}
            value={language.code}
            className="bg-[var(--color-surface)] text-[var(--color-text)]"
          >
            {language.label}
          </option>
        ))}
      </select>
    </label>
  );
}
