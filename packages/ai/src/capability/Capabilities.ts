/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Closed vocabulary of all recognized AI capability identifiers.
 * Use `Capability` (the derived key type) to constrain function parameters and
 * model registration so that unknown strings are rejected at compile time.
 */
export const CAPABILITIES = {
  // Text
  "text.generation": "Free-form text completion / chat",
  "text.embedding": "Text → vector",
  "text.classification": "Single-label / multi-label text classification",
  "text.translation": "Source → target language",
  "text.summary": "Long → short text",
  "text.rewriter": "Style / tone rewrite",
  "text.question-answering": "Extractive / abstractive QA",
  "text.fill-mask": "Masked language modeling",
  "text.ner": "Named entity recognition",
  "text.language-detection": "Detect input language",
  "text.reranking": "Score query/document pairs",
  // Image
  "image.generation": "Text → image",
  "image.editing": "Image + prompt → image",
  "image.classification": "Image → label(s)",
  "image.embedding": "Image → vector",
  "image.segmentation": "Image → mask(s)",
  "image.object-detection": "Image → bounding boxes + labels",
  "image.background-removal": "Image → foreground mask",
  "image.to-text": "Image → caption",
  // Vision (specialized)
  "vision.face-detection": "Faces in an image",
  "vision.face-landmarks": "Facial keypoints",
  "vision.hand-landmarks": "Hand keypoints",
  "vision.pose-landmarks": "Body pose keypoints",
  "vision.gesture": "Hand gesture recognition",
  // Modifiers (combine with a base capability)
  "tool-use": "Function/tool calling on text generation",
  "json-mode": "Structured-output JSON conformance",
  "vision-input": "Accepts image inputs alongside text",
  // Meta-ops on the provider/model itself
  "provider.model-search": "Search this provider's catalog",
  "provider.model-info": "Fetch metadata about a specific model",
  "model.count-tokens": "Tokenize input for cost / context calculation",
} as const;

export type Capability = keyof typeof CAPABILITIES;
