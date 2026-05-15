/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TransformRegistry } from "../TransformRegistry";
import { coalesceTransform } from "./coalesce";
import { isoDateToUnixTransform, unixToIsoDateTransform } from "./date-conversions";
import { indexTransform } from "./index-access";
import { pickTransform } from "./pick";
import {
  numberToStringTransform,
  parseJsonTransform,
  stringifyTransform,
  toBooleanTransform,
} from "./scalar-conversions";
import {
  lowercaseTransform,
  substringTransform,
  truncateTransform,
  uppercaseTransform,
} from "./string-casts";

export {
  coalesceTransform,
  indexTransform,
  isoDateToUnixTransform,
  lowercaseTransform,
  numberToStringTransform,
  parseJsonTransform,
  pickTransform,
  stringifyTransform,
  substringTransform,
  toBooleanTransform,
  truncateTransform,
  unixToIsoDateTransform,
  uppercaseTransform,
};

/**
 * Registers all MVP built-in transforms. Separate from registerBaseTasks so
 * consumers can opt in independently (tests may want transforms without
 * task registration and vice versa).
 */
export function registerBuiltInTransforms(): void {
  const all = [
    pickTransform,
    indexTransform,
    coalesceTransform,
    uppercaseTransform,
    lowercaseTransform,
    truncateTransform,
    substringTransform,
    unixToIsoDateTransform,
    isoDateToUnixTransform,
    numberToStringTransform,
    toBooleanTransform,
    stringifyTransform,
    parseJsonTransform,
  ];
  for (const t of all) TransformRegistry.registerTransform(t);
}
