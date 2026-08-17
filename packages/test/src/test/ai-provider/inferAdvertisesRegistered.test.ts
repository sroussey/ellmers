/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai";
import { _testOnly as anthropic } from "@workglow/anthropic/ai";
import { _testOnly as cactus } from "@workglow/cactus/ai";
import { _testOnly as chromeAi } from "@workglow/chrome-ai/ai";
import { _testOnly as deepseek } from "@workglow/deepseek/ai";
import { _testOnly as gemini } from "@workglow/google-gemini/ai";
import { _testOnly as hfi } from "@workglow/huggingface-inference/ai";
import { _testOnly as hft } from "@workglow/huggingface-transformers/ai";
import { _testOnly as llamaServer } from "@workglow/llamacpp-server/ai";
import { _testOnly as llamaCpp } from "@workglow/node-llama-cpp/ai";
import { _testOnly as ollama } from "@workglow/ollama/ai";
import { _testOnly as openai } from "@workglow/openai/ai";
import { _testOnly as openrouter } from "@workglow/openrouter/ai";
import { _testOnly as sdCpp } from "@workglow/stable-diffusion-server/ai";
import { _testOnly as tfmp } from "@workglow/tf-mediapipe/ai";
import { _testOnly as xai } from "@workglow/xai/ai";
import { describe, it } from "vitest";

import { assertInferAdvertisesRegistered } from "../../contract/ai-provider/assertions/inferAdvertisesRegistered";

function model(
  provider: string,
  model_id: string,
  extra: { provider_config?: Record<string, unknown>; metadata?: Record<string, unknown> } = {}
): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider,
    provider_config: { model_name: model_id, model_path: model_id, ...extra.provider_config },
    capabilities: [],
    metadata: extra.metadata ?? {},
  } as ModelRecord;
}

function servesOf(
  specs: readonly { readonly serves: readonly Capability[] }[]
): readonly (readonly string[])[] {
  return specs.map((spec) => spec.serves);
}

