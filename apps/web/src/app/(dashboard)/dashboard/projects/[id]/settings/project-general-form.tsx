'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { notifyDashboardChange } from '../../../../../../components/live-refresh';

interface Org {
  id: string;
  name: string;
  personal: boolean;
}

type SaveResult = { ok: true } | { ok: false; error: string };

interface Props {
  initial: { name: string; slug: string };
  update: (patch: { name?: string; slug?: string }) => Promise<SaveResult>;
  moveProject: (orgId: string) => Promise<SaveResult>;
  otherOrgs: Org[];
}

export function ProjectGeneralForm({ initial, update, moveProject, otherOrgs }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [moveOrg, setMoveOrg] = useState(otherOrgs[0]?.id ?? '');
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [generalSaved, setGeneralSaved] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveSaved, setMoveSaved] = useState(false);
  const [pendingUpdate, startUpdate] = useTransition();
  const [pendingMove, startMove] = useTransition();

  const dirty = name !== initial.name || slug !== initial.slug;

  function onSubmitGeneral(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dirty) return;
    setGeneralError(null);
    setGeneralSaved(false);
    const patch: { name?: string; slug?: string } = {};
    if (name.trim() !== initial.name) patch.name = name.trim();
    if (slug.trim() !== initial.slug) patch.slug = slug.trim();
    startUpdate(async () => {
      try {
        const result = await update(patch);
        if (result.ok) {
          setGeneralSaved(true);
          setTimeout(() => setGeneralSaved(false), 3000);
          router.refresh();
          notifyDashboardChange();
        } else {
          setGeneralError(result.error);
        }
      } catch (err) {
        setGeneralError(err instanceof Error ? err.message : 'save failed');
      }
    });
  }

  function onSubmitMove(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!moveOrg) return;
    setMoveError(null);
    setMoveSaved(false);
    startMove(async () => {
      try {
        const result = await moveProject(moveOrg);
        if (result.ok) {
          setMoveSaved(true);
          setTimeout(() => setMoveSaved(false), 3000);
          router.refresh();
          notifyDashboardChange();
        } else {
          setMoveError(result.error);
        }
      } catch (err) {
        setMoveError(err instanceof Error ? err.message : 'move failed');
      }
    });
  }

  return (
    <>
      <section>
        <h3 className="text-sm font-semibold text-[var(--color-text)]">General</h3>
        <p className="mt-1 max-w-xl text-xs text-[var(--color-text-muted)]">
          The project name appears in the dashboard. The slug shows in URLs and CLI prompts —
          keep it short, lowercase, and stable.
        </p>
        <form
          onSubmit={onSubmitGeneral}
          className="mt-4 flex max-w-xl flex-col gap-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5"
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              Name
            </span>
            <input
              type="text"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.currentTarget.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              Slug
            </span>
            <input
              type="text"
              value={slug}
              pattern="[a-z0-9](?:[a-z0-9\-]{0,30}[a-z0-9])?"
              maxLength={32}
              onChange={(e) => setSlug(e.currentTarget.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="text-xs">
              {generalError ? (
                <span role="alert" className="text-red-400">
                  {generalError}
                </span>
              ) : generalSaved ? (
                <span className="text-[var(--color-primary)]">saved ✓</span>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={pendingUpdate || !dirty}
              className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
            >
              {pendingUpdate ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>

      {otherOrgs.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            Move to another team
          </h3>
          <p className="mt-1 max-w-xl text-xs text-[var(--color-text-muted)]">
            Re-parents the project — billing rolls up to the new org from the next subscription
            event onward. Data, deployments, keys, and members stay attached.
          </p>
          <form
            onSubmit={onSubmitMove}
            className="mt-4 flex max-w-xl flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5"
          >
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                Target org
              </span>
              <select
                value={moveOrg}
                onChange={(e) => setMoveOrg(e.currentTarget.value)}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              >
                {otherOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.personal ? 'personal' : 'team'}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col items-end gap-1">
              <button
                type="submit"
                disabled={pendingMove || !moveOrg}
                className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
              >
                {pendingMove ? 'Moving…' : 'Move'}
              </button>
              <div className="text-xs">
                {moveError ? (
                  <span role="alert" className="text-red-400">
                    {moveError}
                  </span>
                ) : moveSaved ? (
                  <span className="text-[var(--color-primary)]">moved ✓</span>
                ) : null}
              </div>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
