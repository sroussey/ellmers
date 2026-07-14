/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryModelRepository, setGlobalModelRepository } from "@workglow/ai";
import { beforeEach, describe, expect, it } from "vitest";
import { registerLlamaCppLocalModels } from "../../samples/LlamaCppModelSamples";
import { registerHuggingfaceLocalModels } from "../../samples/ONNXModelSamples";

describe("sample model registrars", () => {
  let repo: InMemoryModelRepository;

  beforeEach(async () => {
    repo = new InMemoryModelRepository();
    await repo.setupDatabase();
    setGlobalModelRepository(repo);
  });

  it("registers the Bonsai 27B GGUF records with the llama.cpp provider", async () => {
    await registerLlamaCppLocalModels();

    const bonsai = await repo.findByName("gguf:prism-ml/Bonsai-27B-gguf:Q1_0");
    expect(bonsai).toBeDefined();
    expect(bonsai!.provider).toBe("LOCAL_LLAMACPP");
    expect(bonsai!.capabilities).toContain("text.generation");
    expect(bonsai!.capabilities).toContain("json-mode");
    expect(bonsai!.provider_config.model_url).toBe("hf:prism-ml/Bonsai-27B-gguf:Q1_0");
    expect(bonsai!.provider_config.model_path).toBe("./models/Bonsai-27B-Q1_0.gguf");

    const ternary = await repo.findByName("gguf:prism-ml/Ternary-Bonsai-27B-gguf:Q2_0");
    expect(ternary).toBeDefined();
    expect(ternary!.provider).toBe("LOCAL_LLAMACPP");
  });

  it("keeps the ONNX registrar loadable alongside the GGUF one", async () => {
    await registerHuggingfaceLocalModels();
    await registerLlamaCppLocalModels();
    const embed = await repo.findByName("onnx:Xenova/all-MiniLM-L6-v2:q8");
    expect(embed?.provider).toBe("HF_TRANSFORMERS_ONNX");
    const bonsai = await repo.findByName("gguf:prism-ml/Bonsai-27B-gguf:Q1_0");
    expect(bonsai?.provider).toBe("LOCAL_LLAMACPP");
  });
});
