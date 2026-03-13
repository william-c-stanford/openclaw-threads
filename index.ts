/**
 * index.ts
 *
 * OpenClaw Threads Extension — Slate Architecture
 *
 * Implements the thread/episode pattern described in:
 *   https://randomlabs.ai/blog/slate
 *
 * Registers three agent tools:
 *
 *   threads_dispatch(thread_id, action, inject_thread_ids?)
 *     Dispatch a bounded action to a named thread. Returns a structured Episode.
 *     The thread maintains persistent context across multiple dispatches.
 *     Use inject_thread_ids for thread weaving: pull prior episodes from other
 *     threads into this worker's context without message passing.
 *
 *   threads_parallel(dispatches)
 *     Dispatch multiple bounded actions concurrently, each to its own thread.
 *     Returns all Episodes once every worker completes.
 *
 *   threads_status(include_latest_summaries?)
 *     Inspect active threads and their episode counts for this session.
 *
 * ## Why threads, not subagents?
 *
 * Conventional subagents synchronize via message passing: one string in, one
 * string out. All the rich context a subagent builds — every file read, every
 * intermediate finding — is discarded at the boundary.
 *
 * Threads return Episodes. An Episode carries:
 *   - summary          — compressed text of findings
 *   - keyFindings      — structured JSON the orchestrator can inspect
 *   - composableSummary — compact string that can be injected into any
 *                         subsequent thread's context (thread weaving)
 *
 * The orchestrator has explicit control over what context flows where.
 * Nothing is silently discarded. Context routes as structured data, not strings.
 *
 * ## Architecture (from the blog's taxonomy)
 *
 *   planning:              implicit
 *   decomposition:         implicit (falls out of dispatch + episode composition)
 *   synchronization:       episodes  ← the key innovation
 *   intermediate feedback: per episode
 *   context isolation:     per thread
 *   context compaction:    episode compress
 *   parallel execution:    native (threads_parallel)
 *   expressivity:          high
 *   adaptability:          yes — orchestrator can update strategy after each episode
 *
 * ## Install
 *
 *   git clone https://github.com/william-c-stanford/openclaw-threads \
 *     ~/.config/openclaw/extensions/threads
 *
 * ## Enable in openclaw.json
 *
 *   {
 *     "plugins": {
 *       "entries": {
 *         "threads": { "enabled": true }
 *       }
 *     }
 *   }
 *
 * ## Optional: allowlist the tools
 *
 *   {
 *     "agents": {
 *       "list": [{
 *         "id": "main",
 *         "tools": { "allow": ["threads_dispatch", "threads_parallel", "threads_status"] }
 *       }]
 *     }
 *   }
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { ThreadsPluginConfig } from "./src/types.js";
import { createDispatchTool } from "./src/tools/dispatch.js";
import { createParallelTool } from "./src/tools/parallel.js";
import { createStatusTool } from "./src/tools/status.js";

const threadsPlugin = {
  id: "threads",
  name: "Threads",
  description:
    "Slate thread/episode architecture — thread weaving, episodic memory, long-horizon task execution without context rot",

  register(api: OpenClawPluginApi) {
    const cfg = ((api as unknown as Record<string, unknown>)["pluginConfig"] ??
      {}) as ThreadsPluginConfig;

    // Use factory pattern so each session gets its own tool instance with the
    // correct sessionKey (used to scope in-memory thread state per session)
    api.registerTool(
      (ctx) =>
        createDispatchTool(api, cfg, ctx.sessionKey ?? "default", ctx.workspaceDir),
      { name: "threads_dispatch" }
    );

    api.registerTool(
      (ctx) =>
        createParallelTool(api, cfg, ctx.sessionKey ?? "default", ctx.workspaceDir),
      { name: "threads_parallel" }
    );

    api.registerTool(
      (ctx) => createStatusTool(api, cfg, ctx.sessionKey ?? "default"),
      { name: "threads_status" }
    );
  },
};

export default threadsPlugin;
