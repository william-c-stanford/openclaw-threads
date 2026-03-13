/**
 * tools/parallel.ts
 *
 * threads_parallel — dispatch multiple bounded actions in parallel.
 *
 * From the blog: "Real software tasks decompose naturally into parallel thread
 * workstreams. The orchestrator can dispatch several threads simultaneously and
 * synthesize their episodes before continuing."
 *
 * This tool runs all dispatches concurrently. Each action goes to its named
 * thread and produces an Episode. All episodes are returned together once
 * every worker completes.
 *
 * Use this when actions are independent (no data dependency between them).
 * Use threads_dispatch sequentially when later actions depend on earlier results,
 * or use inject_thread_ids to pass earlier results into later dispatches.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { ThreadsPluginConfig } from "../types.js";
import { getOrCreateThread, addEpisode, getLatestEpisode } from "../store.js";
import { dispatchToThread } from "../runner.js";

export function createParallelTool(
  api: OpenClawPluginApi,
  cfg: ThreadsPluginConfig,
  sessionKey: string,
  workspaceDir?: string
) {
  return {
    name: "threads_parallel",
    label: "Thread Parallel Dispatch",
    description: `Dispatch multiple bounded actions in parallel, each to its own thread.

All workers run concurrently. Returns all Episodes once every worker is done.

Use this for independent workstreams: exploring different directories, running
different analysis passes, researching separate concerns simultaneously.

Do NOT use this when later actions depend on the results of earlier ones —
use threads_dispatch with inject_thread_ids for sequential + weaving patterns.`,
    parameters: Type.Object({
      dispatches: Type.Array(
        Type.Object({
          thread_id: Type.String({
            description: "Named workstream for this dispatch",
          }),
          action: Type.String({
            description: "Bounded action to execute in this thread",
          }),
          inject_thread_ids: Type.Optional(
            Type.Array(Type.String(), {
              description: "Thread IDs to inject into this dispatch's context",
            })
          ),
        }),
        {
          description: "List of concurrent dispatches. Each runs in its own thread.",
          minItems: 2,
        }
      ),
    }),

    async execute(
      _toolCallId: string,
      params: Record<string, unknown>
    ): Promise<{ content: [{ type: "text"; text: string }]; details: unknown }> {
      const dispatches = Array.isArray(params["dispatches"])
        ? (params["dispatches"] as Record<string, unknown>[])
        : [];

      if (dispatches.length < 1) throw new Error("dispatches must be non-empty");

      const agentSessionKey = sessionKey;
      const ttlMs = cfg.sessionTtlMs ?? 60 * 60 * 1000;
      const resolvedWorkspaceDir =
        workspaceDir ??
        (api.config?.agents?.defaults as Record<string, unknown>)?.["workspace"] as
          | string
          | undefined ?? process.cwd();

      const results = await Promise.all(
        dispatches.map(async (d) => {
          const threadId = String(d["thread_id"] ?? "").trim();
          const action = String(d["action"] ?? "").trim();
          if (!threadId || !action) return null;

          const injectIds = Array.isArray(d["inject_thread_ids"])
            ? (d["inject_thread_ids"] as unknown[])
                .map((x) => String(x).trim())
                .filter(Boolean)
            : [];

          const thread = getOrCreateThread(agentSessionKey, threadId, ttlMs);
          const injectEpisodes = injectIds
            .map((id) => getLatestEpisode(agentSessionKey, id))
            .filter((ep): ep is NonNullable<typeof ep> => ep != null);

          const episode = await dispatchToThread({
            thread,
            action,
            injectEpisodes,
            api,
            pluginCfg: cfg,
            workspaceDir: resolvedWorkspaceDir,
          });

          addEpisode(thread, episode);
          return episode;
        })
      );

      const episodes = results
        .filter((ep): ep is NonNullable<typeof ep> => ep != null)
        .map((ep) => ({
          thread_id: ep.threadId,
          episode_index: ep.episodeIndex,
          action: ep.action,
          summary: ep.summary,
          key_findings: ep.keyFindings,
          composable_summary: ep.composableSummary,
          tokens_used: ep.tokensUsed,
          duration_ms: ep.durationMs,
        }));

      const result = {
        ok: true,
        episodes,
        count: episodes.length,
        total_tokens: episodes.reduce((n, ep) => n + ep.tokens_used, 0),
        total_duration_ms: Math.max(...episodes.map((ep) => ep.duration_ms)),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
