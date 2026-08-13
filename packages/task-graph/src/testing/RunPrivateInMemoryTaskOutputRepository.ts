/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import {
  RunPrivateTaskOutputPrimaryKeyNames,
  RunPrivateTaskOutputRepository,
  RunPrivateTaskOutputSchema,
} from "@workglow/task-graph";

/**
 * In-memory backing for the run-private output cache. A dedicated table whose
 * runId-leading primary key makes run-scoped cleanup an indexed delete. The
 * `createdAt` index serves the janitor's age sweep.
 */
export class RunPrivateInMemoryTaskOutputRepository extends RunPrivateTaskOutputRepository {
  constructor() {
    super({
      storage: new InMemoryTabularStorage(
        RunPrivateTaskOutputSchema,
        RunPrivateTaskOutputPrimaryKeyNames,
        ["createdAt"]
      ),
    });
  }
}
