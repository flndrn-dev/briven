# AI.md — Ollama model setup for briven's AI features

**Audience:** operator wiring the AI backend for a briven deployment.
**Scope:** which model to run, how to point briven at it, how to differentiate models per feature if you want quality-per-task.

The AI features (`/dashboard/projects/:id/ai-schema`, `/ai-function`, `/ai-explain`, and `briven ai …` from the CLI) are gated by a single env var on the api host: `BRIVEN_OLLAMA_URL`. When it's unset every AI endpoint returns `503 not_configured` and the dashboard renders a clear "AI assistant offline" state. When it's set, the api forwards prompts to Ollama's `POST /api/generate` and surfaces the response. Prompts and responses are **not logged** (CLAUDE.md §5.1 — operator might paste real business names into a prompt). Only prompt length + elapsed ms + status code go to the log stream.

**Two backend shapes** are supported with the same env contract:

| Setup | URL shape | Auth |
|---|---|---|
| **Production proxy** (current) | `https://ai.flndrn.com` | `X-API-Key: <key>` via `BRIVEN_OLLAMA_API_KEY` |
| **Local DGX** (coming soon) | `http://<dgx-host>:11434` | No auth — relies on private-network reachability |

The code branches on `BRIVEN_OLLAMA_API_KEY` — sends the `X-API-Key` header when set, omits it when unset. Switching from the proxy to the local DGX is a config change, not a code change.

> **Why X-API-Key, not Authorization: Bearer:** the Ollama Console proxy at `ai.flndrn.com` rejects Bearer with `401 Unauthorized - Invalid API key`. `X-API-Key` is the proxy's only accepted scheme today. Bearer support is the industry default (OpenAI, Anthropic, Polar, Stripe all use it) so the proxy ought to grow it too — when it does, briven can add a `BRIVEN_OLLAMA_AUTH_HEADER` env toggle. Until then, X-API-Key is hard-wired.

---

## What briven's AI features actually do

| Feature | Endpoint | Workload shape |
|---|---|---|
| **schema generator** | `POST /v1/projects/:id/ai/generate-schema` | NL prompt → typescript schema DSL. Highly structured output. Low temperature (0.2). System prompt does ~80% of the structural work. |
| **function generator** | `POST /v1/projects/:id/ai/generate-function` | NL prompt + optional schema context → typescript function file with imports, validation, error wrapping. Needs the model to actually read the provided schema. Temp 0.3. |
| **explain code** | `POST /v1/projects/:id/ai/explain-code` | Code snippet → plain-english walkthrough framed in briven idioms (query vs mutation, ctx.db chains, brivenError, sharp edges). Some reasoning helps. Temp 0.4. |
| **docs assistant** (queued) | wraps `/api/search?q=…` | Retrieval-augmented Q&A across the docs corpus. Retrieval does the heavy lifting; model summarises with citations. |

All four are **typescript + postgres-shaped**. Not creative writing. Not multi-step reasoning. Strong code performance + good instruction-following beats raw model size.

---

## Recommendation — single model

**`qwen2.5-coder:32b-instruct` (Q5_K_M quantisation).**

Why specifically that:

- **Qwen 2.5-Coder is the strongest open code model in the 32B class** as of late 2025. Typescript / postgres / SQL are its sweet spot.
- **~24 GB VRAM at Q5_K_M** — fits comfortably on a single A100 80 GB or H100 80 GB, leaves headroom for the KV cache during long contexts (function gen with full schema context uses ~6–12 k tokens).
- **40–60 tok/s on H100** → schema/function gen returns in ~3–6 s, which feels live on a synchronous dashboard request.
- **Instruction-following is excellent** — exactly the regime briven's system prompts use ("Rules: …. Example shape: ….  Return ONLY the code, no prose, no markdown fences."). Qwen reliably copies the example shape verbatim.
- **Free, open weights, no API cost.**

That's what `BRIVEN_OLLAMA_MODEL` defaults to in `apps/api/src/env.ts`. You don't need to override it unless you want a different model.

### Setup — production proxy (current)

The hosted proxy at `ai.flndrn.com` exposes a standard Ollama-compatible `/api/generate` endpoint behind a bearer token. On the briven api host (Dokploy env or `.env`):

