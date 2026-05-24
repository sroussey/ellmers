/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// TODO(roadmap): when Python runtime bundling lands, replace this stub with a real MLX provider.

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelConfig,
  ModelRecord,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import { AiProvider } from "@workglow/ai";
import { LOCAL_MLX } from "./common/Mlx_Constants";

/**
 * MLX provider stub.
 *
 * The MLX runtime requires a Python environment which is not bundled in v1.
 * The provider registers cleanly so the UI can list it, but all inference
 * calls throw immediately.  See roadmap for Python runtime bundling plans.
 */
export class MlxProvider extends AiProvider {
  readonly name = LOCAL_MLX;
  readonly displayName = "Local MLX (Apple Silicon)";
  readonly isLocal = true;
  readonly supportsBrowser = false;

  constructor() {
    const runFns: readonly AiProviderRunFnRegistration<
      TextGenerationTaskInput,
      TextGenerationTaskOutput,
      ModelConfig
    >[] = [
      {
        serves: ["text.generation"] as readonly Capability[],
        runFn: mlxNotAvailableRunFn as AiProviderRunFn<
          TextGenerationTaskInput,
          TextGenerationTaskOutput,
          ModelConfig
        >,
      },
    ];

    const previewTasks: Record<
      string,
      AiProviderPreviewRunFn<TextGenerationTaskInput, TextGenerationTaskOutput, ModelConfig>
    > = {};

    super(runFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return (model.capabilities as readonly Capability[] | undefined) ?? ["text.generation"];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub run-fn — always throws
// ─────────────────────────────────────────────────────────────────────────────

const mlxNotAvailableRunFn: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  ModelConfig
> = async (_input, _model, _signal, _emit) => {
  throw new Error("MLX provider not available: Python runtime not bundled in v1; see roadmap.");
};
