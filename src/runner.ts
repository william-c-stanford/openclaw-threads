/**
 * runner.ts
 *
 * Execute a bounded action as a thread worker via OpenClaw's embedded agent runner.
 *
 * Each thread maintains a persistent session file on disk. Reusing the same
 * session file across multiple dispatches to the same thread gives the worker
 * natural context accumulation — it remembers what it did in prior episodes.
 *
 * Uses the same dynamic-import pattern as the bundled llm-task extension so
 * this works from both source checkouts and built installs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { parseEpisode, formatInjectedEpisodes } from "./episode.js";
import type { Episode, ThreadState, ThreadsPluginConfig } from "./types.js";

// ─────────────────────────────────────────────────────────
// Dynamic loader for runEmbeddedPiAgent
// (mirrors the llm-task extension pattern)
// ─────────────────────────────────────────────────────────

type RunEmbeddedFn = (params: Record<string, unknown>) => Promise<unknown>;

async function loadRunEmbeddedPiAgent(): Promise<RunEmbeddedFn> {
  // Source checkout (dev / tests)
  try {
    const mod = await import("openclaw/src/agents/pi-embedded-runner.js");
    // oxlint-disable-next-line typescript/no-explicit-any
    if (typeof (mod as any).runEmbeddedPiAgent === "function") {
      // oxlint-disable-next-line typescript/no-explicit-any
      return (mod as any).runEmbeddedPiAgent as RunEmbeddedFn;
    }
  } catch {
    // not a source checkout
  }

  // Bundled install
  const mod = (await import("openclaw/dist/extensionAPI.js")) as {
    runEmbeddedPiAgent?: unknown;
  };
  // oxlint-disable-next-line typescript/no-explicit-any
  const fn = (mod as any).runEmbeddedPiAgent;
  if (typeof fn !== "function") {
    throw new Error(
      "threads: runEmbeddedPiAgent not available — is openclaw installed?"
    );
  }
  return fn as RunEmbeddedFn;
}

function collectText(
  payloads: Array<{ text?: string; isError?: boolean }> | undefined
): string {
  return (payloads ?? [])
    .filter((p) => !p.isError && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
}

// ─────────────────────────────────────────────────────────
// Thread system prompt
// ─────────────────────────────────────────────────────────

const THREAD_SYSTEM_PROMPT = `You are a thread — a focused worker that executes ONE bounded action.

## Your job
Complete the given action thoroughly and precisely. Use all available tools.
Stop when the action is complete. Do not continue beyond the action's scope.

## Required output format
End your response with these exact markers:

EPISODE_SUMMARY_START
<One to three sentences summarizing what you did and the key results. Be specific — include file names, counts, decisions, or values discovered.>
EPISODE_SUMMARY_END

EPISODE_FINDINGS_START
{ "key1": "value1", "key2": "value2" }
EPISODE_FINDINGS_END

The JSON in EPISODE_FINDINGS must be valid JSON. Include 3–8 key findings that
another agent might need to reference later. If nothing structured was found, use {}.

Everything before the markers is your working context — only the blocks are returned
to the orchestrator. Make the summary self-contained and actionable.`;

// ─────────────────────────────────────────────────────────
// Dispatch a bounded action to a thread worker
// ─────────────────────────────────────────────────────────

export async function dispatchToThread(params: {
  thread: ThreadState;
  action: string;
  injectEpisodes: Episode[];
  api: OpenClawPluginApi;
  pluginCfg: ThreadsPluginConfig;
  workspaceDir: string;
  agentDir?: string;
}): Promise<Episode> {
  const { thread, action, injectEpisodes, api, pluginCfg, workspaceDir, agentDir } = params;

  const start = Date.now();
  const episodeIndex = thread.episodes.length + 1;

  // Ensure session dir exists
  await fs.mkdir(path.dirname(thread.sessionFile), { recursive: true });

  // Build the action prompt, including any injected episode context
  const injectedContext = formatInjectedEpisodes(injectEpisodes);
  const prompt = injectedContext
    ? `${injectedContext}\n\nACTION: ${action}`
    : `ACTION: ${action}`;

  // Resolve provider/model (plugin config → agent defaults → hardcoded fallback)
  const agentDefaultsModel = api.config?.agents?.defaults?.model;
  const primary =
    typeof agentDefaultsModel === "string"
      ? agentDefaultsModel
      : (agentDefaultsModel?.primary ?? undefined);
  const primaryProvider =
    typeof primary === "string" ? primary.split("/")[0] : undefined;
  const primaryModel =
    typeof primary === "string" ? primary.split("/").slice(1).join("/") : undefined;

  const provider = pluginCfg.defaultProvider?.trim() || primaryProvider;
  const model = pluginCfg.defaultModel?.trim() || primaryModel;

  if (!provider || !model) {
    throw new Error(
      "threads: could not resolve provider/model for thread worker. " +
        "Set agents.defaults.model in openclaw.json (e.g. \"anthropic/claude-sonnet-4-6\" or \"openai-codex/gpt-5.2\") " +
        "or configure threads.config.defaultProvider + threads.config.defaultModel."
    );
  }

  const maxSteps = pluginCfg.maxStepsPerEpisode ?? 30;

  const runEmbeddedPiAgent = await loadRunEmbeddedPiAgent();

  const result = await runEmbeddedPiAgent({
    sessionId: thread.sessionId,
    sessionFile: thread.sessionFile,
    workspaceDir,
    agentDir,
    config: api.config,
    prompt,
    provider,
    model,
    disableTools: false,
    // Extra system instructions injected alongside OpenClaw's default system prompt
    extraSystemPrompt: THREAD_SYSTEM_PROMPT,
    // Limit context growth per episode to prevent runaway tool loops
    maxToolCalls: maxSteps,
    timeoutMs: 5 * 60 * 1000, // 5 min per episode
    runId: `threads-${thread.threadId}-ep${episodeIndex}-${Date.now()}`,
  });

  // oxlint-disable-next-line typescript/no-explicit-any
  const rawOutput = collectText((result as any).payloads);
  // oxlint-disable-next-line typescript/no-explicit-any
  const tokensUsed = (result as any).usage?.totalTokens ?? 0;

  return parseEpisode({
    threadId: thread.threadId,
    episodeIndex,
    action,
    rawOutput: rawOutput || "(no output)",
    tokensUsed,
    durationMs: Date.now() - start,
  });
}
