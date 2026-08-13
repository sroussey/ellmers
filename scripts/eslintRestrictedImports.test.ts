/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ROOT } from "./lib/testDiscovery";

/**
 * The `**\/*_JobRunFns.ts` guard is a lint rule, so nothing exercises it: a
 * config edit that narrows or breaks it produces no failure anywhere, and the
 * next run-fn to import main-thread state lands clean.
 *
 * `lintText` with a synthetic `filePath` is what makes this cheap. No file is
 * written — the path only has to MATCH the config's `files` glob — and the
 * config uses a plain parser with no type-aware project service, so each lint
 * is milliseconds rather than a program build.
 */

/** A path under `providers/*` matching the run-fn glob, with no file on disk. */
const RUN_FN_PATH = "providers/openai/src/ai/common/Fixture_JobRunFns.ts";
/** The same directory, so only the `_JobRunFns` suffix differs. */
const ORDINARY_PATH = "providers/openai/src/ai/common/Fixture.ts";

async function restrictedImportMessages(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}/${filePath}` });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

describe("run-fn restricted imports", () => {
  it("blocks @workglow/bootstrap from a run-fn", async () => {
    const messages = await restrictedImportMessages(
      `import { bootstrapWorkglow } from "@workglow/bootstrap";\nbootstrapWorkglow();\n`,
      RUN_FN_PATH
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("globalServiceRegistry");
    expect(messages[0]).toContain("serialized job input");
  });

  it("blocks the workglow/bootstrap subpath too", async () => {
    // The meta-package republishes the same surface, so blocking only the
    // scoped name leaves the identical import one specifier away.
    const messages = await restrictedImportMessages(
      `import { bootstrapWorkglow } from "workglow/bootstrap";\nbootstrapWorkglow();\n`,
      RUN_FN_PATH
    );
    expect(messages).toHaveLength(1);
  });

  it("leaves the same import alone outside a run-fn", async () => {
    // The rule is scoped to the worker boundary, not to the package: a task
    // class on the main thread is exactly where bootstrapping belongs.
    const messages = await restrictedImportMessages(
      `import { bootstrapWorkglow } from "@workglow/bootstrap";\nbootstrapWorkglow();\n`,
      ORDINARY_PATH
    );
    expect(messages).toEqual([]);
  });

  it("still blocks globalServiceRegistry from @workglow/util", async () => {
    const messages = await restrictedImportMessages(
      `import { globalServiceRegistry } from "@workglow/util";\nvoid globalServiceRegistry;\n`,
      RUN_FN_PATH
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Main-thread-only state");
  });

  it("leaves an unrelated @workglow/util import alone", async () => {
    // Proves the util entry is still name-scoped rather than wholesale, which
    // is the difference between the two kinds of entry in the config.
    const messages = await restrictedImportMessages(
      `import { uuid4 } from "@workglow/util";\nvoid uuid4;\n`,
      RUN_FN_PATH
    );
    expect(messages).toEqual([]);
  });
});
