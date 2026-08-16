/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BackgroundRemovalPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
} from "@workglow/ai";
import {
  blobToImageValue,
  imageValueToBlob,
  pngBytesToImageValue,
} from "@workglow/ai/provider-utils";
import type { ImageValue } from "@workglow/util/media";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, getPipelineCacheKey, withHftPipelineInUse } from "./HFT_Pipeline";

/**
 * The subset of `RawImage` this module uses. Declared structurally rather than
 * as `RawImage` so encoding stays independent of which methods a given
 * transformers.js version happens to ship. Both members are optional for that
 * reason; a real `RawImage` carries both.
 */
export interface EncodableRawImage {
  toBlob?: (type?: string, quality?: number) => Promise<Blob>;
  toSharp?: () => { png: () => { toBuffer: () => Promise<Uint8Array> } };
}

/**
 * Mirrors transformers.js `apis.IS_WEB_ENV` closely enough to order the encoder
 * attempts; correctness does not depend on it being exact, because a wrong
 * guess is recovered from. `OffscreenCanvas` is the half that matters in a
 * browser Web Worker, which has no `document`.
 *
 * Evaluated per call rather than once at module load so a test (and a runtime
 * that installs a canvas polyfill late) can flip it.
 */
function isWebEncodingEnv(): boolean {
  return typeof document !== "undefined" || typeof OffscreenCanvas !== "undefined";
}

/**
 * Encode a pipeline's `RawImage` result as an {@link ImageValue}, preserving
 * the alpha channel background removal produces.
 *
 * `RawImage` exposes different encoders per runtime: `toBlob()` goes through a
 * canvas and is browser-only, `toSharp()` is node-only. Both exist as prototype
 * methods in every runtime and each THROWS when called outside its own, so
 * probing for method existence answers nothing — this run-fn is registered for
 * both the inline and worker runtimes, so the environment picks the order and
 * the try/catch guarantees the result.
 */
export async function rawImageToImageValue(image: EncodableRawImage): Promise<ImageValue> {
  const encoders = isWebEncodingEnv()
    ? ([toImageValueViaBlob, toImageValueViaSharp] as const)
    : ([toImageValueViaSharp, toImageValueViaBlob] as const);

  const failures: Error[] = [];
  for (const encode of encoders) {
    const result = await encode(image, failures);
    if (result !== undefined) return result;
  }

  if (failures.length === 0) {
    throw new Error(
      "HFT_BackgroundRemoval: RawImage exposes neither toBlob() nor toSharp() in this transformers version"
    );
  }

  throw new Error(
    `HFT_BackgroundRemoval: could not encode the result image. ${failures
      .map((failure) => failure.message)
      .join(" / ")}`,
    { cause: failures[0] }
  );
}

async function toImageValueViaBlob(
  image: EncodableRawImage,
  failures: Error[]
): Promise<ImageValue | undefined> {
  if (typeof image.toBlob !== "function") return undefined;
  try {
    return blobToImageValue(await image.toBlob("image/png"));
  } catch (error) {
    failures.push(asError("toBlob()", error));
    return undefined;
  }
}

async function toImageValueViaSharp(
  image: EncodableRawImage,
  failures: Error[]
): Promise<ImageValue | undefined> {
  if (typeof image.toSharp !== "function") return undefined;
  try {
    return pngBytesToImageValue(await image.toSharp().png().toBuffer(), "png");
  } catch (error) {
    failures.push(asError("toSharp()", error));
    return undefined;
  }
}

function asError(encoder: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(`${encoder} failed: ${message}`, { cause: error });
  return wrapped;
}

export const HFT_BackgroundRemoval: AiProviderRunFn<
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const remover = (await getPipeline(model!, emit, {}, signal)) as BackgroundRemovalPipeline;
    const imageArg = await imageValueToBlob(input.image as unknown as ImageValue);
    const result = await remover(imageArg);

    const resultImage = Array.isArray(result) ? result[0] : result;

    emit({
      type: "finish",
      data: {
        image: await rawImageToImageValue(resultImage),
      },
    });
  });
};
