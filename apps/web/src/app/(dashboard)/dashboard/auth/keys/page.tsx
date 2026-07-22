import { BrivenEngineKeysForm } from './keys-form';

export const metadata = { title: 'Briven Auth · keys' };
export const dynamic = 'force-dynamic';

export default function KeysPage() {
  return (
    <section className="flex flex-col gap-4">
      <p
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        briven-engine · keys
      </p>
      <h2 className="font-mono text-sm text-[var(--color-text)]">
        API keys for your apps
      </h2>
      <p className="max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        Create a key once, copy it into your app, and treat it like a password.
        Engine: briven-engine.
      </p>
      <BrivenEngineKeysForm />
    </section>
  );
}