describe("inferCapabilities advertises every registered capability", () => {
  it.each([
    {
      name: "anthropic",
      registered: servesOf(anthropic.ANTHROPIC_RUN_FN_SPECS),
      inferred: ["claude-sonnet-5"].map((id) =>
        new anthropic.AnthropicQueuedProvider(anthropic.ANTHROPIC_RUN_FNS).inferCapabilities(
          model("ANTHROPIC", id)
        )
      ),
    },
    {
      name: "openai",
      registered: servesOf(openai.OPENAI_RUN_FN_SPECS),
      inferred: ["gpt-4o", "text-embedding-3-small", "dall-e-3", "gpt-image-1"].map((id) =>
        new openai.OpenAiQueuedProvider(openai.OPENAI_RUN_FNS).inferCapabilities(
          model("OPENAI", id)
        )
      ),
    },
    {
      name: "google-gemini",
      registered: servesOf(gemini.GEMINI_RUN_FN_SPECS),
      inferred: [
        "gemini-2.5-pro",
        "gemini-embedding-001",
        "imagen-4.0-generate-001",
        "gemini-3.1-flash-image",
      ].map((id) =>
        new gemini.GoogleGeminiQueuedProvider(gemini.GEMINI_RUN_FNS).inferCapabilities(
          model("GOOGLE_GEMINI", id)
        )
      ),
    },
    {
      name: "xai",
      registered: servesOf(xai.XAI_RUN_FN_SPECS),
      inferred: ["grok-4", "grok-2-image-1212"].map((id) =>
        new xai.XaiQueuedProvider(xai.XAI_RUN_FNS).inferCapabilities(model("XAI", id))
      ),
    },
    {
      name: "deepseek",
      registered: servesOf(deepseek.DEEPSEEK_RUN_FN_SPECS),
      inferred: ["deepseek-v4-flash"].map((id) =>
        new deepseek.DeepSeekQueuedProvider(deepseek.DEEPSEEK_RUN_FNS).inferCapabilities(
          model("DEEPSEEK", id)
        )
      ),
    },
    {
      name: "openrouter",
      registered: servesOf(openrouter.OPENROUTER_RUN_FN_SPECS),
      inferred: [
        new openrouter.OpenRouterQueuedProvider(openrouter.OPENROUTER_RUN_FNS).inferCapabilities(
          model("OPENROUTER", "openai/gpt-5", {
            metadata: {
              architecture: { input_modalities: ["text"] },
              supported_parameters: ["tools", "response_format"],
            },
          })
        ),
      ],
    },
    {
      name: "huggingface-transformers",
      registered: servesOf(hft.HFT_RUN_FN_SPECS),
      inferred: (
        [
          ["onnx-community/Llama-3.2-1B-Instruct-q4f16"],
          ["Xenova/all-MiniLM-L6-v2", { pipeline_task: "feature-extraction" }],
          ["Xenova/modnet", { pipeline_task: "background-removal" }],
          ["Xenova/bge-reranker-base"],
          ["Xenova/language-detection"],
          ["Xenova/clip-vit-base-patch32"],
          ["Xenova/distilbert-base-uncased", { pipeline_task: "text-classification" }],
          ["Xenova/bert-base-ner", { pipeline_task: "token-classification" }],
          ["Xenova/bert-base-uncased", { pipeline_task: "fill-mask" }],
          ["Xenova/t5-small", { pipeline_task: "translation" }],
          ["Xenova/distilbert-base-cased-distilled-squad", { pipeline_task: "question-answering" }],
          ["Xenova/segformer", { pipeline_task: "image-segmentation" }],
          ["Xenova/vit-gpt2", { pipeline_task: "image-to-text" }],
          ["Xenova/yolos-tiny", { pipeline_task: "object-detection" }],
        ] as const
      ).map(([id, pc]) =>
        new hft.HuggingFaceTransformersQueuedProvider(hft.HFT_RUN_FNS).inferCapabilities(
          model("HF_TRANSFORMERS_ONNX", id, pc ? { provider_config: pc } : {})
        )
      ),
    },
    {
      name: "huggingface-inference",
      registered: servesOf(hfi.HFI_RUN_FN_SPECS),
      inferred: [
        "mistralai/Mistral-7B-Instruct-v0.3",
        "Xenova/all-MiniLM-L6-v2",
        "black-forest-labs/FLUX.1-dev",
      ].map((id) =>
        new hfi.HfInferenceQueuedProvider(hfi.HFI_RUN_FNS).inferCapabilities(
          model("HF_INFERENCE", id)
        )
      ),
    },
    {
      name: "node-llama-cpp",
      registered: servesOf(llamaCpp.LLAMACPP_RUN_FN_SPECS),
      inferred: ["Mistral-7B-Instruct-v0.3.Q4_K_M.gguf", "nomic-embed-text-v1.5.Q4_K_M.gguf"].map(
        (id) =>
          new llamaCpp.LlamaCppQueuedProvider(llamaCpp.LLAMACPP_RUN_FNS).inferCapabilities(
            model("LOCAL_LLAMACPP", id)
          )
      ),
    },
    {
      name: "llamacpp-server",
      registered: servesOf(llamaServer.LLAMACPP_SERVER_RUN_FN_SPECS),
      inferred: ["llama-3-8b-q4_k_m.gguf", "nomic-embed-text.gguf"].map((id) =>
        new llamaServer.LlamaCppServerQueuedProvider(
          llamaServer.buildLlamaCppServerRunFns({})
        ).inferCapabilities(model("LOCAL_LLAMACPP_SERVER", id))
      ),
    },
    {
      name: "ollama",
      registered: servesOf(ollama.OLLAMA_RUN_FN_SPECS),
      inferred: ["llama3.2", "nomic-embed-text", "llava"].map((id) =>
        new ollama.OllamaQueuedProvider(ollama.OLLAMA_RUN_FNS).inferCapabilities(
          model("OLLAMA", id)
        )
      ),
    },
    {
      name: "chrome-ai",
      registered: servesOf(chromeAi.WEB_BROWSER_RUN_FN_SPECS),
      inferred: [
        "chrome-prompt",
        "chrome-summarizer",
        "chrome-rewriter",
        "chrome-translator",
        "chrome-language-detector",
      ].map((id) => chromeAi.inferWebBrowserCapabilities(model("WEB_BROWSER", id))),
    },
    {
      name: "tf-mediapipe",
      registered: servesOf(tfmp.TFMP_RUN_FN_SPECS),
      inferred: [
        "gemma3-1b-it-int4-web.task",
        "gesture_recognizer.task",
        "face_landmarker.task",
        "blaze_face_short_range.tflite",
        "pose_landmarker_lite.task",
        "efficientdet_lite0.tflite",
        "selfie_segmenter.tflite",
        "efficientnet_lite0.tflite",
        "image_embedder.tflite",
        "universal_sentence_encoder.tflite",
        "bert_classifier.tflite",
        "language_detector.tflite",
      ].map((id) =>
        new tfmp.TensorFlowMediaPipeQueuedProvider(tfmp.TFMP_RUN_FNS).inferCapabilities(
          model("TENSORFLOW_MEDIAPIPE", id)
        )
      ),
    },
    {
      name: "cactus",
      registered: cactus.CACTUS_RUN_FNS.map((r) => r.serves),
      inferred: [
        new cactus.CactusQueuedProvider().inferCapabilities(model("LOCAL_CACTUS", "needle-26m")),
      ],
    },
    {
      name: "stable-diffusion-server",
      registered: servesOf(sdCpp.STABLE_DIFFUSION_CPP_RUN_FN_SPECS),
      inferred: ["sd-1.5.gguf"].map((id) =>
        new sdCpp.StableDiffusionCppQueuedProvider(
          sdCpp.buildStableDiffusionCppRunFns({})
        ).inferCapabilities(model("LOCAL_STABLE_DIFFUSION_CPP", id))
      ),
    },
  ])("$name", ({ name, registered, inferred }) => {
    assertInferAdvertisesRegistered(name, registered, inferred);
  });
});
