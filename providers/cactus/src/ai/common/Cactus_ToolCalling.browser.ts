/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getOrLoadEngine } from "./Cactus_Runtime.browser";
import { createCactusToolCalling } from "./Cactus_ToolCallingCore";

export const Cactus_ToolCalling = createCactusToolCalling(getOrLoadEngine);