```bash
BRIVEN_OLLAMA_URL=https://ai.flndrn.com
BRIVEN_OLLAMA_API_KEY=<your bearer token>
BRIVEN_OLLAMA_MODEL=Qwen2.5-coder:latest
```

Restart the api container. Hit `https://briven.tech/dashboard/projects/<your-project-id>/ai-schema` — the 503 disappears and a prompt returns a draft schema.

**Key handling:** treat `BRIVEN_OLLAMA_API_KEY` exactly like a Polar / Stripe API key — Dokploy stores it encrypted, never check it into git, rotate quarterly. The api never logs the key (CLAUDE.md §5.1).

### Setup — local DGX (planned)

When the DGX hardware lands the env flips to point at a private-network hostname and the API-key var drops out:

```bash
BRIVEN_OLLAMA_URL=http://<dgx-host>:11434
# BRIVEN_OLLAMA_API_KEY=  <-- unset
BRIVEN_OLLAMA_MODEL=qwen2.5-coder:32b-instruct-q5_K_M
```

On the DGX side:

```bash
ollama pull qwen2.5-coder:32b-instruct-q5_K_M
```

The DGX must be reachable from the api's docker network but not from the public internet. briven's pattern with the runtime + realtime services (`BRIVEN_RUNTIME_SHARED_SECRET` on a private docker network) is the same idea — defense by network topology rather than per-request auth.

---

## Differentiating models per feature

If the DGX has spare VRAM and you want best-in-class per task, briven supports per-feature model overrides via env vars (added alongside this guide):

```bash
BRIVEN_OLLAMA_MODEL_SCHEMA=qwen2.5-coder:14b-instruct-q5_K_M
BRIVEN_OLLAMA_MODEL_FUNCTION=qwen2.5-coder:32b-instruct-q5_K_M
BRIVEN_OLLAMA_MODEL_EXPLAIN=deepseek-r1-distill-qwen-32b-q4_K_M
BRIVEN_OLLAMA_MODEL_DOCS=qwen2.5:7b-instruct-q5_K_M
```

Each falls back to `BRIVEN_OLLAMA_MODEL` when unset, so an op who only wants one model just sets the single var.

A reasonable per-feature matrix:

| Feature | Model | Quant | ~VRAM | Why |
|---|---|---|---|---|
| schema | `qwen2.5-coder:14b-instruct` | Q5_K_M | ~10 GB | smaller is fine; structure is fully in the prompt |
| function | `qwen2.5-coder:32b-instruct` | Q5_K_M | ~24 GB | needs to read schema context accurately |
| explain | `deepseek-r1-distill-qwen-32b` | Q4_K_M | ~20 GB | bakes chain-of-thought into Qwen base — explanations get noticeably better |
| docs Q&A | `qwen2.5:7b-instruct` | Q5_K_M | ~5 GB | retrieval carries it; model just summarises |

Loading all four simultaneously is ~60 GB VRAM — fine on a DGX, tight on a single GPU. Ollama handles model swapping transparently if you'd rather keep one in VRAM at a time (cold-swap ~5–10 s, surfaced as a one-off slow first request after a period of inactivity).

---

## Hardware sizing reference

Approximate VRAM at Q5_K_M unless noted. KV cache for an 8 k-token context window adds ~2–4 GB to each:

| Model class | VRAM at Q4_K_M | VRAM at Q5_K_M | Typical tok/s on H100 |
|---|---|---|---|
| 7B (e.g. `qwen2.5:7b`) | ~4 GB | ~5 GB | 80–110 |
| 14B (e.g. `qwen2.5-coder:14b`) | ~8 GB | ~10 GB | 60–80 |
| 32B (e.g. `qwen2.5-coder:32b`) | ~18 GB | ~24 GB | 40–60 |
| 70B (e.g. `llama3.3:70b`) | ~40 GB | ~50 GB | 20–30 |
| DeepSeek-V3 MoE (671B / 37B active) | FP8 ~400 GB | — | 10–15 (multi-GPU) |

A 32B model at Q5_K_M is the practical ceiling if you want to keep one model resident on a single 80 GB GPU and serve dashboard requests synchronously.

---

## What I would NOT pick (and why)

