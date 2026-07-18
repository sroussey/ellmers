/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeminiModelConfig } from "@workglow/google-gemini/ai";
import { globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import { mock } from "bun:test";

const deletedNames: string[] = [];
const testModel = {
  model_id: "gemini-2.5-flash",
  provider: "GOOGLE_GEMINI",
  provider_config: {
    model_name: "gemini-2.5-flash",
  },
} as const satisfies GeminiModelConfig;

process.env.GEMINI_API_KEY = "worker-test-key";

mock.module("@google/genai", () => ({
  FunctionCallingConfigMode: {
    ANY: "ANY",
    AUTO: "AUTO",
    NONE: "NONE",
  },
  GoogleGenAI: class {
    readonly caches = {
      delete: async ({ name }: { readonly name: string }): Promise<void> => {
        deletedNames.push(name);
      },
    };
  },
}));

const { getGeminiCachedContent, registerGeminiWorker, setGeminiCachedContent } =
  await import("@workglow/google-gemini/ai-runtime");

const workerServer = globalServiceRegistry.get(WORKER_SERVER);
workerServer.registerFunction(
  "test.gemini.seed-cache",
  async (input: { readonly sessionId: string; readonly name: string }): Promise<void> => {
    setGeminiCachedContent(input.sessionId, {
      name: input.name,
      model: testModel,
      systemPrompt: undefined,
    });
  }
);
workerServer.registerFunction(
  "test.gemini.inspect-cache",
  async (
    sessionId: string
  ): Promise<{ readonly present: boolean; readonly deletedNames: string[] }> => ({
    present: getGeminiCachedContent(sessionId) !== undefined,
    deletedNames: [...deletedNames],
  })
);

await registerGeminiWorker();
