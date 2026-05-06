/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresMigrationRunner } from "@workglow/postgres/storage";
import type { Pool } from "@workglow/postgres/storage";
import { setLogger } from "@workglow/util";
import { afterAll, describe } from "vitest";

import { runMigrationRunnerContract } from "../../contract/storage-migrations/runMigrationRunnerContract";
import type { BuildMigrationFn } from "../../contract/storage-migrations/runMigrationRunnerContract";
import { getTestingLogger } from "../../binding/TestingLogger";

const db = new PGlite() as unknown as Pool;

const buildMigration: BuildMigrationFn<Pool> = (component, version, recorder, options) => ({
  component,
  version,
  description: `pg migration v${version}`,
  up: async () => {
    if (options?.fail) throw new Error(`pg migration v${version} failed (synthetic)`);
    recorder.record(component, version);
  },
});

describe("PostgresMigrationRunner", () => {
  setLogger(getTestingLogger());

  afterAll(async () => {
    await (db as unknown as PGlite).close();
  });

  runMigrationRunnerContract<Pool>({
    name: "Postgres",
    timeout: 30_000,
    factory: async () => ({
      createRunner: async () => new PostgresMigrationRunner(db),
      buildMigration,
      dispose: async () => {},
    }),
  });
});
