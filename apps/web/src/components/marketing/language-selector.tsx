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
    <label className="inline-flex items-center" title="language">
      <span className="sr-only">language</span>
      <select
        value={locale}
        onChange={onChange}
        aria-label="select language"
        className="cursor-pointer border-0 bg-transparent py-0.5 pl-0 pr-5 font-mono text-[10px] text-[var(--color-text-muted)] outline-none transition-colors hover:text-[var(--color-text)]"
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
