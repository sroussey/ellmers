//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach } from "bun:test";
import { setGlobalModelRepository, getGlobalModelRepository } from "ellmers-ai";
import { SqliteModelRepository } from "../SqliteModelRepository";
import { LOCAL_ONNX_TRANSFORMERJS } from "ellmers-ai-provider/hf-transformers";

describe("SqliteModelRepository", () => {
  it("store and find model by task", async () => {
    setGlobalModelRepository(new SqliteModelRepository(":memory:"));
    await getGlobalModelRepository().addModel({
      name: "ONNX Xenova/LaMini-Flan-T5-783M q8",
      url: "Xenova/LaMini-Flan-T5-783M",
      availableOnBrowser: true,
      availableOnServer: true,
      provider: LOCAL_ONNX_TRANSFORMERJS,
      pipeline: "text2text-generation",
    });
    await getGlobalModelRepository().connectTaskToModel(
      "TextGenerationTask",
      "ONNX Xenova/LaMini-Flan-T5-783M q8"
    );
    await getGlobalModelRepository().connectTaskToModel(
      "TextRewritingTask",
      "ONNX Xenova/LaMini-Flan-T5-783M q8"
    );
    const tasks = await getGlobalModelRepository().findTasksByModel(
      "ONNX Xenova/LaMini-Flan-T5-783M q8"
    );
    expect(tasks).toBeDefined();
    expect(tasks?.length).toEqual(2);
    const models = await getGlobalModelRepository().findModelsByTask("TextGenerationTask");
    expect(models).toBeDefined();
    expect(models?.length).toEqual(1);
  });
  it("store and find model by name", async () => {
    setGlobalModelRepository(new SqliteModelRepository(":memory:"));
    await getGlobalModelRepository().addModel({
      name: "ONNX Xenova/LaMini-Flan-T5-783M q8",
      url: "Xenova/LaMini-Flan-T5-783M",
      availableOnBrowser: true,
      availableOnServer: true,
      provider: LOCAL_ONNX_TRANSFORMERJS,
      pipeline: "text2text-generation",
    });

    const model = await getGlobalModelRepository().findByName("ONNX Xenova/LaMini-Flan-T5-783M q8");
    expect(model).toBeDefined();
    expect(model?.name).toEqual("ONNX Xenova/LaMini-Flan-T5-783M q8");
    const tasks = await getGlobalModelRepository().findTasksByModel(
      "ONNX Xenova/LaMini-Flan-T5-783M q8"
    );
    expect(tasks).toBeUndefined();
    const model2 = await getGlobalModelRepository().findByName("ONNX Xenova/no-exist");
    expect(model2).toBeUndefined();
  });
});
