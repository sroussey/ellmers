/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelConfig } from "@workglow/ai";
import {
  AiProviderRegistry,
  DirectExecutionStrategy,
  getAiProviderRegistry,
  ImageGenerateTask,
  setAiProviderRegistry,
} from "@workglow/ai";
import { Dataflow, Workflow } from "@workglow/task-graph";
import { ImageGrayscaleTask } from "@workglow/tasks";
import { sleep } from "@workglow/util";
import { CpuImage, imageValueFromBuffer, type ImageValue } from "@workglow/util/media";
import { beforeEach, describe, expect, it } from "vitest";

const MOCK_PROVIDER = "mock-image-provider";

function syntheticImage(width: number, height: number, fillR: number): ImageValue {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fillR;
    data[i + 1] = 100;
    data[i + 2] = 100;
    data[i + 3] = 255;
  }
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return imageValueFromBuffer(buf, "raw-rgba", width, height);
}

describe.skip("Image generation preview chain", () => {
  beforeEach(() => {
    setAiProviderRegistry(new AiProviderRegistry());
    getAiProviderRegistry().setDefaultStrategy(new DirectExecutionStrategy());
  });

  it("partial ImageGenerate outputs flow through to a downstream grayscale task's preview", async () => {
    const partials = [
      syntheticImage(8, 8, 50),
      syntheticImage(8, 8, 150),
      syntheticImage(8, 8, 250),
    ];

    const grayPreviewSamples: number[] = [];

    // The downstream preview runner is single-buffered: when multiple snapshots
    // arrive while it's awaiting a runPreview() iteration, only the last value
    // wins (intentional backpressure — UIs show latest, not stale frames). To
    // verify intermediate snapshots flow through, the producer must pace itself
    // to the consumer. Each emit waits until the consumer has actually
    // observed it before emitting the next.
    const stream: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      for (let i = 0; i < partials.length; i++) {
        emit({ type: "snapshot", data: { image: partials[i] } } as any);
        while (grayPreviewSamples.length <= i) {
          await sleep(1);
        }
      }
      emit({ type: "finish", data: {} } as any);
    };
    getAiProviderRegistry().registerRunFn(MOCK_PROVIDER, {
      serves: ["image.generation"],
      runFn: stream,
    });

    const model: ModelConfig = {
      model_id: "mock/img-1",
      provider: MOCK_PROVIDER,
      title: "",
      description: "",
      capabilities: ["image.generation"],
      provider_config: {},
      metadata: {},
    };

    const wf = new Workflow();
    const gen = new ImageGenerateTask({ defaults: { model, prompt: "x", seed: 1 } });
    const gray = new ImageGrayscaleTask();
    wf.graph.addTasks([gen, gray]);
    wf.graph.addDataflow(new Dataflow(gen.id, "image", gray.id, "image"));

    const collector = (async () => {
      for await (const out of gray.runner.runPreviewStream()) {
        if (out?.image) {
          // Decode the ImageValue back through CpuImage to inspect pixels.
          const cpu = await CpuImage.from(out.image as ImageValue);
          const bin = cpu.getBinary();
          grayPreviewSamples.push(bin.data[0]!);
        }
      }
    })();

    await wf.run();
    await collector;

    expect(grayPreviewSamples.length).toBeGreaterThanOrEqual(2);
    expect(new Set(grayPreviewSamples).size).toBeGreaterThan(1);
  });
});
