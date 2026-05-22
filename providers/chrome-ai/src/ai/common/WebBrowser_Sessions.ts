/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export const WEB_BROWSER_SESSION_IDLE_MS = 30 * 60_000;

export interface WebBrowserSessionEntry {
  readonly modelKey: string;
  readonly session: { destroy(): void };
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

const sessions = new Map<string, WebBrowserSessionEntry>();

export function getWebBrowserModelKey(model: WebBrowserModelConfig | undefined): string {
  const providerConfig = model?.provider_config as { model_name?: unknown } | undefined;
  const configuredName = providerConfig?.model_name;
  if (typeof configuredName === "string" && configuredName.length > 0) return configuredName;
  return String(model?.model_id ?? "gemini-nano");
}

export function getWebBrowserSession(sessionId: string): WebBrowserSessionEntry | undefined {
  return sessions.get(sessionId);
}

function clearIdleTimer(entry: WebBrowserSessionEntry): void {
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
}

export function touchWebBrowserSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  entry.lastUsedAt = Date.now();
  clearIdleTimer(entry);
  const timer = setTimeout(() => {
    void disposeWebBrowserSession(sessionId).catch((error: unknown) => {
      console.error(`WebBrowser session idle dispose failed for ${sessionId}`, error);
    });
  }, WEB_BROWSER_SESSION_IDLE_MS);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
  entry.idleTimer = timer;
}

export function setWebBrowserSession(
  sessionId: string,
  entry: Pick<WebBrowserSessionEntry, "modelKey" | "session">
): void {
  const existing = sessions.get(sessionId);
  if (existing) clearIdleTimer(existing);
  sessions.set(sessionId, {
    modelKey: entry.modelKey,
    session: entry.session,
    lastUsedAt: Date.now(),
    idleTimer: undefined,
  });
  touchWebBrowserSession(sessionId);
}

export async function disposeWebBrowserSession(sessionId: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  sessions.delete(sessionId);
  clearIdleTimer(entry);
  try {
    entry.session.destroy();
  } catch {
    // Removing the stale entry is more important than surfacing destroy errors.
  }
}

export async function disposeWebBrowserSessionsForModel(modelKey: string): Promise<void> {
  const ids = [...sessions.entries()]
    .filter(([, entry]) => entry.modelKey === modelKey)
    .map(([sessionId]) => sessionId);
  await Promise.all(ids.map((sessionId) => disposeWebBrowserSession(sessionId)));
}

export function resetWebBrowserSessionsForTests(): void {
  for (const entry of sessions.values()) {
    clearIdleTimer(entry);
  }
  sessions.clear();
}
