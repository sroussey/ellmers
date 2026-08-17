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
  TaskInvalidInputError,
  TaskRegistry,
  type IEntitlementEnforcer,
} from "@workglow/task-graph";
import { FileSedTask, registerSafeFetch, type SafeFetchFn } from "@workglow/tasks";
import { Container, ServiceRegistry, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

const METADATA_URL = "http://169.254.169.254/latest/meta-data/iam/security-credentials/";

describe("FileSedTask entitlement enforcement", () => {
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
    TaskRegistry.registerTask(FileSedTask);
  });

  afterAll(() => {
    registerSafeFetch(prevSafeFetch);
  });

  beforeEach(() => {
    testDir = join(tmpdir(), `filesed-ent-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
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
    graph.addTask(
      new FileSedTask({
        id: "sed-node",
        roots,
        defaults: { url, pattern: "foo", replacement: "bar" },
      })
    );
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
  test("a profile without network:private denies a metadata-endpoint substitution", async () => {
    const enforcer = createPolicyEnforcer(createProfilePolicy("browser"));
    const runner = new TaskGraphRunner(makeGraph(METADATA_URL));

    await expect(
      runner.runGraph({}, { registry: makeRegistry(enforcer), enforceEntitlements: true })
    ).rejects.toThrow(TaskEntitlementError);
  });

  test("the same profile allows a public substitution", async () => {
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

    const permitted = new TaskGraphRunner(makeGraph(allowed));
    await expect(
      permitted.runGraph(
        {},
        { registry: makeRegistry(createPolicyEnforcer(scopedPolicy)), enforceEntitlements: true }
      )
    ).resolves.toBeDefined();

    const denied = new TaskGraphRunner(makeGraph("/etc/passwd"));
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

    const declared = new FileSedTask({
      defaults: { url: filePath, pattern: "foo", replacement: "bar" },
    }).entitlements().entitlements;

    expect(declared.map((e) => e.id)).toEqual([Entitlements.FILESYSTEM_READ]);
    expect(declared[0].resources).toEqual([filePath]);
  });

  test("declares the fetch entitlements for an http url, and no filesystem:read", () => {
    const declared = new FileSedTask({
      defaults: { url: "https://example.com/log.txt", pattern: "foo", replacement: "bar" },
    }).entitlements().entitlements;

    expect(declared.map((e) => e.id)).toContain(Entitlements.NETWORK_HTTP);
    expect(declared.map((e) => e.id)).not.toContain(Entitlements.FILESYSTEM_READ);
  });

  test("declares fail-closed entitlements when the url is unknown", () => {
    const declared = new FileSedTask({
      defaults: { pattern: "foo", replacement: "bar" } as never,
    }).entitlements().entitlements;
    const ids = declared.map((e) => e.id);

    expect(ids).toContain(Entitlements.FILESYSTEM_READ);
    expect(ids).toContain(Entitlements.NETWORK_PRIVATE);
    // Unscoped: nothing is known about the destination yet.
    expect(declared.find((e) => e.id === Entitlements.NETWORK_PRIVATE)?.resources).toBeUndefined();
    expect(declared.find((e) => e.id === Entitlements.FILESYSTEM_READ)?.resources).toBeUndefined();
  });

  /**
   * The declaration must name the path that will actually be OPENED, not the
   * url as written: a policy scoped to a directory is worthless if a symlink
   * inside it can be declared under its own name and then followed elsewhere.
   */
  test("declares the resolved real path, not the url as given", () => {
    const target = join(testDir, "target.txt");
    const link = join(testDir, "link.txt");
    writeFileSync(target, "bravo foo\n", "utf-8");
    symlinkSync(target, link);

    const declared = new FileSedTask({
      defaults: { url: `file://${link}`, pattern: "foo", replacement: "bar" },
    }).entitlements().entitlements;

    expect(declared[0].resources).toEqual([target]);
  });

  /**
   * A misconfigured root (or one cleaned up mid-run) must not escape as a raw
   * `ENOENT ... lstat` from deep inside the resolver. It names the root, and
   * the read is refused either way — the declaration degrades to an UNSCOPED
   * `filesystem:read`, which `execute()` never reaches because resolution
   * throws there too.
   */
  test("names a configured root that does not exist, and still fails closed", async () => {
    const missingRoot = join(testDir, "nope");
    const filePath = join(testDir, "notes.txt");
    writeFileSync(filePath, "bravo foo\n", "utf-8");

    const task = new FileSedTask({
      roots: [missingRoot],
      defaults: { url: filePath, pattern: "foo", replacement: "bar" },
    });

    const declared = task.entitlements().entitlements;
    expect(declared.find((e) => e.id === Entitlements.FILESYSTEM_READ)?.resources).toBeUndefined();

    await expect(task.run()).rejects.toThrow(TaskInvalidInputError);
    await expect(task.run()).rejects.toThrow(missingRoot);
  });
});
