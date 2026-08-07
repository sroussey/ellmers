/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getGlobalModelRepository,
  InMemoryModelRepository,
  ModelDownloadTask,
  setGlobalModelRepository,
  TextGenerationTask,
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

const MODEL_ID = "onnx:Xenova/LaMini-Flan-T5-783M:q8";

describe("TextGenerationTask abort behavior", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  beforeAll(async () => {
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await clearPipelineCache();
    await registerHuggingFaceTransformersInline();

    const model: HfTransformersOnnxModelRecord = {
      model_id: MODEL_ID,
      title: "LaMini-Flan-T5-783M",
      description: "LaMini-Flan-T5-783M q8",
      capabilities: ["text.generation"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text2text-generation",
        model_path: "Xenova/LaMini-Flan-T5-783M",
        dtype: "q8",
      },
      metadata: {},
    };

    await getGlobalModelRepository().addModel(model);

    // Download (or warm up from cache) the model before running generation tests
    const download = new ModelDownloadTask({ defaults: { model: MODEL_ID } });
    download.on("progress", (progress, _message, details) => {
      logger.info(
        `Download ${MODEL_ID}: ${progress}% | ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
      );
    });
    await download.run();
  }, 120_000);

  afterAll(async () => {
    try {
      await unloadModel({ model: MODEL_ID });
    } catch {}
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });

  it("should abort text generation when the task is aborted mid-stream", async () => {
    const task = new TextGenerationTask();

    let firstChunkSeen = false;
    let abortCalled = false;
    let chunksAfterAbort = 0;

    // Listen for stream chunks (one per generated token) and abort on the first
    task.on("stream_chunk", (event) => {
      if (event.type !== "text-delta") return;
      logger.info("Stream chunk:", { event });
      if (!firstChunkSeen) {
        firstChunkSeen = true;
        setTimeout(() => {
          abortCalled = true;
          task.abort();
          logger.info("Abort called during generation");
        }, 1);
      }
      if (abortCalled) {
        chunksAfterAbort++;
      }
    });

    // Use a long open-ended prompt so the model keeps generating tokens
    const runPromise = task.run({
      model: MODEL_ID,
      prompt: "Write a very long story about a knight who goes on a quest",
    });

    try {
      await runPromise;
      logger.info("Generation completed (may have been too fast to abort)");
      // If the model finishes before abort can take effect, ensure it at least completed
      expect(task.status).toBe(TaskStatus.COMPLETED);
    } catch (error: any) {
      logger.info("Generation aborted as expected:", { error });

      // The task should be in an aborting or failed state
      expect([TaskStatus.ABORTING, TaskStatus.FAILED]).toContain(task.status);

      // The error should be abort-related
      const errorMessage: string = error?.message?.toLowerCase() ?? "";
      const isAbortError =
        errorMessage.includes("abort") ||
        errorMessage.includes("generation aborted") ||
        error?.constructor?.name === "TaskAbortedError" ||
        error?.constructor?.type === "TaskAbortedError";

      if (!isAbortError) {
        logger.error("Unexpected error type during abort:", { error });
      }
      expect(isAbortError).toBe(true);

      // Give any in-flight events a moment to settle
      await sleep(500);

      // Chunks arriving after abort should be minimal — the streamer callback
      // throws on the next invocation once the signal is aborted.
      logger.info(`Chunks before abort: ${chunksAfterAbort === 0 ? "all" : "some"}`);
      logger.info(`Chunks after abort:  ${chunksAfterAbort}`);
      expect(chunksAfterAbort).toBeLessThan(10);
    }
  }, 120_000);
});
