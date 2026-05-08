/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setHftCacheDir } from "../providers/huggingface-transformers/src/ai/runtime";

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** Repo-root `./models` for Hugging Face Transformers.js downloads during tests */
setHftCacheDir(join(scriptDir, "..", "models"));
