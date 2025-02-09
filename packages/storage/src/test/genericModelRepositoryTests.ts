import { beforeEach, describe, expect, it } from "bun:test";
import { setGlobalModelRepository, getGlobalModelRepository, ModelRepository } from "ellmers-ai";

const LOCAL_ONNX_TRANSFORMERJS = "LOCAL_ONNX_TRANSFORMERJS";

export const runGenericModelRepositoryTests = (
  createRepository: () => Promise<ModelRepository>
) => {
  let repository: ModelRepository;

  beforeEach(async () => {
    repository = await createRepository();
    setGlobalModelRepository(repository);
  });

  it("store and find model by task", async () => {
    await getGlobalModelRepository().addModel({
      name: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      url: "Xenova/LaMini-Flan-T5-783M",
      availableOnBrowser: true,
      availableOnServer: true,
      provider: LOCAL_ONNX_TRANSFORMERJS,
      pipeline: "text2text-generation",
    });
    await getGlobalModelRepository().connectTaskToModel(
      "TextGenerationTask",
      "onnx:Xenova/LaMini-Flan-T5-783M:q8"
    );
    await getGlobalModelRepository().connectTaskToModel(
      "TextRewritingTask",
      "onnx:Xenova/LaMini-Flan-T5-783M:q8"
    );
    const tasks = await getGlobalModelRepository().findTasksByModel(
      "onnx:Xenova/LaMini-Flan-T5-783M:q8"
    );
    expect(tasks).toBeDefined();
    expect(tasks?.length).toEqual(2);
    const models = await getGlobalModelRepository().findModelsByTask("TextGenerationTask");
    expect(models).toBeDefined();
    expect(models?.length).toEqual(1);
  });

  it("store and find model by name", async () => {
    await getGlobalModelRepository().addModel({
      name: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
      url: "Xenova/LaMini-Flan-T5-783M",
      availableOnBrowser: true,
      availableOnServer: true,
      provider: LOCAL_ONNX_TRANSFORMERJS,
      pipeline: "text2text-generation",
    });

    const model = await getGlobalModelRepository().findByName("onnx:Xenova/LaMini-Flan-T5-783M:q8");
    expect(model).toBeDefined();
    expect(model?.name).toEqual("onnx:Xenova/LaMini-Flan-T5-783M:q8");

    const nonExistentModel = await getGlobalModelRepository().findByName("onnx:Xenova/no-exist");
    expect(nonExistentModel).toBeUndefined();
  });
};
