/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import {
  isWebBrowserModelCached,
  resolveWebBrowserApi,
  type WebBrowserApiBinding,
} from "./WebBrowser_ApiBinding";
import type { WebBrowserModelConfig } from "./WebBrowser_ModelSchema";

export { isWebBrowserModelCached, resolveWebBrowserApi } from "./WebBrowser_ApiBinding";

export interface ProviderConfig {
  readonly pipeline?: string;
  readonly summary_type?: SummarizerType;
  readonly summary_length?: SummarizerLength;
  readonly summary_format?: SummarizerFormat;
  readonly rewriter_tone?: RewriterTone;
  readonly rewriter_length?: RewriterLength;
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

export function assertAvailability(name: string, status: Availability): void {
  if (status === "unavailable") {
    throw new PermanentJobError(
      `Chrome Built-in AI "${name}" is not available (status: "no"). ` +
        `Ensure you are using a compatible Chrome version with the flag enabled.`
    );
  }
}

type PhaseEmit = (event: { type: "phase"; message: string; progress: number | undefined }) => void;

export async function queryWebBrowserAvailability(
  binding: WebBrowserApiBinding
): Promise<Availability> {
  try {
    switch (binding.apiName) {
      case "Summarizer":
        return await binding.factory.availability(binding.availabilityOptions);
      case "Rewriter":
        return await binding.factory.availability(binding.availabilityOptions);
      case "Translator":
        return await binding.factory.availability(binding.availabilityOptions);
      case "LanguageDetector":
        return await binding.factory.availability(binding.availabilityOptions);
      case "LanguageModel":
        return await binding.factory.availability(binding.availabilityOptions);
    }
  } catch {
    return "unavailable";
  }
}

const downloadMonitor =
  (apiName: string, emit: PhaseEmit): CreateMonitorCallback =>
  (monitor) => {
    monitor.addEventListener("downloadprogress", (event: ProgressEvent) => {
      const pct = Math.round(event.loaded * 100);
      if (event.loaded >= 1) {
        emit({
          type: "phase",
          message: "Extracting and loading model...",
          progress: undefined,
        });
      } else {
        emit({
          type: "phase",
          message: `Downloading ${apiName} model...`,
          progress: pct,
        });
      }
    });
  };

async function createForDownload(
  binding: WebBrowserApiBinding,
  signal: AbortSignal | undefined,
  emit: PhaseEmit
): Promise<DestroyableModel> {
  const monitor = downloadMonitor(binding.apiName, emit);
  switch (binding.apiName) {
    case "Summarizer":
      return binding.factory.create({ ...binding.createOptions, signal, monitor });
    case "Rewriter":
      return binding.factory.create({ ...binding.createOptions, signal, monitor });
    case "Translator":
      return binding.factory.create({ ...binding.createOptions, signal, monitor });
    case "LanguageDetector":
      return binding.factory.create({ ...binding.createOptions, signal, monitor });
    case "LanguageModel":
      return binding.factory.create({ ...binding.createOptions, signal, monitor });
  }
}

/**
 * Ensures the Chrome Built-in AI model for `binding` is downloaded and loaded.
 * Emits `phase` events with 0–100 progress from the browser `downloadprogress` monitor.
 */
export async function downloadWebBrowserModel(
  binding: WebBrowserApiBinding,
  signal: AbortSignal | undefined,
  emit: PhaseEmit
): Promise<void> {
  emit({ type: "phase", message: "Checking Chrome availability...", progress: 0 });

  const status = await queryWebBrowserAvailability(binding);
  if (status === "unavailable") {
    throw new PermanentJobError(
      `Chrome Built-in AI "${binding.apiName}" is not available on this device.`
    );
  }
  if (isWebBrowserModelCached(status)) {
    emit({ type: "phase", message: "Already on this device", progress: 100 });
    return;
  }

  if (status === "downloading") {
    emit({
      type: "phase",
      message: "Chrome is downloading the model — resuming...",
      progress: undefined,
    });
  } else {
    emit({ type: "phase", message: "Starting download...", progress: 0 });
  }

  const session = await createForDownload(binding, signal, emit);
  session.destroy();
  emit({ type: "phase", message: "Download complete", progress: 100 });
}

export async function queryWebBrowserModelStatus(
  model: WebBrowserModelConfig | undefined
): Promise<{
  readonly availability: Availability;
  readonly is_cached: boolean;
  readonly is_loaded: boolean;
}> {
  const binding = resolveWebBrowserApi(model);
  const availability = await queryWebBrowserAvailability(binding);
  const ready = isWebBrowserModelCached(availability);
  return { availability, is_cached: ready, is_loaded: ready };
}

/**
 * Chrome streaming APIs have shipped both progressive full-text snapshots and
 * append chunks across API versions. This helper emits append-mode text-delta
 * events for both shapes.
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
