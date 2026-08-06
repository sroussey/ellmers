/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServiceRegistry } from "@workglow/util";
import { createServiceToken, globalServiceRegistry } from "@workglow/util";
import type { ITransformDef } from "./TransformTypes";

const transformDefs = new Map<string, ITransformDef<any>>();

/** Register / unregister / inspect global transforms. */
export const TransformRegistry = {
  all: transformDefs,
  registerTransform(def: ITransformDef<any>): void {
    transformDefs.set(def.id, def);
  },
  unregisterTransform(id: string): void {
    transformDefs.delete(id);
  },
};

/** DI token — mirrors TASK_CONSTRUCTORS pattern. */
export const TRANSFORM_DEFS = createServiceToken<Map<string, ITransformDef<any>>>("transform.defs");

/**
 * Registers the transform defs map default factory on the given registry.
 * Called by `bootstrapWorkglow` and `createOrchestrationContext`.
 */
export function registerTransformDefaults(registry: ServiceRegistry = globalServiceRegistry): void {
  registry.registerIfAbsent(
    TRANSFORM_DEFS,
    (): Map<string, ITransformDef<any>> => TransformRegistry.all,
    true
  );
}

// Self-register on the global registry. Idempotent.
registerTransformDefaults();
