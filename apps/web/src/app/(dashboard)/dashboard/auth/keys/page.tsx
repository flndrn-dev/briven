import { BrivenEngineKeysForm } from './keys-form';

export const metadata = { title: 'Auth · keys' };
export const dynamic = 'force-dynamic';

export default function KeysPage() {
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          keys
        </h1>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          API keys your apps use to talk to Auth
        </p>
      </header>

      <p className="max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        Create a key once, copy it into your app, and treat it like a password.
      </p>

      <BrivenEngineKeysForm />
    </section>
  );
}
