/**
 * store.ts
 *
 * In-memory session-scoped store for thread state.
 *
 * Each agent session gets its own Map of threads. Threads within a session
 * share a tmp directory for their session files, enabling persistent context
 * across multiple dispatches to the same thread.
 *
 * Session stores are evicted after sessionTtlMs of inactivity to prevent
 * memory leaks in long-running OpenClaw processes.
 */

import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import type { Episode, ThreadState } from "./types.js";

const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 min

type SessionStore = {
  threads: Map<string, ThreadState>;
  sessionDir: string;
  lastActivityAt: number;
};

// Global store — keyed by agent sessionKey
const sessionStores = new Map<string, SessionStore>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanupTimer(ttlMs: number): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, store] of sessionStores) {
      if (now - store.lastActivityAt > ttlMs) {
        sessionStores.delete(key);
      }
    }
    if (sessionStores.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't prevent process exit
  if (cleanupTimer.unref) cleanupTimer.unref();
}

function resolveThreadsTmpDir(): string {
  return (
    process.env["OPENCLAW_THREADS_TMP"] ??
    path.join(os.tmpdir(), "openclaw-threads")
  );
}

function getOrCreateSessionStore(sessionKey: string, ttlMs: number): SessionStore {
  startCleanupTimer(ttlMs);
  let store = sessionStores.get(sessionKey);
  if (!store) {
    const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const sessionDir = path.join(
      resolveThreadsTmpDir(),
      `${safeKey}-${randomBytes(4).toString("hex")}`
    );
    store = {
      threads: new Map(),
      sessionDir,
      lastActivityAt: Date.now(),
    };
    sessionStores.set(sessionKey, store);
  }
  store.lastActivityAt = Date.now();
  return store;
}

export function getOrCreateThread(
  sessionKey: string,
  threadId: string,
  ttlMs = DEFAULT_SESSION_TTL_MS
): ThreadState {
  const store = getOrCreateSessionStore(sessionKey, ttlMs);
  let thread = store.threads.get(threadId);
  if (!thread) {
    const safeId = threadId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const sessionId = `thread-${safeId}-${randomBytes(4).toString("hex")}`;
    const sessionFile = path.join(store.sessionDir, safeId, "session.json");
    thread = {
      threadId,
      sessionFile,
      sessionId,
      episodes: [],
      lastActivityAt: Date.now(),
    };
    store.threads.set(threadId, thread);
  }
  thread.lastActivityAt = Date.now();
  return thread;
}

export function addEpisode(thread: ThreadState, episode: Episode): void {
  thread.episodes.push(episode);
  thread.lastActivityAt = Date.now();
}

export function getLatestEpisode(
  sessionKey: string,
  threadId: string
): Episode | undefined {
  const store = sessionStores.get(sessionKey);
  if (!store) return undefined;
  const thread = store.threads.get(threadId);
  if (!thread || thread.episodes.length === 0) return undefined;
  return thread.episodes[thread.episodes.length - 1];
}

export function getAllThreads(sessionKey: string): ThreadState[] {
  const store = sessionStores.get(sessionKey);
  if (!store) return [];
  return [...store.threads.values()];
}

export function getSessionStats(sessionKey: string): {
  threadCount: number;
  totalEpisodes: number;
  threads: Array<{ id: string; episodeCount: number; lastAction: string }>;
} {
  const store = sessionStores.get(sessionKey);
  if (!store) {
    return { threadCount: 0, totalEpisodes: 0, threads: [] };
  }
  const threads = [...store.threads.values()].map((t) => ({
    id: t.threadId,
    episodeCount: t.episodes.length,
    lastAction:
      t.episodes.length > 0
        ? (t.episodes[t.episodes.length - 1]?.action ?? "")
        : "(no dispatches yet)",
  }));
  return {
    threadCount: threads.length,
    totalEpisodes: threads.reduce((n, t) => n + t.episodeCount, 0),
    threads,
  };
}
