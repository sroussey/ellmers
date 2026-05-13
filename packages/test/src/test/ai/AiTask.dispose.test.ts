/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRunFn, ModelConfig } from "@workglow/ai";
import {
  AiProviderRegistry,
  TextSummaryTask,
  setAiProviderRegistry,
} from "@workglow/ai";
import { ResourceScope } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const MOCK_PROVIDER = "mock-dispose-fallback-provider";

function buildModel(): ModelConfig {
  return {
    model_id: `${MOCK_PROVIDER}:test-model:v1`,
    title: "test-model",
    description: "test",
    capabilities: ["text.summary"],
    provider: MOCK_PROVIDER,
    provider_config: {},
    metadata: {},
  };
}

describe("AiTask resourceScope disposer fallback", () => {
  let registry: AiProviderRegistry;
  let scope: ResourceScope;

  beforeEach(() => {
    registry = new AiProviderRegistry();
    setAiProviderRegistry(registry);
    scope = new ResourceScope();
  });

  afterEach(async () => {
    await scope.disposeAll();
  });

  it("falls back to model.download-remove when no model.dispose run-fn is registered", async () => {
    let disposeCalls = 0;
    const summaryFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "finish", data: { text: "summary" } });
    };
    const downloadRemoveFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      disposeCalls += 1;
      emit({ type: "finish", data: {} });
    };
    registry.registerRunFn(MOCK_PROVIDER, { serves: ["text.summary"], runFn: summaryFn });
    registry.registerRunFn(MOCK_PROVIDER, {
      serves: ["model.download-remove"],
      runFn: downloadRemoveFn,
    });

    const model = buildModel();
    const task = new TextSummaryTask({ id: "dispose-1" });
    await task.run({ model, text: "hello" }, { resourceScope: scope });
    expect(disposeCalls).toBe(0);

    await scope.disposeAll();
    expect(disposeCalls).toBe(1);
  });

  it("does not throw when the provider registers no dispose run-fn (cloud-style)", async () => {
    const summaryFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "finish", data: { text: "summary" } });
    };
    registry.registerRunFn(MOCK_PROVIDER, { serves: ["text.summary"], runFn: summaryFn });

    const model = buildModel();
    const task = new TextSummaryTask({ id: "dispose-2" });
    await task.run({ model, text: "hello" }, { resourceScope: scope });
    await scope.disposeAll();
    // Reaching here means dispose path was a no-op (the registry has no
    // model.download-remove run-fn for this provider).
    expect(true).toBe(true);
  });

  it("prefers model.dispose when registered", async () => {
    let disposeCalls = 0;
    let downloadRemoveCalls = 0;
    const summaryFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      emit({ type: "finish", data: { text: "summary" } });
    };
    const disposeFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      disposeCalls += 1;
      emit({ type: "finish", data: {} });
    };
    const downloadRemoveFn: AiProviderRunFn = async (_input, _model, _signal, emit) => {
      downloadRemoveCalls += 1;
      emit({ type: "finish", data: {} });
    };
    registry.registerRunFn(MOCK_PROVIDER, { serves: ["text.summary"], runFn: summaryFn });
    registry.registerRunFn(MOCK_PROVIDER, { serves: ["model.dispose"], runFn: disposeFn });
    registry.registerRunFn(MOCK_PROVIDER, {
      serves: ["model.download-remove"],
      runFn: downloadRemoveFn,
    });

    const model = buildModel();
    const task = new TextSummaryTask({ id: "dispose-3" });
    await task.run({ model, text: "hello" }, { resourceScope: scope });
    await scope.disposeAll();

    expect(disposeCalls).toBe(1);
    expect(downloadRemoveCalls).toBe(0);
  });
});
