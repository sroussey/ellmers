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
} from "@workglow/ai";
import type { LlamaCppModelRecord } from "@workglow/node-llama-cpp/ai";
import { LOCAL_LLAMACPP } from "@workglow/node-llama-cpp/ai";
import {
  disposeLlamaCppResources,
  getLlamaCppSdk,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  loadSdk,
  registerLlamaCppInline,
} from "@workglow/node-llama-cpp/ai-runtime";
import { getTaskQueueRegistry, setTaskQueueRegistry } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import { afterAll, beforeAll, describe, it } from "vitest";

import { getTestingLogger } from "@workglow/util/test";

// ========================================================================
// Tool model definitions (same as LlamaCpp_Generic)
// ========================================================================

const toolModels: LlamaCppModelRecord[] = [
  {
    model_id: "llamacpp:LiquidAI/LFM2-1.2B-Tool:Q8_0",
    title: "LFM2 1.2B Tool",
    description: "A 1.2B parameter instruction-following model with tool calling support",
    capabilities: ["text.generation", "tool-use"],
    provider: LOCAL_LLAMACPP,
    provider_config: {
      model_path: "./models/LiquidAI/LFM2-1.2B-Tool-GGUF.Q8_0.gguf",
      model_url: "hf:LiquidAI/LFM2-1.2B-Tool-GGUF:Q8_0",
      models_dir: "./models",
      flash_attention: true,
      seed: 42,
    },
    metadata: {},
  },
  {
    model_id: "llamacpp:bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
    title: "Qwen2.5 Coder 1.5B Instruct",
    description: "A 1.5B parameter instruction-following model with tool calling support",
    capabilities: ["text.generation", "tool-use"],
    provider: LOCAL_LLAMACPP,
    provider_config: {
      model_path: "./models/bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF.Q4_K_M.gguf",
      model_url: "hf:bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
      models_dir: "./models",
      flash_attention: true,
      seed: 42,
    },
    metadata: {},
  },
  {
    model_id: "llamacpp:unsloth/Llama-3.2-1B-Instruct-GGUF:Q4_K_M",
    title: "Llama 3.2 1B Instruct",
    description: "A 1B parameter instruction-following model with tool calling support",
    capabilities: ["text.generation", "tool-use"],
    provider: LOCAL_LLAMACPP,
    provider_config: {
      model_path: "./models/unsloth/Llama-3.2-1B-Instruct-GGUF.Q4_K_M.gguf",
      model_url: "hf:unsloth/Llama-3.2-1B-Instruct-GGUF:Q4_K_M",
      models_dir: "./models",
      flash_attention: true,
      seed: 42,
    },
    metadata: {},
  },
];

// ========================================================================
// Test suite
// ========================================================================

describe("LlamaCpp Chat Wrapper Inspection", () => {
  const timeout = 10 * 60 * 1000;

  beforeAll(async () => {
    const logger = getTestingLogger();
    setLogger(logger);
    await setTaskQueueRegistry(null);
    setGlobalModelRepository(new InMemoryModelRepository());
    await registerLlamaCppInline();

    for (const model of toolModels) {
      await getGlobalModelRepository().addModel(model);
      const download = new ModelDownloadTask();
      download.on("progress", (progress, _message, details) => {
        logger.info(
          `Download ${model.model_id}: ${progress}% | ${details?.file || "?"} @ ${(details?.progress || 0).toFixed(1)}%`
        );
      });
      await download.run({ model: model.model_id });
    }
  }, timeout);

  afterAll(async () => {
    await disposeLlamaCppResources();
    await getTaskQueueRegistry().stopQueues();
    await getTaskQueueRegistry().clearQueues();
    await setTaskQueueRegistry(null);
  });

  for (const model of toolModels) {
    it(
      `inspect chat wrapper: ${model.title}`,
      async () => {
        await loadSdk();
        const { LlamaChat } = getLlamaCppSdk();

        const context = await getOrCreateTextContext(model as any);
        const sequence = context.getSequence();
        const constructorSpread = llamaCppChatSessionConstructorSpread(model as any);

        const llamaChat = new LlamaChat({
          contextSequence: sequence,
          ...constructorSpread,
        });

        const wrapper = llamaChat.chatWrapper;
        const llamaModel = context.model;
        const chatTemplate = llamaModel.fileInfo?.metadata?.tokenizer?.chat_template;

        const isJinja = wrapper.wrapperName === "JinjaTemplate";
        const jinjaInfo = isJinja
          ? {
              usingJinjaFunctionCallTemplate: (wrapper as any).usingJinjaFunctionCallTemplate,
              modelRoleName: (wrapper as any).modelRoleName,
              userRoleName: (wrapper as any).userRoleName,
              systemRoleName: (wrapper as any).systemRoleName,
            }
          : undefined;

        console.log(`\n${"=".repeat(70)}`);
        console.log(`Model:            ${model.title} (${model.model_id})`);
        console.log(`Wrapper name:     ${wrapper.wrapperName}`);
        console.log(
          `Overridden:       ${Object.keys(constructorSpread).length > 0 ? `yes (${Object.keys(constructorSpread).join(", ")})` : "no (auto-resolved)"}`
        );
        console.log(`Has Jinja in GGUF: ${chatTemplate ? "yes" : "no"}`);
        if (chatTemplate) {
          const preview = chatTemplate.slice(0, 120).replace(/\n/g, "\\n");
          console.log(`Template preview: ${preview}...`);
        }
        if (jinjaInfo) {
          console.log(`Jinja func calls: ${jinjaInfo.usingJinjaFunctionCallTemplate}`);
          console.log(
            `Role names:       user=${jinjaInfo.userRoleName} model=${jinjaInfo.modelRoleName} system=${jinjaInfo.systemRoleName}`
          );
        }
        console.log(`Function settings: ${JSON.stringify(wrapper.settings.functions ?? null)}`);
        console.log(`${"=".repeat(70)}\n`);

        llamaChat.dispose({ disposeSequence: false });
        sequence.dispose();
      },
      timeout
    );
  }
});
