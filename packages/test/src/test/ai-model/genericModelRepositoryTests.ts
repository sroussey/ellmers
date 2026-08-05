/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRepository } from "@workglow/ai";
import { getGlobalModelRepository, setGlobalModelRepository } from "@workglow/ai";
import { beforeEach, expect, it } from "vitest";

const HF_TRANSFORMERS_ONNX = "HF_TRANSFORMERS_ONNX";

export const runGenericModelRepositoryTests = (
  createRepository: () => Promise<ModelRepository>
) => {
  let repository: ModelRepository;

  beforeEach(async () => {
    repository = await createRepository();
    await repository.setupDatabase?.();
    setGlobalModelRepository(repository);
  });

  it("store and find model by name", async () => {
    await getGlobalModelRepository().addModel({
      model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      title: "LaMini-Flan-T5-783M",
      description: "LaMini-Flan-T5-783M",
      capabilities: ["text.generation", "text.rewriter"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text2text-generation",
        model_path: "Xenova/LaMini-Flan-T5-783M",
        dtype: "q8",
      },
      metadata: {},
    });

    const model = await getGlobalModelRepository().findByName("onnx:Xenova/LaMini-Flan-T5-783M:q8");
    expect(model).toBeDefined();
    expect(model?.model_id).toEqual("onnx:Xenova/LaMini-Flan-T5-783M:q8");

    const nonExistentModel = await getGlobalModelRepository().findByName("onnx:Xenova/no-exist");
    expect(nonExistentModel).toBeUndefined();
  });

  it("store and find tasks by model", async () => {
    await getGlobalModelRepository().addModel({
      model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      title: "LaMini-Flan-T5-783M",
      description: "LaMini-Flan-T5-783M",
      capabilities: ["text.generation", "text.rewriter"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text2text-generation",
        model_path: "Xenova/LaMini-Flan-T5-783M",
        dtype: "q8",
      },
      metadata: {},
    });
    const tasks = await getGlobalModelRepository().findTasksByModel(
      "onnx:Xenova/LaMini-Flan-T5-783M:q8"
    );
    expect(tasks).toBeDefined();
    expect(tasks?.length).toEqual(2);
  });
  it("store and find model by task", async () => {
    const repo = getGlobalModelRepository();

    // Add the model and wait for it to complete
    await repo.addModel({
      model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      title: "LaMini-Flan-T5-783M",
      description: "LaMini-Flan-T5-783M",
      capabilities: ["text.generation", "text.rewriter"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text2text-generation",
        model_path: "Xenova/LaMini-Flan-T5-783M",
        dtype: "q8",
      },
      metadata: {},
    });

    // Search for models by task
    const models = await repo.findModelsByTask("text.generation");
    expect(models).toBeDefined();
    expect(models?.length).toEqual(1);
    expect(models?.[0].model_id).toEqual("onnx:Xenova/LaMini-Flan-T5-783M:q8");
    expect(models?.[0].capabilities).toEqual(["text.generation", "text.rewriter"]);
    expect(models?.[0].provider).toEqual(HF_TRANSFORMERS_ONNX);
    expect(models?.[0].provider_config?.pipeline).toEqual("text2text-generation");
    expect(models?.[0].provider_config?.model_path).toEqual("Xenova/LaMini-Flan-T5-783M");
    expect(models?.[0].provider_config?.dtype).toEqual("q8");
  });

  it("rejects duplicate model_id", async () => {
    const repo = getGlobalModelRepository();
    const model = {
      model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      title: "LaMini-Flan-T5-783M",
      description: "LaMini-Flan-T5-783M",
      capabilities: ["text.generation"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text2text-generation",
        model_path: "Xenova/LaMini-Flan-T5-783M",
      },
      metadata: {},
    };

    await repo.addModel(model);
    await expect(repo.addModel(model)).rejects.toThrow("already exists");
  });

  it("rejects model missing required fields", async () => {
    const repo = getGlobalModelRepository();
    const incomplete = {
      model_id: "test:incomplete",
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {},
    } as any;

    await expect(repo.addModel(incomplete)).rejects.toThrow("Invalid model record");
  });

  it("rejects model with wrong field types", async () => {
    const repo = getGlobalModelRepository();
    const badTypes = {
      model_id: "test:bad-types",
      title: "Test",
      description: "Test",
      capabilities: "not-an-array",
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {},
      metadata: {},
    } as any;

    await expect(repo.addModel(badTypes)).rejects.toThrow("Invalid model record");
  });

  it("updateModel updates an existing model", async () => {
    const repo = getGlobalModelRepository();
    await repo.addModel({
      model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      title: "LaMini-Flan-T5-783M",
      description: "LaMini-Flan-T5-783M",
      capabilities: ["text.generation"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text2text-generation",
        model_path: "Xenova/LaMini-Flan-T5-783M",
      },
      metadata: {},
    });

    await repo.updateModel({
      model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      title: "Updated Title",
      description: "Updated Description",
      capabilities: ["text.generation", "text.rewriter"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: {
        pipeline: "text2text-generation",
        model_path: "Xenova/LaMini-Flan-T5-783M",
      },
      metadata: {},
    });

    const updated = await repo.findByName("onnx:Xenova/LaMini-Flan-T5-783M:q8");
    expect(updated).toBeDefined();
    expect(updated?.title).toEqual("Updated Title");
    expect(updated?.capabilities?.length).toEqual(2);
  });

  it("updateModel rejects non-existent model", async () => {
    const repo = getGlobalModelRepository();
    const model = {
      model_id: "onnx:does-not-exist",
      title: "Test",
      description: "Test",
      capabilities: ["text.generation"],
      provider: HF_TRANSFORMERS_ONNX,
      provider_config: { pipeline: "text2text-generation", model_path: "test" },
      metadata: {},
    };

    await expect(repo.updateModel(model)).rejects.toThrow("not found");
  });

  it("updateModel validates schema", async () => {
    const repo = getGlobalModelRepository();
    const invalid = {
      model_id: "test:invalid",
      provider: HF_TRANSFORMERS_ONNX,
    } as any;

    await expect(repo.updateModel(invalid)).rejects.toThrow("Invalid model record");
  });
};
