/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { AIAvailability } from "./WebBrowser_ChromeAI";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

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

export async function ensureAvailable(
  name: string,
  factory: { availability(): Promise<AIAvailability> }
): Promise<void> {
  const status = await factory.availability();
  if (status === "unavailable") {
    throw new PermanentJobError(
      `Chrome Built-in AI "${name}" is not available (status: "no"). ` +
        `Ensure you are using a compatible Chrome version with the flag enabled.`
    );
  }
}

/**
 * Chrome streaming APIs return progressive full-text snapshots. This helper
 * converts them to append-mode text-delta events by diffing successive snapshots.
 */
export async function* snapshotStreamToTextDeltas<Output>(
  stream: ReadableStream<string>,
  port: string,
  buildFallbackOutput: (text: string) => Output
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
        previousSnapshot = value;
        yield { type: "snapshot", data: buildFallbackOutput(value) };
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
