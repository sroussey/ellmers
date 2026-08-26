/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BrowserNavigateTask,
  BrowserSessionRegistry,
  BrowserSessionTask,
  BrowserSnapshotTask,
} from "@workglow/browser-control/task";
import { Dataflow, TaskGraph } from "@workglow/task-graph";
import { registerCommonTasks } from "@workglow/tasks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { registerCliBrowserDeps } from "../browser";
import type { CliConfig } from "../config";
import { isChromeAvailable } from "./chromeAvailability";

const chromeAvailable = Boolean((globalThis as any).Bun?.WebView) && isChromeAvailable();

// ---------------------------------------------------------------------------
// Test page
// ---------------------------------------------------------------------------

const TEST_PAGE_HTML =
  '<!DOCTYPE html><html><head><title>CLI Test</title></head><body><h1>Test</h1><form><label for="email">Email</label><input id="email" type="text"><button type="button">Submit</button></form></body></html>';
const TEST_PAGE_URL = `data:text/html,${encodeURIComponent(TEST_PAGE_HTML)}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!chromeAvailable)("Browser workflow end-to-end", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "workglow-cli-browser-test-"));

    const config: CliConfig = {
      directories: {
        models: join(tmpDir, "models"),
        workflows: join(tmpDir, "workflows"),
        agents: join(tmpDir, "agents"),
        mcps: join(tmpDir, "mcps"),
        cache: join(tmpDir, "cache"),
      },
      browser: {
        backend: "bun-webview",
        headless: true,
      },
    };

    registerCommonTasks({ fileSystemTasks: true });
    await registerCliBrowserDeps(config);
  }, 30_000);

  afterEach(async () => {
    await BrowserSessionRegistry.disconnectAll();
    await rm(tmpDir, { recursive: true, force: true });
  }, 30_000);

  test("BrowserSession -> BrowserNavigate -> BrowserSnapshot pipeline", async () => {
    // Build the task graph
    const graph = new TaskGraph();

    const session = new BrowserSessionTask({ id: "session" });
    const navigate = new BrowserNavigateTask({
      id: "navigate",
      defaults: { url: TEST_PAGE_URL },
    });
    const snapshot = new BrowserSnapshotTask({ id: "snapshot" });

    graph.addTask(session);
    graph.addTask(navigate);
    graph.addTask(snapshot);

    // Wire dataflows: session.sessionId -> navigate.sessionId
    graph.addDataflow(new Dataflow("session", "sessionId", "navigate", "sessionId"));
    // Wire dataflows: navigate.sessionId -> snapshot.sessionId
    graph.addDataflow(new Dataflow("navigate", "sessionId", "snapshot", "sessionId"));

    // Run the graph
    const results = await graph.run();

    // Find the snapshot result
    const snapshotResult = results.find((r) => r.id === "snapshot");
    expect(snapshotResult).toBeDefined();

    const data = snapshotResult!.data as { sessionId: string; tree: { yaml: string } };

    // Assert sessionId is a string
    expect(typeof data.sessionId).toBe("string");
    expect(data.sessionId.length).toBeGreaterThan(0);

    // Assert the accessibility tree yaml contains expected elements
    expect(data.tree).toBeDefined();
    expect(typeof data.tree.yaml).toBe("string");
    expect(data.tree.yaml.toLowerCase()).toContain("heading");
    expect(data.tree.yaml.toLowerCase()).toContain("button");
  }, 60_000);
});
