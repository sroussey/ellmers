/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export { getMissingFields, promptMissingInput, type PromptFieldDescriptor } from "./prompt";
export {
  applySchemaDefaults,
  deepMerge,
  readJsonInput,
  resolveConfig,
  resolveInput,
  validateInput,
  type ResolveInputOptions,
  type ValidationResult,
} from "./resolve-input";
export {
  generateConfigHelpText,
  generateSchemaHelpText,
  parseConfigFlags,
  parseDynamicFlags,
} from "./schema-flags";
