/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CactusCatalogEntry } from "./Cactus_ModelCatalog";

type NeedleSdkModule = typeof import("needle-rs");
export type { NeedleSdkModule };

export type NeedleEngine =
  | NonNullable<ReturnType<NeedleSdkModule["NeedleWasm"]["load"]>>
  | NonNullable<ReturnType<NeedleSdkModule["NeedleV2Wasm"]["load"]>>;

export function loadCactusEngine(
  sdk: NeedleSdkModule,
  entry: CactusCatalogEntry,
  files: Readonly<Record<string, Uint8Array>>
): NeedleEngine {
  if (entry.generation === 2) {
    const bytes = files[entry.assets.cact.filename];
    if (!bytes) {
      throw new Error(
        `Missing Cactus v2 asset ${entry.assets.cact.filename} for model ${entry.model_id}`
      );
    }
    const engine = sdk.NeedleV2Wasm.load(bytes);
    if (!engine) {
      throw new Error(`needle-rs NeedleV2Wasm.load returned undefined for model ${entry.model_id}`);
    }
    return engine;
  }

  const weightsBytes = files[entry.assets.weights.filename];
  const vocabBytes = files[entry.assets.vocab.filename];
  if (!weightsBytes || !vocabBytes) {
    throw new Error(`Missing Cactus v1 weights/vocab for model ${entry.model_id}`);
  }
  const vocabText = new TextDecoder().decode(vocabBytes);
  const engine = sdk.NeedleWasm.load(weightsBytes, vocabText);
  if (!engine) {
    throw new Error(`needle-rs NeedleWasm.load returned undefined for model ${entry.model_id}`);
  }
  return engine;
}
