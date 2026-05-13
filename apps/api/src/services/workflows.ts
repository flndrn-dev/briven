import { brivenError } from '@briven/shared';

/**
 * Workflows / durable execution — Phase 4 future-feature SKELETON.
 *
 * Like `branches.ts`, this file exists to pin the data model + API
 * shape today so the dashboard and CLI can wire against it, and the
 * full implementation lands incrementally without breaking consumers.
 *
 * The full implementation has four parts:
 *
 *   1. Meta-DB tables: `workflow_definitions` (versioned),
 *      `workflow_runs` (per-execution state), `workflow_steps` (per-
 *      step state with deterministic-replay seed). All cascade-delete
 *      with their parent project.
 *
 *   2. A `workflow()` wrapper in `@briven/cli/server` next to query /
 *      mutation / action. Authors declare a workflow as a function
 *      with explicit checkpoints — each `await ctx.step(...)` records
 *      its outcome so a crash mid-flight resumes from the last step
 *      instead of replaying side effects.
 *
 *   3. A worker process (`apps/workflow-worker` or as a mode on the
 *      runtime) that picks up `pending` runs from the queue, executes
 *      each step in a deno isolate, persists step outcomes, retries
 *      transient failures with exponential backoff.
 *
 *   4. Dashboard surface: list runs, step-by-step state inspector,
 *      manual retry / cancel buttons, audit-log integration.
 *
 * Today the code below is the type contract + a no-op stub. Calls
 * throw `not_implemented` so the dashboard renders an "available in
 * v2" banner instead of breaking.
 *
 * Design intent worth pinning before v1 ships:
 *
 *   - Workflows are deterministic-replay, not event-sourced. Each
 *     `await ctx.step(name, fn)` records `(stepName, outcome)`. On
 *     resume the worker replays the workflow body and short-circuits
 *     each step that already has a recorded outcome.
 *
 *   - External-system side effects (http calls, polar charges, email
 *     sends) MUST live inside a step — never inline in the workflow
 *     body. The worker hard-rejects a run that side-effects outside
 *     a step.
 *
 *   - The wire format for step outcomes is JSON + 1MB cap. Outcomes
 *     beyond that get an opaque id; the actual payload lives in
 *     object storage.
 */

export interface WorkflowDefinition {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly version: number;
  readonly bundle: string; // path to the compiled workflow function
  readonly createdAt: Date;
}

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface WorkflowRun {
  readonly id: string;
  readonly workflowId: string;
  readonly projectId: string;
  readonly status: WorkflowRunStatus;
  readonly input: unknown;
  readonly result: unknown;
  readonly error: { code: string; message: string } | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  /** Step outcomes by name. Empty until the worker runs steps. */
  readonly steps: Readonly<Record<string, WorkflowStepOutcome>>;
}

export interface WorkflowStepOutcome {
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed';
  readonly attempt: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly result: unknown;
  readonly error: { code: string; message: string } | null;
}

export interface TriggerWorkflowInput {
  readonly projectId: string;
  readonly workflowName: string;
  readonly input: unknown;
}

export async function triggerWorkflow(_input: TriggerWorkflowInput): Promise<WorkflowRun> {
  throw new brivenError(
    'not_implemented',
    'workflows are a Phase 4 feature — see docs/BUILD_PLAN.md',
    { status: 501 },
  );
}

export async function listWorkflowRuns(
  _projectId: string,
  _options?: { workflowName?: string; status?: WorkflowRunStatus; limit?: number },
): Promise<readonly WorkflowRun[]> {
  // Returns empty until the worker ships. Dashboard renders the
  // "no runs yet" empty state, which is accurate.
  return [];
}

export async function getWorkflowRun(
  _projectId: string,
  _runId: string,
): Promise<WorkflowRun | null> {
  return null;
}

export async function cancelWorkflowRun(_projectId: string, _runId: string): Promise<void> {
  throw new brivenError(
    'not_implemented',
    'workflows are a Phase 4 feature — see docs/BUILD_PLAN.md',
    { status: 501 },
  );
}
