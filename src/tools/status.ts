/**
 * tools/status.ts
 *
 * threads_status — inspect current thread and episode state for this session.
 *
 * Useful for the orchestrator to understand what workstreams have been created,
 * how many episodes each has produced, and what the last action was.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { ThreadsPluginConfig } from "../types.js";
import { getSessionStats, getLatestEpisode } from "../store.js";

export function createStatusTool(
  api: OpenClawPluginApi,
  cfg: ThreadsPluginConfig,
  sessionKey: string
) {
  return {
    name: "threads_status",
    label: "Thread Status",
    description:
      "Show all active threads and their episode counts for this session. Use to understand what workstreams exist and what they last did before dispatching follow-up actions.",
    parameters: Type.Object({
      include_latest_summaries: Type.Optional(
        Type.Boolean({
          description:
            "If true, include the latest episode summary for each thread. Useful for reviewing what each workstream found before deciding next steps.",
        })
      ),
    }),

    async execute(
      _toolCallId: string,
      params: Record<string, unknown>
    ): Promise<{ content: [{ type: "text"; text: string }]; details: unknown }> {
      const agentSessionKey = sessionKey;
      const includeSummaries = params["include_latest_summaries"] === true;

      const stats = getSessionStats(agentSessionKey);

      const threads = stats.threads.map((t) => {
        const base: Record<string, unknown> = {
          id: t.id,
          episode_count: t.episodeCount,
          last_action: t.lastAction,
        };
        if (includeSummaries && t.episodeCount > 0) {
          const ep = getLatestEpisode(agentSessionKey, t.id);
          if (ep) {
            base["latest_summary"] = ep.summary;
            base["latest_key_findings"] = ep.keyFindings;
          }
        }
        return base;
      });

      const result = {
        thread_count: stats.threadCount,
        total_episodes: stats.totalEpisodes,
        threads,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