- **`llama3.3:70b`** — generalist, weaker at typescript-specific patterns than Qwen-Coder, ~2× the VRAM for no quality win on briven's tasks.
- **`deepseek-v3` (671B MoE)** — strongest open model on paper but needs ~400 GB at FP8 across multiple GPUs and the latency penalty on a synchronous dashboard call hurts UX. Save for batch / async work; briven's endpoints are synchronous.
- **`codestral`** — solid for autocomplete but weaker at "follow this shape exactly" than Qwen, and the licence is non-permissive for commercial self-hosting.
- **Anything below 7B** — for the explain task especially, you'll feel the drop in nuance ("here's what this code does in three lines" vs Qwen 32B's "here's what it does, why the wrapper choice matters, and a sharp edge to watch").
- **Closed-API models (OpenAI, Anthropic, Gemini)** — work fine technically but break briven's "your data never leaves your infrastructure" promise. The privacy stance in the dashboard surface copy ("not sent to any third-party AI provider") would have to change.

---

## Operational notes

### Cold-start

Ollama keeps a model resident in VRAM after first use. The first request after `ollama pull` or after the model has been swapped out (memory pressure, manual unload) is slow — 5–15 s of cold-load. Subsequent requests are fast. If you want to warm the model at api boot, add a one-shot dummy request to the api's startup. Today briven does not do this; the first user to hit an AI surface pays the warm-up.

### Timeout

Each AI service caps requests at **60 s** by default (see `apps/api/src/services/ai-{schema,function,explain}-gen.ts`). The Ollama call uses `AbortSignal.timeout(60_000)`. If your model is slower than that for normal-sized prompts, bump the per-service timeout — but consider that 60 s is already on the edge of "synchronous request" UX. Beyond that, the dashboard should switch to a streaming/long-poll pattern (not yet implemented).

### Streaming

briven currently uses `stream: false` on the Ollama call and waits for the full response. This is simpler and matches the dashboard's synchronous fetch shape. For longer outputs (explain on a large file), streaming would feel better — that's a queued enhancement that lights up automatically once we switch the Ollama call to SSE.

### Quantisation choice

`Q5_K_M` is the sweet spot for most users — barely-detectable quality drop from FP16, ~3× smaller. `Q4_K_M` is the next step down — noticeable on edge cases but saves another ~30% VRAM. `Q6_K` and `Q8_0` are closer to FP16 but the VRAM penalty rarely pays off for code tasks. Stay on Q5_K_M unless you have a specific quality regression and headroom to go higher.

### Logs

Watch the api logs for:

- `ai_schema_gen_ok`, `ai_function_gen_ok`, `ai_explain_ok` — success path; carries promptLen, fnLen/explanationLen, model, elapsedMs.
- `ai_schema_gen_upstream_error`, `ai_function_gen_upstream_error`, `ai_explain_upstream_error` — Ollama returned non-2xx; bodyPreview is the first 240 chars of the response (often the meaningful error from Ollama).
- `AiNotConfiguredError` (thrown, not logged at info level) — `BRIVEN_OLLAMA_URL` is unset. Set it.

### Health probe

There's no dedicated "is the AI backend up?" probe today. The simplest check from the operator side:

```bash
# production proxy
curl -sS -H "Authorization: Bearer $BRIVEN_OLLAMA_API_KEY" \
  https://ai.flndrn.com/api/tags | jq -r '.models[].name'

# local DGX
curl -sS http://<dgx-host>:11434/api/tags | jq -r '.models[].name'
```

Should list the models the backend has. If it doesn't respond, Ollama is down (or the proxy is). The briven api gracefully returns `503 not_configured` for the duration of the outage; no other surface is affected.

---

## Roadmap

- **Streaming responses** — switch from `stream: false` to SSE for long explanations. Lower perceived latency, no UX-pattern change beyond the loading state.
- **Embedding-based docs retrieval** — the current `/api/search?q=` corpus is keyword-overlap. Adding an embedding index (qwen embeddings work well, no need for a separate model) would handle paraphrased questions better.
- **Per-project model override** — let a Pro/Team customer pick a different model. Probably overkill at year-one scale; revisit if anyone asks.
- **Quality benchmark suite** — a small harness that runs the same fixed prompts against each candidate model and diffs the outputs, so future model swaps are evidence-based instead of vibes-based.

---

*End of AI.md. Pair with `docs/runbooks/polar-metering-setup.md` for billing config; pair with `docs/MIGRATION.md` for the user-facing migration playbook.*
