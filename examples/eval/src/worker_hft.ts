/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  registerHuggingFaceTransformersWorker,
  setHftCacheDir,
} from "@workglow/huggingface-transformers/ai-runtime";

if (process.env.WORKGLOW_MODEL_CACHE) {
  setHftCacheDir(process.env.WORKGLOW_MODEL_CACHE);
}

registerHuggingFaceTransformersWorker();
