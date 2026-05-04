/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "./scripts/configure-hft-test-cache";
import "./scripts/lib/preload-credentials";

// Workglow no longer self-registers defaults at import time. Tests rely on
// the global registry being populated, so bootstrap once here. The helper
// lives inside @workglow/test where workspace package resolution succeeds.
import { bootstrapTestRegistry } from "./packages/test/src/binding/bootstrapTestRegistry";
bootstrapTestRegistry();
