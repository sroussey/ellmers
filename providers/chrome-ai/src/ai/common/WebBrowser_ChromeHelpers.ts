/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

// Chrome built-in AI globals (`LanguageModel`, `Summarizer`, etc.) and their
// option types are declared by `@types/dom-chromium-ai`, which is loaded
// transitively as a devDependency and surfaces as ambient global types.

export interface ProviderConfig {
  readonly pipeline?: string;
  readonly summary_type?: "tl;dr" | "key-points" | "teaser" | "headline";
  readonly summary_length?: "short" | "medium" | "long";
  readonly summary_format?: "plain-text" | "markdown";
  readonly rewriter_tone?: "as-is" | "more-formal" | "more-casual";
  readonly rewriter_length?: "as-is" | "shorter" | "longer";
}

export function getConfig(model: WebBrowserModelConfig | undefined): ProviderConfig {
  return (model?.provider_config ?? {}) as ProviderConfig;
}

export function getApi<T>(name: string, global: T | undefined): T {
  if (!global) {
    throw new PermanentJobError(
      `Chrome Built-in AI "${name}" API is not available in this browser.`
    );
  }
  return global;
}

export function getChromeGlobal<T = unknown>(name: string): T | undefined {
  return (globalThis as unknown as Record<string, T | undefined>)[name];
}

export async function ensureAvailable(
  name: string,
  factory: { availability(options?: never): Promise<Availability> },
  options?: unknown
): Promise<Availability> {
  const status = await factory.availability(options as never);
  if (status === "unavailable") {
    throw new PermanentJobError(
      `Chrome Built-in AI "${name}" is not available. ` +
        `Ensure you are using a compatible Chrome version with the flag enabled.`
    );
  }
  return status;
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`
  );
  return `{${entries.join(",")}}`;
}

/**
 * Throttle (ms) between `phase` progress events emitted from a
 * `downloadprogress` listener. Chrome can fire this listener at very high
 * frequency; we cap upstream traffic without dropping the first/last frames.
 */
const PROGRESS_THROTTLE_MS = 100;

/**
 * Returns a `monitor` callback for any Chrome built-in AI `create()` call
 * that forwards `downloadprogress` events as `phase` stream events.
 *
 * The `loaded` field on the event is a fraction in `[0, 1]`. We map it to a
 * 0–100 percentage and emit `{ type: "phase", message, progress }`. The
 * first event and the final 100% event are always emitted; intermediate
 * events are throttled to {@link PROGRESS_THROTTLE_MS}.
 *
 * @see https://developer.chrome.com/docs/ai/prompt-api#download-progress
 */
export function createDownloadMonitor<Output>(
  emit: (event: StreamEvent<Output>) => void,
  message: string = "Downloading model"
): CreateMonitorCallback {
  return (m) => {
    let lastEmit = 0;
    let pending: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const send = (progress: number): void => {
      emit({ type: "phase", message, progress } as StreamEvent<Output>);
      lastEmit = Date.now();
      pending = null;
    };

    m.addEventListener("downloadprogress", (e) => {
      const fraction = typeof e.loaded === "number" ? e.loaded : 0;
      const progress = Math.max(0, Math.min(100, Math.round(fraction * 100)));
      const now = Date.now();
      const isFirst = lastEmit === 0;
      const isFinal = progress >= 100;

      if (isFirst || isFinal) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        send(progress);
        return;
      }

      if (now - lastEmit < PROGRESS_THROTTLE_MS) {
        pending = progress;
        if (!timer) {
          const wait = Math.max(1, PROGRESS_THROTTLE_MS - (now - lastEmit));
          timer = setTimeout(() => {
            timer = null;
            if (pending !== null) send(pending);
          }, wait);
        }
        return;
      }

      send(progress);
    });
  };
}

/**
 * Chrome streaming APIs return progressive full-text snapshots. This helper
 * converts them to append-mode text-delta events by diffing successive snapshots.
 */
export async function* snapshotStreamToTextDeltas<Output>(
  stream: ReadableStream<string>,
  port: string,
  _buildFallbackOutput: (text: string) => Output
): AsyncIterable<StreamEvent<Output>> {
  const reader = stream.getReader();
  let previousSnapshot = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.startsWith(previousSnapshot)) {
        const delta = value.slice(previousSnapshot.length);
        previousSnapshot = value;
        if (delta) {
          yield { type: "text-delta", port, textDelta: delta };
        }
      } else {
        previousSnapshot += value;
        yield { type: "text-delta", port, textDelta: value };
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "finish", data: {} as Output };
}

/**
 * Chrome streaming APIs return progressive full-text snapshots. Yields replace-mode snapshot events.
 */
export async function* snapshotStreamToSnapshots<Output>(
  stream: ReadableStream<string>,
  buildOutput: (text: string) => Output
): AsyncIterable<StreamEvent<Output>> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield { type: "snapshot", data: buildOutput(value) };
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "finish", data: {} as Output };
}
