/**
 * episode.ts
 *
 * Parse an Episode from the raw text output of a thread worker agent.
 *
 * Thread workers are prompted to end their response with structured output:
 *
 *   EPISODE_SUMMARY_START
 *   <one-paragraph summary>
 *   EPISODE_SUMMARY_END
 *
 *   EPISODE_FINDINGS_START
 *   { "key": "value", ... }
 *   EPISODE_FINDINGS_END
 *
 * Everything outside those markers is the worker's internal reasoning.
 * Only the structured blocks cross the episode boundary to the orchestrator.
 *
 * If the markers are absent (the worker didn't follow instructions), we fall
 * back to using the full response as the summary with empty keyFindings.
 */

import type { Episode } from "./types.js";

const SUMMARY_RE =
  /EPISODE_SUMMARY_START\s*([\s\S]*?)\s*EPISODE_SUMMARY_END/;

const FINDINGS_RE =
  /EPISODE_FINDINGS_START\s*([\s\S]*?)\s*EPISODE_FINDINGS_END/;

export function parseEpisode(params: {
  threadId: string;
  episodeIndex: number;
  action: string;
  rawOutput: string;
  tokensUsed: number;
  durationMs: number;
}): Episode {
  const { threadId, episodeIndex, action, rawOutput, tokensUsed, durationMs } = params;

  const summaryMatch = rawOutput.match(SUMMARY_RE);
  const findingsMatch = rawOutput.match(FINDINGS_RE);

  const summary = summaryMatch
    ? (summaryMatch[1] ?? "").trim()
    : rawOutput.trim().slice(0, 2000);

  let keyFindings: Record<string, unknown> = {};
  if (findingsMatch) {
    try {
      keyFindings = JSON.parse((findingsMatch[1] ?? "").trim()) as Record<string, unknown>;
    } catch {
      // Leave empty if JSON parse fails
    }
  }

  // composableSummary: a compact string for injection into other threads.
  // If keyFindings has data, we format them inline. Otherwise just the summary.
  const findingsStr =
    Object.keys(keyFindings).length > 0
      ? `\nKey findings: ${JSON.stringify(keyFindings)}`
      : "";
  const composableSummary = `[Thread "${threadId}" episode ${episodeIndex}] Action: ${action}\n${summary}${findingsStr}`;

  return {
    threadId,
    episodeIndex,
    action,
    summary,
    keyFindings,
    composableSummary,
    tokensUsed,
    durationMs,
  };
}

/**
 * Format injected episodes into a system-prompt block for a thread worker.
 *
 * This is the mechanism of thread weaving: T1's Episode becomes part of T2's
 * working context — without T2 having been involved in T1's execution.
 */
export function formatInjectedEpisodes(episodes: Episode[]): string {
  if (episodes.length === 0) return "";

  const lines: string[] = [
    "─── CONTEXT FROM OTHER THREADS ───",
    "The following episodes from peer threads are provided as context.",
    "Use them to inform your work without redoing their research.",
    "",
  ];

  for (const ep of episodes) {
    lines.push(ep.composableSummary);
    lines.push("");
  }

  lines.push("─── END CONTEXT ───");
  return lines.join("\n");
}
