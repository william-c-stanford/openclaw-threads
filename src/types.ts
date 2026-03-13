/**
 * types.ts
 *
 * Core types for the threads extension.
 *
 * The central distinction between Slate's thread pattern and conventional subagents:
 *
 *   SubagentResult  →  one string crosses the context boundary
 *   Episode         →  structured, composable context crosses the boundary
 *
 * Episodes can be injected into subsequent thread dispatches (thread weaving),
 * giving the orchestrator explicit control over what context flows where.
 *
 * Reference: https://randomlabs.ai/blog/slate
 */

// ─────────────────────────────────────────────────────────
// Episode — the key primitive
// ─────────────────────────────────────────────────────────

/**
 * An Episode is the compressed result of one bounded action executed by a thread.
 *
 * Three properties distinguish Episodes from subagent string responses:
 *
 * 1. summary         — human-readable compressed description of findings
 * 2. keyFindings     — structured key→value pairs the orchestrator can inspect
 * 3. composableSummary — a compact string the orchestrator can inject verbatim
 *    into any subsequent thread's context, enabling thread weaving
 *
 * The full internal trace (every tool call, every intermediate result) stays
 * inside the thread's session file on disk. The orchestrator only receives
 * the compressed Episode — keeping the main context window clean.
 */
export type Episode = {
  /** Thread that produced this episode */
  threadId: string;
  /** Sequential index within this thread (1-based) */
  episodeIndex: number;
  /** The bounded action that was dispatched */
  action: string;
  /** Compressed summary of what happened and what was found */
  summary: string;
  /** Structured findings the orchestrator can inspect and route */
  keyFindings: Record<string, unknown>;
  /**
   * Compact string representation for thread weaving.
   * Pass this verbatim in inject_thread_ids to give another thread this context.
   * Smaller than summary — just the essential facts.
   */
  composableSummary: string;
  /** Token count for the worker run */
  tokensUsed: number;
  /** Wall time in ms */
  durationMs: number;
};

// ─────────────────────────────────────────────────────────
// Thread state — maintained in memory per session
// ─────────────────────────────────────────────────────────

/**
 * In-memory state for one named thread within an agent session.
 *
 * A thread is a persistent workstream: dispatching multiple actions to the
 * same thread ID accumulates context naturally (each worker session continues
 * from where the last one left off).
 *
 * Thread state also tracks all produced Episodes so the orchestrator can
 * reference them by name for injection into other threads.
 */
export type ThreadState = {
  threadId: string;
  /** Absolute path to the persistent session file for this thread's worker */
  sessionFile: string;
  /** Stable session ID — reused across dispatches to maintain context continuity */
  sessionId: string;
  /** All episodes produced by dispatches to this thread, in order */
  episodes: Episode[];
  /** Last activity timestamp (ms) */
  lastActivityAt: number;
};

// ─────────────────────────────────────────────────────────
// Plugin config
// ─────────────────────────────────────────────────────────

export type ThreadsPluginConfig = {
  maxStepsPerEpisode?: number;
  defaultProvider?: string;
  defaultModel?: string;
  sessionTtlMs?: number;
};
