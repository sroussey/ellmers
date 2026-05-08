/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DownloadModelTask,
  DownloadModelTaskRunOutput,
  getGlobalModelRepository,
  InMemoryModelRepository,
  setGlobalModelRepository,
  unloadModel,
} from "@workglow/ai";
import {
  clearPipelineCache,
  HF_TRANSFORMERS_ONNX,
  registerHuggingFaceTransformersInline,
} from "@workglow/huggingface-transformers/ai-runtime";
import type { HfTransformersOnnxModelRecord } from "@workglow/huggingface-transformers/ai-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry, TaskStatus } from "@workglow/task-graph";
import { setLogger, sleep } from "@workglow/util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getTestingLogger } from "../../binding/TestingLogger";

describe("DownloadModelTask abort behavior", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  const modelId = "onnx:Supabase/gte-small:q8";

  beforeAll(async () => {
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    clearPipelineCache();
    await registerHuggingFaceTransformersInline();
  });

  afterAll(async () => {
    try {
      await unloadModel({
        model: modelId,
      });
    } catch {}
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });

  it("should abort download when task is aborted", async () => {
    // Register a model
    const model: HfTransformersOnnxModelRecord = {
      model_id: modelId,
      title: "gte-small",
      description: "Supabase/gte-small quantized to 8bit",
      tasks: ["TextEmbeddingTask"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "feature-extraction",
        model_path: "Supabase/gte-small",
        dtype: "q8",
        native_dimensions: 384,
      },
      metadata: {},
    };

    await getGlobalModelRepository().addModel(model);

    const download = new DownloadModelTask({
      defaults: { model: modelId },
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

    let downloadPromise: Promise<DownloadModelTaskRunOutput>;
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
    } catch (error: any) {
      logger.info("Download failed:", { error });
      // Expected to throw - verify the task is in aborting or error state
      expect([TaskStatus.ABORTING, TaskStatus.FAILED]).toContain(download.status);

      // The error should indicate abort (could be from our code or from the library)
      const errorMessage: string = error?.message?.toLowerCase() || "";
      const isAbortError =
        errorMessage.includes("abort") ||
        errorMessage.includes("protobuf parsing failed") ||
        errorMessage.includes("json parse error") ||
        errorMessage.includes("unexpected eof") ||
        errorMessage.includes("closed") ||
        error?.code === "ERR_INVALID_STATE";

      if (!isAbortError) console.error("Unexpected error:", { errorMessage, error });

      expect(isAbortError).toBe(true);

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
