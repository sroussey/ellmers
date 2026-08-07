/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import {
  tabularTaskOutputStorage,
  TaskOutputPrimaryKeyNames,
  TaskOutputSchema,
  TaskOutputTabularRepository,
} from "@workglow/task-graph";

/**
 * In-memory task output repository. Provides storage and retrieval for task
 * outputs without touching a real backend.
 *
 * The base class is imported by PACKAGE SPECIFIER, not relatively. `./test` is
 * built as its own `bun build --packages=external` bundle, so
 * `import { TaskOutputTabularRepository } from "../storage/..."` would inline a
 * second copy of the base class into this bundle — instances would then fail
 * `instanceof TaskOutputTabularRepository` against the class everything else
 * uses. A bare specifier stays external and shares the one hierarchy.
 *
 * The subclass itself is unique to this bundle, which is fine: nothing in the
 * main bundle references it, so there is no second copy to diverge from.
 */
export class InMemoryTaskOutputRepository extends TaskOutputTabularRepository {
  constructor() {
    super({
      storage: tabularTaskOutputStorage(
        new InMemoryTabularStorage(TaskOutputSchema, TaskOutputPrimaryKeyNames, ["createdAt"])
      ),
    });
  }
}
