/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelDownloadTaskRunOutput } from "@workglow/ai";
import {
  getGlobalModelRepository,
  InMemoryModelRepository,
  ModelDownloadTask,
  setGlobalModelRepository,
  unloadModel,
} from "@workglow/ai";
import type { HfTransformersOnnxModelRecord } from "@workglow/huggingface-transformers/ai-runtime";
import {
  clearPipelineCache,
  HF_TRANSFORMERS_ONNX,
  registerHuggingFaceTransformersInline,
} from "@workglow/huggingface-transformers/ai-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry, TaskStatus } from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getTestingLogger } from "@workglow/util/test";

const MODEL_ID = "onnx:Supabase/gte-small:q8";

const model: HfTransformersOnnxModelRecord = {
  model_id: MODEL_ID,
  title: "gte-small",
  description: "Supabase/gte-small quantized to 8bit",
  capabilities: ["text.embedding"],
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Supabase/gte-small",
    dtype: "q8",
    native_dimensions: 384,
  },
  metadata: {},
};

function isAbortRelatedError(err: unknown): boolean {
  let current: unknown = err;
  while (current && typeof current === "object") {
    const e = current as { name?: string; message?: string; cause?: unknown; code?: string };
    if (
      e.name === "AbortError" ||
      e.name === "AbortSignalJobError" ||
      e.name === "TaskAbortedError"
    ) {
      return true;
    }
    const message = e.message?.toLowerCase() ?? "";
    if (
      message.includes("abort") ||
      message.includes("protobuf parsing failed") ||
      message.includes("json parse error") ||
      message.includes("unexpected eof") ||
      message.includes("closed")
    ) {
      return true;
    }
    if (e.code === "ERR_INVALID_STATE") {
      return true;
    }
    current = e.cause;
  }
  return false;
}

describe("ModelDownloadTask abort behavior", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  beforeAll(async () => {
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await clearPipelineCache();
    await registerHuggingFaceTransformersInline();
    await getGlobalModelRepository().addModel(model);
  });

  afterAll(async () => {
    try {
      await unloadModel({
        model: MODEL_ID,
      });
    } catch {}
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });

  it("should abort download when task is aborted", async () => {
    const download = new ModelDownloadTask({
      defaults: { model: MODEL_ID },
    });

    let progressCount = 0;
    let progressAfterAbort = 0;
    let abortCalled = false;
    let firstProgressSeen = false;

    download.on("progress", () => {
      logger.info("Progress event:", { progressCount });
      if (!firstProgressSeen) {
        firstProgressSeen = true;
        // Abort as soon as we see the first progress event
        // This ensures we're aborting during an active download
        setTimeout(() => {
          abortCalled = true;
          download.abort();
          logger.info("Abort called");
        }, 1);
      }
      progressCount++;
      if (abortCalled) {
        progressAfterAbort++;
      }
    });

    let downloadPromise: Promise<ModelDownloadTaskRunOutput>;
    // The download should throw an error due to abort
    logger.info("Starting download");
    // Start the download
    downloadPromise = download.run();
    logger.info("Download started");
    try {
      await downloadPromise;
      logger.info("Download completed");
      // If we get here, check if it was because the download was too fast
      // (model already cached or very small)
      if (!firstProgressSeen || progressCount < 5) {
        logger.info("Note: Download completed too quickly to abort (likely cached)");
        expect(download.status).toBe(TaskStatus.COMPLETED);
      } else {
        // If we saw significant progress but still completed, that's unexpected
        logger.info("Download should have been aborted after seeing progress events");
        expect.fail("Download should have been aborted after seeing progress events");
      }
    } catch (error: unknown) {
      logger.info("Download failed:", { error });
      // Expected to throw - verify the task is in aborting or error state
      expect([TaskStatus.ABORTING, TaskStatus.FAILED]).toContain(download.status);

      if (!isAbortRelatedError(error)) {
        console.error("Unexpected error:", { error });
      }

      expect(isAbortRelatedError(error)).toBe(true);

      // Give it a moment to settle any in-flight operations
      const sleepPromise = sleep(1000);
      await Promise.race([sleepPromise, downloadPromise.catch(() => {})]);

      // Progress events after abort should be minimal (maybe a few in-flight ones)
      // If progressAfterAbort is high (e.g., > 20), it means the download continued
      logger.info(`Total progress events: ${progressCount}`);
      logger.info(`Progress before abort: ${progressCount - progressAfterAbort}`);
      logger.info(`Progress after abort: ${progressAfterAbort}`);

      // This is the key assertion - if progress continued significantly after abort,
      // it means the underlying downloads weren't stopped
      // Allow for some in-flight events (up to 20), but not minutes of continued downloading
      expect(progressAfterAbort).toBeLessThan(20);
    }
  }, 30000);
});
