/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ESLint } from "eslint";
import { readdirSync } from "node:fs";
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

/**
 * A run-fn that actually exists, DISCOVERED from disk rather than written down.
 *
 * The synthetic path above only has to MATCH the config globs, which is exactly
 * how this guard came to be dead: it matched a glob whose rule a later config
 * object had turned off. Linting a real file makes the fixture follow the
 * repo's layout instead of restating a belief about it.
 */
const REAL_RUN_FN = findRealRunFn();

function findRealRunFn(): string | undefined {
  for (const provider of readdirSync(`${ROOT}/providers`).sort()) {
    const dir = `providers/${provider}/src/ai/common`;
    let entries: string[];
    try {
      entries = readdirSync(`${ROOT}/${dir}`).sort();
    } catch {
      continue;
    }
    const runFn = entries.find((name) => name.endsWith("_JobRunFns.ts"));
    if (runFn) return `${dir}/${runFn}`;
  }
  return undefined;
}

async function messagesForRule(code: string, filePath: string, ruleId: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: `${ROOT}/${filePath}` });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === ruleId)
    .map((message) => message.message);
}

async function restrictedImportMessages(code: string, filePath: string): Promise<string[]> {
  return messagesForRule(code, filePath, "no-restricted-imports");
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

  it("still allows registerAllDefaults from @workglow/bootstrap", async () => {
    // The bootstrap entries are name-scoped, not wholesale: only
    // `bootstrapWorkglow` reaches the global registry. Re-broadening them fails
    // here rather than silently banning the legitimate calls.
    const messages = await restrictedImportMessages(
      `import { registerAllDefaults } from "@workglow/bootstrap";\nvoid registerAllDefaults;\n`,
      RUN_FN_PATH
    );
    expect(messages).toEqual([]);
  });

  it("blocks bootstrapWorkglow from the workglow root barrel", async () => {
    // `packages/workglow/src/common.ts` re-exports `./bootstrap`, so the banned
    // import is one specifier away through the meta-package's root entry.
    const messages = await restrictedImportMessages(
      `import { bootstrapWorkglow } from "workglow";\nbootstrapWorkglow();\n`,
      RUN_FN_PATH
    );
    expect(messages).toHaveLength(1);
  });

  it("blocks globalServiceRegistry from the workglow root barrel", async () => {
    // The same barrel re-exports `@workglow/util`, so the pre-existing
    // main-thread-state surface is reachable there too.
    const messages = await restrictedImportMessages(
      `import { globalServiceRegistry } from "workglow";\nvoid globalServiceRegistry;\n`,
      RUN_FN_PATH
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Main-thread-only state");
  });

  it("leaves an unrelated workglow import alone", async () => {
    const messages = await restrictedImportMessages(
      `import { Workflow } from "workglow";\nvoid Workflow;\n`,
      RUN_FN_PATH
    );
    expect(messages).toEqual([]);
  });
});

describe("run-fn and provider restrictions coexist", () => {
  it("finds at least one real run-fn to lint", () => {
    expect(REAL_RUN_FN).toBeDefined();
  });

  it("blocks @workglow/bootstrap from a REAL run-fn file", async () => {
    // The case the synthetic path could not catch. Every run-fn on disk lives
    // under `providers/*/src/ai/common/`, whose config object turns the base
    // rule off — so this only passes while the run-fn block stays last.
    const messages = await restrictedImportMessages(
      `import { bootstrapWorkglow } from "@workglow/bootstrap";\nbootstrapWorkglow();\n`,
      REAL_RUN_FN!
    );
    expect(messages).toHaveLength(1);
  });

  it("the effort-helper restriction still fires in the same file", async () => {
    // The ordering guard. It proves the reorder did not clobber the provider
    // block, AND that the run-fn path genuinely sits inside that block's zone —
    // so the case above cannot be passing because the globs stopped overlapping.
    const messages = await messagesForRule(
      `import { MODEL_EFFORTS } from "@workglow/ai";\nvoid MODEL_EFFORTS;\n`,
      RUN_FN_PATH,
      "@typescript-eslint/no-restricted-imports"
    );
    expect(messages).toHaveLength(1);
  });

  it("neither rule reports the same import twice", async () => {
    // The two rules restrict disjoint specifiers, which is what makes it safe
    // to have both active on the same file.
    const code = `import { bootstrapWorkglow } from "@workglow/bootstrap";\nbootstrapWorkglow();\n`;
    const extensionMessages = await messagesForRule(
      code,
      RUN_FN_PATH,
      "@typescript-eslint/no-restricted-imports"
    );
    const baseMessages = await restrictedImportMessages(code, RUN_FN_PATH);
    expect(extensionMessages).toEqual([]);
    expect(baseMessages).toHaveLength(1);
  });
});
