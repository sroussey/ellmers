/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type {
  AiProviderRunFn,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
} from "@workglow/ai";
import type { TypedArray } from "@workglow/util/worker";
import { getLogger } from "@workglow/util/worker";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, getPipelineCacheKey, withHftPipelineInUse } from "./HFT_Pipeline";

/**
 * Model download progress (first-call cold start) is forwarded as `phase`
 * stream events via the `emit` callback passed to {@link getPipeline}; subsequent
 * calls are near-instant because the pipeline is cached.
 */
export const HFT_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, signal, emit) => {
  const logger = getLogger();
  const uuid = crypto.randomUUID();
  const timerLabel = `hft:TextEmbedding:${model?.provider_config.model_path}:${uuid}`;
  logger.time(timerLabel, { model: model?.provider_config.model_path });

  await withHftPipelineInUse(getPipelineCacheKey(model!), async () => {
    const generateEmbedding = (await getPipeline(
      model!,
      emit,
      {},
      signal
    )) as FeatureExtractionPipeline;

    logger.debug("HFT TextEmbedding: pipeline ready, generating embedding", {
      model: model?.provider_config.model_path,
      inputLength: Array.isArray(input.text) ? input.text.length : input.text?.length,
    });

    // Generate the embedding
    const hfVector = await generateEmbedding(input.text, {
      pooling: model?.provider_config.pooling || "mean",
      normalize: model?.provider_config.normalize,
    });

    const isArrayInput = Array.isArray(input.text);
    const embeddingDim = model?.provider_config.native_dimensions;

    // If the input is an array, the tensor will have multiple dimensions (e.g., [10, 384])
    // We need to split it into separate vectors for each input text
    if (isArrayInput && hfVector.dims.length > 1) {
      const [numTexts, vectorDim] = hfVector.dims;

      // Validate that the number of texts matches
      if (numTexts !== input.text.length) {
        throw new Error(
          `HuggingFace Embedding tensor batch size does not match input array length: ${numTexts} != ${input.text.length}`
        );
      }

      // Validate dimensions
      if (vectorDim !== embeddingDim) {
        throw new Error(
          `HuggingFace Embedding vector dimension does not match model dimensions: ${vectorDim} != ${embeddingDim}`
        );
      }

      // Extract each embedding vector using tensor indexing
      // hfVector[i] returns a sub-tensor for the i-th text
      // .slice() is required to create independent TypedArrays with their own ArrayBuffers,
      // because sub-tensor views all share the same backing buffer, which causes DataCloneError
      // when postMessage tries to transfer the same ArrayBuffer multiple times.
      const vectors: TypedArray[] = Array.from({ length: numTexts }, (_, i) =>
        ((hfVector as any)[i].data as TypedArray).slice()
      );

      logger.timeEnd(timerLabel, { batchSize: numTexts, dimensions: vectorDim });
      emit({ type: "finish", data: { vector: vectors } });
      return;
    }

    // Output[number] text input - validate dimensions
    if (hfVector.size !== embeddingDim) {
      logger.timeEnd(timerLabel, { status: "error", reason: "dimension mismatch" });
      console.warn(
        `HuggingFace Embedding vector length does not match model dimensions v${hfVector.size} != m${embeddingDim}`,
        input,
        hfVector
      );
      throw new Error(
        `HuggingFace Embedding vector length does not match model dimensions v${hfVector.size} != m${embeddingDim}`
      );
    }

    logger.timeEnd(timerLabel, { dimensions: hfVector.size });
    emit({ type: "finish", data: { vector: hfVector.data as TypedArray } });
  });
};
