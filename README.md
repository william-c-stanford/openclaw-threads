# openclaw-threads

An [OpenClaw](https://openclaw.ai) extension implementing the **Slate thread/episode architecture** for long-horizon agentic tasks.

Based on: [Slate: moving beyond ReAct and RLM](https://randomlabs.ai/blog/slate) — Random Labs, 2026-03-09

---

## The problem

Modern LLM agents degrade on long tasks for three compounding reasons:

1. **Context rot** — attention quality degrades non-uniformly as the context window fills (the "Dumb Zone")
2. **Strategy/tactics tension** — models need to plan at a high level *and* execute precisely at a low level simultaneously
3. **Synchronization loss** — subagents return one string; all the rich context they built is discarded at the boundary

## The solution: Threads + Episodes

Instead of subagents that communicate via message passing, this extension implements **threads**: bounded worker agents that return structured **Episodes** rather than strings.

An Episode carries:
- `summary` — compressed description of findings
- `keyFindings` — structured JSON the orchestrator can inspect and route
- `composableSummary` — compact string that can be injected into any subsequent thread's context (**thread weaving**)

The orchestrator (Claude) has explicit control over what context flows where. Nothing is silently discarded at subagent boundaries.

```
Subagents:  orchestrator → string prompt → subagent → string response → orchestrator
            Everything that doesn't fit in the string is LOST.

Threads:    orchestrator → dispatch(action) → thread → Episode → orchestrator
            orchestrator → dispatch(action, inject=[ep1]) → thread2
            Episode.composableSummary crosses the boundary intact.
```

## Architecture (from the blog's taxonomy)

| Property | Subagents | Threads |
|---|---|---|
| planning | plan mode | implicit |
| decomposition | subagent delegation | implicit |
| synchronization | **message passing** | **episodes** ← |
| intermediate feedback | message passing | per episode |
| context isolation | per subagent | per thread |
| context compaction | lossy compaction | episode compress |
| parallel execution | native | native |
| expressivity | medium | high |
| adaptability | limited by message passing | yes |

## Install

```bash
# Clone directly into openclaw's global extensions directory
git clone https://github.com/william-c-stanford/openclaw-threads \
  ~/.config/openclaw/extensions/threads
```

## Enable

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "threads": { "enabled": true }
    }
  }
}
```

Optionally allowlist the tools:

```json
{
  "agents": {
    "list": [{
      "id": "main",
      "tools": {
        "allow": ["threads_dispatch", "threads_parallel", "threads_status"]
      }
    }]
  }
}
```

## Tools

### `threads_dispatch`

Dispatch a bounded action to a named thread. Returns a structured Episode.

```
threads_dispatch(
  thread_id: string,          // "explorer", "test-runner", etc.
  action: string,             // ONE specific, scoped action
  inject_thread_ids?: string[] // thread weaving: inject prior episodes as context
)
→ Episode { summary, key_findings, composable_summary, tokens_used, duration_ms }
```

The thread maintains persistent context across multiple dispatches — dispatching to the same `thread_id` continues from where it left off.

### `threads_parallel`

Dispatch multiple bounded actions concurrently.

```
threads_parallel(
  dispatches: Array<{ thread_id, action, inject_thread_ids? }>
)
→ { episodes: Episode[], total_tokens, total_duration_ms }
```

Use this for independent workstreams. Use `inject_thread_ids` for sequential + weaving patterns.

### `threads_status`

Inspect active threads and their episode counts.

```
threads_status(include_latest_summaries?: boolean)
→ { thread_count, total_episodes, threads: [{id, episode_count, last_action}] }
```

## Configuration

```json
{
  "plugins": {
    "entries": {
      "threads": {
        "enabled": true,
        "config": {
          "maxStepsPerEpisode": 30,
          "defaultProvider": "anthropic",
          "defaultModel": "claude-sonnet-4-6",
          "sessionTtlMs": 3600000
        }
      }
    }
  }
}
```

| Key | Default | Description |
|---|---|---|
| `maxStepsPerEpisode` | `30` | Max tool calls a thread worker may make per dispatch |
| `defaultProvider` | agent default | Provider for thread workers |
| `defaultModel` | agent default | Model for thread workers |
| `sessionTtlMs` | `3600000` (1h) | How long to keep thread state in memory |

## Example usage

```
# Orchestrator prompt to Claude:

Explore the codebase and write a migration plan using threads.

1. Use threads_parallel to dispatch these simultaneously:
   - thread "auth": "List all auth-related files and understand the current auth flow"
   - thread "db": "List all database models and their relationships"
   - thread "routes": "List all API routes and their handlers"

2. Use threads_dispatch to "planner" thread with inject_thread_ids=["auth","db","routes"]:
   "Based on the injected context from auth, db, and routes threads, write MIGRATION_PLAN.md"

The planner thread sees all three episodes' composable_summaries as context —
no string serialization, no information loss.
```

## References

- [Slate: moving beyond ReAct and RLM](https://randomlabs.ai/blog/slate) — Random Labs (2026)
- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) — Yao et al. (2022)
- [Context Rot: How Increasing Input Tokens Impacts LLM Performance](https://chroma.research) — Hong, Troynikov & Huber, Chroma (2025)
- [AlphaZero knowledge acquisition probing](https://www.pnas.org/doi/10.1073/pnas.2206625119) — McGrath et al., PNAS (2022)

## License

MIT
