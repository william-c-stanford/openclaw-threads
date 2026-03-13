/**
 * tools/dispatch.ts
 *
 * threads_dispatch — dispatch a bounded action to a named thread.
 *
 * This is the core primitive of the Slate architecture. The orchestrator
 * The orchestrator calls this to delegate work to a focused worker thread. The thread
 * executes step-by-step, accumulates context across dispatches, and returns a
 * structured Episode rather than a plain string.
 *
 * Thread weaving: pass inject_thread_ids to pull the latest Episode from those
 * threads into the worker's context window before it starts. The worker sees
 * their composableSummary as injected context — no extra orchestrator effort.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { ThreadsPluginConfig } from "../types.js";
import { getOrCreateThread, addEpisode, getLatestEpisode } from "../store.js";
import { dispatchToThread } from "../runner.js";

export function createDispatchTool(
  api: OpenClawPluginApi,
  cfg: ThreadsPluginConfig,
  sessionKey: string,
  workspaceDir?: string
) {
  return {
    name: "threads_dispatch",
    label: "Thread Dispatch",
    description: `Dispatch a bounded action to a named thread and receive a structured Episode.

Unlike subagents (which return a single string), threads return Episodes with:
- summary: compressed description of what was found/done
- keyFindings: structured JSON the orchestrator can inspect
- composableSummary: compact string to inject into other threads (thread weaving)

The thread maintains persistent context across multiple dispatches — dispatching
to the same thread_id continues from where it left off.

Use inject_thread_ids to weave prior thread episodes into this dispatch's context,
enabling cross-thread context sharing without message passing.`,
    parameters: Type.Object({
      thread_id: Type.String({
        description:
          'Named workstream for this dispatch. Use descriptive names like "explorer", "test-runner", "refactor-auth". Reusing an ID continues that workstream.',
      }),
      action: Type.String({
        description:
          "The ONE bounded action for this dispatch. Be specific: what exactly should be done, what files/directories are in scope, what is the expected output. Threads execute better with precise, scoped actions than with open-ended tasks.",
      }),
      inject_thread_ids: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Thread IDs whose latest Episodes should be injected into this dispatch's context (thread weaving). The worker sees their composableSummary as prior context. Use this to share discoveries across parallel or sequential workstreams.",
        })
      ),
    }),

    async execute(
      _toolCallId: string,
      params: Record<string, unknown>
    ): Promise<{ content: [{ type: "text"; text: string }]; details: unknown }> {
      const threadId = String(params["thread_id"] ?? "").trim();
      const action = String(params["action"] ?? "").trim();

      if (!threadId) throw new Error("thread_id is required");
      if (!action) throw new Error("action is required");

      const injectIds = Array.isArray(params["inject_thread_ids"])
        ? (params["inject_thread_ids"] as unknown[])
            .map((x) => String(x).trim())
            .filter(Boolean)
        : [];

      const agentSessionKey = sessionKey;

      const ttlMs = cfg.sessionTtlMs ?? 60 * 60 * 1000;
      const thread = getOrCreateThread(agentSessionKey, threadId, ttlMs);

      // Gather episodes to inject (thread weaving)
      const injectEpisodes = injectIds
        .map((id) => getLatestEpisode(agentSessionKey, id))
        .filter((ep): ep is NonNullable<typeof ep> => ep != null);

      const resolvedWorkspaceDir =
        workspaceDir ??
        (api.config?.agents?.defaults as Record<string, unknown>)?.["workspace"] as
          | string
          | undefined ?? process.cwd();

      const episode = await dispatchToThread({
        thread,
        action,
        injectEpisodes,
        api,
        pluginCfg: cfg,
        workspaceDir: resolvedWorkspaceDir,
      });

      addEpisode(thread, episode);

      const result = {
        ok: true,
        episode: {
          thread_id: episode.threadId,
          episode_index: episode.episodeIndex,
          action: episode.action,
          summary: episode.summary,
          key_findings: episode.keyFindings,
          composable_summary: episode.composableSummary,
          tokens_used: episode.tokensUsed,
          duration_ms: episode.durationMs,
        },
        hint: injectEpisodes.length > 0
          ? `Injected context from ${injectEpisodes.length} thread(s): ${injectIds.join(", ")}`
          : undefined,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
