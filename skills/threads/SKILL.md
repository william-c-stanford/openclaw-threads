---
name: threads
description: "Thread/episode architecture for long-horizon tasks. Use when: (1) tasks require exploring multiple parts of a codebase simultaneously, (2) work naturally decomposes into independent parallel workstreams, (3) you need to pass findings from one agent step into another without losing context, (4) a task has more than ~5 sequential tool calls. NOT for: simple one-shot questions, quick file reads, or single-tool operations."
metadata:
  { "openclaw": { "emoji": "🧵" } }
---

# Threads (Slate Architecture)

Use the thread tools for long-horizon tasks that decompose into bounded workstreams.
Threads return structured **Episodes** — not strings — so context flows between steps without loss.

## When to use threads

Use threads when a task has **multiple distinct phases** or can be **parallelized**:

- "Explore the codebase, then write a refactor plan" → 2 threads (explorer → planner)
- "Audit auth, DB, and API layers simultaneously" → 3 parallel threads
- "Research X, then use those findings to implement Y" → sequential with inject

Do NOT use threads for:
- Simple single-step tasks ("read this file", "run this command") — use tools directly
- Tasks where you already have all the context you need
- Chains of fewer than ~3 sequential steps

## The three tools

### `threads_dispatch` — one bounded action to one thread

```
threads_dispatch(
  thread_id: "explorer",
  action: "List all TypeScript files in src/, read each one, identify the main export and its purpose",
  inject_thread_ids: []   // optional: inject prior episodes as context
)
→ { episode: { summary, key_findings, composable_summary, tokens_used } }
```

**thread_id** naming: use descriptive workstream names — `"explorer"`, `"test-writer"`, `"refactor-auth"`, `"db-schema"`. Reusing the same id *continues* that workstream (the worker picks up where it left off).

**action** quality matters: be specific and scoped. Good: `"Read src/auth/*.ts and identify all places where JWT tokens are created or validated"`. Bad: `"Look at auth stuff"`.

### `threads_parallel` — multiple actions at once

```
threads_parallel(dispatches: [
  { thread_id: "auth",   action: "Map all auth flows and token handling in src/auth/" },
  { thread_id: "db",     action: "List all models and foreign key relationships in src/models/" },
  { thread_id: "routes", action: "List all API routes with their middleware in src/routes/" }
])
→ { episodes: [...], total_tokens, total_duration_ms }
```

Use when the actions are **independent** — no data dependency between them. They run concurrently.

### `threads_status` — inspect what's been done

```
threads_status(include_latest_summaries: true)
→ { threads: [{ id, episode_count, last_action, latest_summary }] }
```

Use before dispatching follow-up work to review what each workstream found.

---

## Thread weaving — passing context between threads

The key feature. Instead of summarizing one thread's results in your prompt to the next, use `inject_thread_ids`. The worker receives the prior episode's `composable_summary` directly in its context.

```
# Phase 1: explore in parallel
threads_parallel([
  { thread_id: "auth",   action: "Map auth system in src/auth/" },
  { thread_id: "models", action: "Map data models in src/models/" }
])

# Phase 2: planner gets BOTH episodes injected — no information loss
threads_dispatch(
  thread_id: "planner",
  action: "Write MIGRATION_PLAN.md based on the auth and models context",
  inject_thread_ids: ["auth", "models"]
)
```

The planner worker sees `auth` and `models` findings as structured context, not a string summary you had to write. Nothing is discarded at the boundary.

---

## Common patterns

### Explore → Implement

```
1. threads_dispatch("explorer", "Read all files in src/feature/, understand the structure")
2. threads_dispatch("implementer", "Add X to the feature based on the explored context",
                    inject_thread_ids=["explorer"])
```

### Parallel research → Synthesis

```
1. threads_parallel([
     { thread_id: "t1", action: "Research concern A" },
     { thread_id: "t2", action: "Research concern B" },
     { thread_id: "t3", action: "Research concern C" }
   ])
2. threads_dispatch("synthesizer", "Write a unified report",
                    inject_thread_ids=["t1", "t2", "t3"])
```

### Multi-pass refinement

```
1. threads_dispatch("drafter",  "Write first draft of PLAN.md")
2. threads_dispatch("reviewer", "Review and critique PLAN.md",   inject_thread_ids=["drafter"])
3. threads_dispatch("drafter",  "Revise PLAN.md based on review", inject_thread_ids=["reviewer"])
```
Note: dispatching to `"drafter"` again continues that thread — the worker has prior context.

### Codebase audit (parallel army)

```
threads_parallel([
  { thread_id: "security", action: "Audit src/ for security issues: SQL injection, XSS, unvalidated inputs" },
  { thread_id: "perf",     action: "Audit src/ for N+1 queries, missing indexes, slow loops" },
  { thread_id: "types",    action: "Audit src/ for missing TypeScript types and any-casts" }
])
```

---

## Reading episodes

After each dispatch, the returned episode has:

| Field | Use |
|---|---|
| `summary` | Human-readable compressed description of findings |
| `key_findings` | Structured JSON — inspect for specific values, counts, file lists |
| `composable_summary` | Compact string — reference this when you decide which threads to inject |
| `tokens_used` | Budget awareness |

Example — using `key_findings` to route next dispatch:

```
episode.key_findings = { "files_with_auth": ["src/auth/jwt.ts", "src/middleware/auth.ts"] }
→ dispatch a "token-auditor" thread scoped to just those 2 files
```

---

## Rules

1. **One bounded action per dispatch.** Not "do everything" — one specific, scoped unit of work.
2. **Name threads by workstream**, not by action. `"auth-explorer"` not `"read-auth-files-step-2"`.
3. **Inject don't summarize.** When a later thread needs prior context, use `inject_thread_ids`. Don't manually copy findings into the action prompt.
4. **Parallel when independent.** If two actions don't need each other's results, run them with `threads_parallel`.
5. **Check `threads_status`** before long chains to confirm prior episodes succeeded.
6. **Reuse thread IDs** for continuous workstreams. Dispatching to the same `thread_id` twice continues the work in that context.
