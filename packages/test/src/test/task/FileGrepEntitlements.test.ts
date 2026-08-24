/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createPolicyEnforcer,
  createProfilePolicy,
  ENTITLEMENT_ENFORCER,
  Entitlements,
  TaskEntitlementError,
  TaskGraph,
  TaskGraphRunner,
  TaskRegistry,
  type IEntitlementEnforcer,
} from "@workglow/task-graph";
import { FileGrepTask, registerSafeFetch, type SafeFetchFn } from "@workglow/tasks";
import { Container, ServiceRegistry, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

const METADATA_URL = "http://169.254.169.254/latest/meta-data/iam/security-credentials/";

describe("FileGrepTask entitlement enforcement", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  let prevSafeFetch: SafeFetchFn;
  let testDir: string;

  beforeAll(() => {
    // The enforcer is what is under test, not the network layer.
    prevSafeFetch = registerSafeFetch(() =>
      Promise.resolve(
        new Response("alpha\nbravo foo\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );
    TaskRegistry.registerTask(FileGrepTask);
  });

  afterAll(() => {
    registerSafeFetch(prevSafeFetch);
  });

  beforeEach(() => {
    testDir = join(tmpdir(), `filegrep-ent-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    // The task realpaths a local path before declaring or opening it, and on
    // macOS the temp dir is a symlink (/var/folders -> /private/var/folders).
    // Compare against the real path so the expectations match what the task sees.
    testDir = realpathSync(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  function makeRegistry(enforcer: IEntitlementEnforcer): ServiceRegistry {
    const registry = new ServiceRegistry(new Container());
    registry.register(ENTITLEMENT_ENFORCER, () => enforcer);
    return registry;
  }

  function makeGraph(url: string, roots?: readonly string[]): TaskGraph {
    const graph = new TaskGraph();
    graph.addTask(new FileGrepTask({ id: "grep-node", roots, defaults: { url, pattern: "foo" } }));
    return graph;
  }

  /**
   * The scenario that motivated the declaration. Pre-fix the task declared
   * nothing at all: `computeGraphEntitlements` runs over `graph.getTasks()` at
   * graph start and saw an empty set, and the `FetchUrlTask` the task owns
   * inside `execute()` is not in that snapshot — so it reached the metadata
   * endpoint with `allowPrivate: true`, its own resolved-destination check
   * satisfied because the child's input url IS the private one.
   */
  test("a profile without network:private denies a metadata-endpoint grep", async () => {
    const enforcer = createPolicyEnforcer(createProfilePolicy("browser"));
    const runner = new TaskGraphRunner(makeGraph(METADATA_URL));

    await expect(
      runner.runGraph({}, { registry: makeRegistry(enforcer), enforceEntitlements: true })
    ).rejects.toThrow(TaskEntitlementError);
  });

  test("the same profile allows a public grep", async () => {
    const enforcer = createPolicyEnforcer(createProfilePolicy("browser"));
    const runner = new TaskGraphRunner(makeGraph("https://example.com/log.txt"));

    await expect(
      runner.runGraph({}, { registry: makeRegistry(enforcer), enforceEntitlements: true })
    ).resolves.toBeDefined();
  });

  test("a profile granting filesystem:read only under /tmp denies /etc", async () => {
    const browserPolicy = createProfilePolicy("browser");
    const scopedPolicy = {
      deny: browserPolicy.deny,
      grant: [
        ...browserPolicy.grant,
        { id: Entitlements.FILESYSTEM_READ, resources: [`${testDir}/*`] },
      ],
      ask: browserPolicy.ask,
    };

    const allowed = join(testDir, "notes.txt");
    writeFileSync(allowed, "alpha\nbravo foo\n", "utf-8");

    const permitted = new TaskGraphRunner(makeGraph(allowed, [testDir]));
    await expect(
      permitted.runGraph(
        {},
        { registry: makeRegistry(createPolicyEnforcer(scopedPolicy)), enforceEntitlements: true }
      )
    ).resolves.toBeDefined();

    // Rooted at /etc so containment admits the path and the ENFORCER is what
    // refuses it — the policy is what this test is about.
    const denied = new TaskGraphRunner(makeGraph("/etc/passwd", ["/etc"]));
    await expect(
      denied.runGraph(
        {},
        { registry: makeRegistry(createPolicyEnforcer(scopedPolicy)), enforceEntitlements: true }
      )
    ).rejects.toThrow(TaskEntitlementError);
  });

  test("declares filesystem:read scoped to the resolved path, and no network", () => {
    const filePath = join(testDir, "notes.txt");
    writeFileSync(filePath, "bravo foo\n", "utf-8");

    const declared = new FileGrepTask({
      roots: [testDir],
      defaults: { url: filePath, pattern: "foo" },
    }).entitlements().entitlements;

    expect(declared.map((e) => e.id)).toEqual([Entitlements.FILESYSTEM_READ]);
    expect(declared[0].resources).toEqual([filePath]);
  });

  test("declares the fetch entitlements for an http url, and no filesystem:read", () => {
    const declared = new FileGrepTask({
      defaults: { url: "https://example.com/log.txt", pattern: "foo" },
    }).entitlements().entitlements;

    expect(declared.map((e) => e.id)).toContain(Entitlements.NETWORK_HTTP);
    expect(declared.map((e) => e.id)).not.toContain(Entitlements.FILESYSTEM_READ);
  });

  test("declares fail-closed entitlements when the url is unknown", () => {
    const declared = new FileGrepTask({ defaults: { pattern: "foo" } as never }).entitlements()
      .entitlements;
    const ids = declared.map((e) => e.id);

    expect(ids).toContain(Entitlements.FILESYSTEM_READ);
    expect(ids).toContain(Entitlements.NETWORK_PRIVATE);
    // Unscoped: nothing is known about the destination yet.
    expect(declared.find((e) => e.id === Entitlements.NETWORK_PRIVATE)?.resources).toBeUndefined();
    expect(declared.find((e) => e.id === Entitlements.FILESYSTEM_READ)?.resources).toBeUndefined();
  });
});
