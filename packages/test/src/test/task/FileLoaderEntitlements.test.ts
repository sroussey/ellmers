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
import { FileLoaderTask as FileLoaderServerTask } from "@workglow/tasks";
import { Container, ServiceRegistry, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
// `@workglow/tasks` resolves to the node build under vitest, whose
// `FileLoaderTask` is the server subclass. The cross-platform base — the class
// `browser.ts` registers, and the one this fix is about — is only reachable
// through its own module.
import { FileLoaderTask } from "../../../../tasks/src/task/FileLoaderTask";
// Registered on the SOURCE module for the same reason: the base class reaches
// the source `FetchUrlTask`, whose safeFetch slot is a different instance from
// the built package's.
import { registerSafeFetch, type SafeFetchFn } from "../../../../tasks/src/util/SafeFetch";

const METADATA_URL = "http://169.254.169.254/latest/meta-data/iam/security-credentials/";

describe("FileLoaderTask entitlement enforcement", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  let prevSafeFetch: SafeFetchFn;

  beforeAll(() => {
    // The enforcer is what is under test, not the network layer.
    prevSafeFetch = registerSafeFetch(() =>
      Promise.resolve(
        new Response('{"ok":true}', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    TaskRegistry.registerTask(FileLoaderTask);
  });

  afterAll(() => {
    registerSafeFetch(prevSafeFetch);
  });

  function makeRegistry(enforcer: IEntitlementEnforcer): ServiceRegistry {
    const registry = new ServiceRegistry(new Container());
    registry.register(ENTITLEMENT_ENFORCER, () => enforcer);
    return registry;
  }

  function makeGraph(url: string): TaskGraph {
    const graph = new TaskGraph();
    graph.addTask(new FileLoaderTask({ id: "loader-node", defaults: { url } }));
    return graph;
  }

  /**
   * The scenario that motivated the declaration. Pre-fix the cross-platform
   * class declared nothing at all: `computeGraphEntitlements` runs over
   * `graph.getTasks()` at graph start and saw an empty set, and the
   * `FetchUrlTask` the task owns inside `execute()` is not in that snapshot —
   * so it reached the metadata endpoint with `allowPrivate: true`, its own
   * resolved-destination check satisfied because the child's input url IS the
   * private one.
   */
  test("a profile without network:private denies a metadata-endpoint load", async () => {
    const enforcer = createPolicyEnforcer(createProfilePolicy("browser"));
    const runner = new TaskGraphRunner(makeGraph(METADATA_URL));

    await expect(
      runner.runGraph({}, { registry: makeRegistry(enforcer), enforceEntitlements: true })
    ).rejects.toThrow(TaskEntitlementError);
  });

  test("the same profile allows a public load", async () => {
    const enforcer = createPolicyEnforcer(createProfilePolicy("browser"));
    const runner = new TaskGraphRunner(makeGraph("https://example.com/data.json"));

    await expect(
      runner.runGraph({}, { registry: makeRegistry(enforcer), enforceEntitlements: true })
    ).resolves.toBeDefined();
  });

  test("declares the fetch entitlements for an http url", () => {
    const declared = new FileLoaderTask({
      defaults: { url: "https://example.com/data.json" },
    }).entitlements().entitlements;

    expect(declared.map((e) => e.id)).toContain(Entitlements.NETWORK_HTTP);
    // The cross-platform build reaches http(s) through `FetchUrlTask` and
    // touches no filesystem.
    expect(declared.map((e) => e.id)).not.toContain(Entitlements.FILESYSTEM_READ);
  });

  test("declares fail-closed network:private when the url is unknown", () => {
    const declared = new FileLoaderTask({ defaults: {} as never }).entitlements().entitlements;
    const ids = declared.map((e) => e.id);

    expect(ids).toContain(Entitlements.NETWORK_PRIVATE);
    // Unscoped: nothing is known about the destination yet.
    expect(declared.find((e) => e.id === Entitlements.NETWORK_PRIVATE)?.resources).toBeUndefined();
  });

  // The server build's static declaration now merges onto `super.entitlements()`
  // rather than restating `FetchUrlTask.entitlements()`, so pin that the switch
  // kept both halves.
  test("the server build still adds filesystem:read on top", () => {
    const ids = FileLoaderServerTask.entitlements().entitlements.map((e) => e.id);

    expect(ids).toContain(Entitlements.NETWORK_HTTP);
    expect(ids).toContain(Entitlements.FILESYSTEM_READ);
  });
});
