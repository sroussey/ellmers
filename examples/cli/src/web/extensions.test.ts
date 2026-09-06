/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import type { WebInvocation } from "./argv";
import {
  getWebFieldWidget,
  listWebPanels,
  loadWebPanel,
  readWebStatusWidgets,
  registerWebFieldWidget,
  registerWebPanel,
  registerWebStatusReadCleanup,
  registerWebStatusWidget,
  resetWebExtensionsForTesting,
} from "./extensions";

const invocation: WebInvocation = { path: ["spac", "process"], args: ["2114227"], options: {} };
const other: WebInvocation = { path: ["model", "list"], args: [], options: {} };

afterEach(() => resetWebExtensionsForTesting());

describe("panels", () => {
  it("offers only the panels that apply to the run", () => {
    registerWebPanel({
      id: "extractions",
      title: "Extraction rows",
      source: "@workglow/sec",
      appliesTo: (candidate) => candidate.path[0] === "spac",
      load: async () => ({ kind: "table", columns: ["table"], rows: [["management"]] }),
    });
    registerWebPanel({
      id: "always",
      title: "Always",
      source: "test",
      appliesTo: () => true,
      load: async () => ({ kind: "markdown", text: "hi" }),
    });
    expect(listWebPanels(invocation).map((p) => p.id)).toEqual(["extractions", "always"]);
    expect(listWebPanels(other).map((p) => p.id)).toEqual(["always"]);
  });

  it("replaces a panel registered twice under one id", () => {
    const panel = {
      id: "p",
      title: "First",
      source: "test",
      appliesTo: () => true,
      load: async () => ({ kind: "markdown", text: "" }) as const,
    };
    registerWebPanel(panel);
    registerWebPanel({ ...panel, title: "Second" });
    expect(listWebPanels().map((p) => p.title)).toEqual(["Second"]);
  });

  it("reports a broken panel as a panel, not as a broken page", async () => {
    const panel = {
      id: "bad",
      title: "Bad",
      source: "test",
      appliesTo: () => true,
      load: async () => {
        throw new Error("relation does not exist");
      },
    };
    const data = await loadWebPanel(panel, { invocation, output: undefined });
    expect(data).toEqual({ kind: "error", message: "relation does not exist" });
  });

  it("does not let a panel that throws while deciding hide the others", () => {
    registerWebPanel({
      id: "throws",
      title: "Throws",
      source: "test",
      appliesTo: () => {
        throw new Error("nope");
      },
      load: async () => ({ kind: "markdown", text: "" }),
    });
    registerWebPanel({
      id: "fine",
      title: "Fine",
      source: "test",
      appliesTo: () => true,
      load: async () => ({ kind: "markdown", text: "" }),
    });
    expect(listWebPanels(invocation).map((p) => p.id)).toEqual(["fine"]);
  });
});

describe("field widgets", () => {
  it("is found by the schema format a field declares", () => {
    registerWebFieldWidget({
      format: "sec:cik",
      source: "@workglow/sec",
      search: async () => [
        { value: "2114227", label: "Churchill Capital Corp XII", detail: "SIC 6770" },
      ],
    });
    expect(getWebFieldWidget("sec:cik")?.source).toBe("@workglow/sec");
    expect(getWebFieldWidget("model")).toBeUndefined();
    expect(getWebFieldWidget(undefined)).toBeUndefined();
  });
});

describe("status widgets", () => {
  it("reads every widget and drops one that cannot answer", async () => {
    registerWebStatusWidget({
      id: "edgar",
      title: "EDGAR fetch budget",
      source: "@workglow/sec",
      read: async () => [{ label: "req/s", value: 6, max: 8 }],
    });
    registerWebStatusWidget({
      id: "broken",
      title: "Broken",
      source: "test",
      read: async () => {
        throw new Error("no connection");
      },
    });
    const widgets = await readWebStatusWidgets();
    expect(widgets.map((w) => w.id)).toEqual(["edgar"]);
    // A widget states a meter by leaving `kind` off, which is what every
    // widget written before text lines existed does.
    expect(widgets[0].items[0]).toEqual({ kind: "meter", label: "req/s", value: 6, max: 8 });
  });

  it("carries a text line through unchanged", async () => {
    registerWebStatusWidget({
      id: "db",
      title: "Database",
      source: "@workglow/sec",
      read: async () => [
        { kind: "text", label: "backend", value: "postgres", tone: "ok" },
        { label: "pending", value: 3, max: 10 },
      ],
    });
    const widgets = await readWebStatusWidgets();
    expect(widgets[0].items).toEqual([
      { kind: "text", label: "backend", value: "postgres", tone: "ok" },
      { kind: "meter", label: "pending", value: 3, max: 10 },
    ]);
  });

  it("runs cleanup after the read so stats connections do not linger", async () => {
    const order: string[] = [];
    registerWebStatusReadCleanup(async () => {
      order.push("cleanup");
    });
    registerWebStatusWidget({
      id: "db",
      title: "Database",
      source: "test",
      read: async () => {
        order.push("read");
        return [{ kind: "text", label: "backend", value: "postgres" }];
      },
    });
    await readWebStatusWidgets();
    expect(order).toEqual(["read", "cleanup"]);
  });

  it("runs cleanup after the read even when a widget cannot answer", async () => {
    let closed = 0;
    registerWebStatusReadCleanup(async () => {
      closed += 1;
    });
    registerWebStatusWidget({
      id: "broken",
      title: "Broken",
      source: "test",
      read: async () => {
        throw new Error("no connection");
      },
    });
    await readWebStatusWidgets();
    expect(closed).toBe(1);
  });

  // Two open browser tabs poll `/api/status-widgets` on their own intervals and
  // the server answers both at once. The cleanups tear down state the widgets
  // share, so a second read running under the first sees its connection closed
  // mid-query: its widgets throw, get dropped as unanswerable, and rows vanish
  // from that tab's rail with nothing logged anywhere.
  describe("concurrent reads", () => {
    function deferred(): { readonly promise: Promise<void>; resolve: () => void } {
      let resolve = (): void => {};
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    it("does not tear down a shared connection under an overlapping read", async () => {
      // The connection the widget needs, closed by the cleanup that follows
      // whichever read finishes first.
      const connection = { open: true };
      const overlapping = deferred();
      const firstFinished = deferred();
      let reads = 0;

      registerWebStatusReadCleanup(async () => {
        connection.open = false;
      });
      registerWebStatusWidget({
        id: "db",
        title: "Database",
        source: "test",
        read: async () => {
          // The first query waits for a second read to be under way; a second
          // query (which only happens without a shared pass) is still in flight
          // when the first read's cleanup lands.
          reads += 1;
          await (reads === 1 ? overlapping.promise : firstFinished.promise);
          if (!connection.open) throw new Error("connection closed");
          return [{ kind: "text" as const, label: "backend", value: "postgres" }];
        },
      });

      const first = readWebStatusWidgets();
      const second = readWebStatusWidgets();
      overlapping.resolve();
      const a = await first;
      firstFinished.resolve();
      const b = await second;

      expect(reads).toBe(1);
      expect(a.map((w) => w.id)).toEqual(["db"]);
      expect(b.map((w) => w.id)).toEqual(["db"]);
    });

    it("runs the cleanups once for a shared pass, and again for the next one", async () => {
      let closed = 0;
      registerWebStatusReadCleanup(async () => {
        closed += 1;
      });
      registerWebStatusWidget({
        id: "db",
        title: "Database",
        source: "test",
        read: async () => [{ kind: "text", label: "backend", value: "postgres" }],
      });

      await Promise.all([readWebStatusWidgets(), readWebStatusWidgets()]);
      expect(closed).toBe(1);

      // A read that starts after the pass settled is a pass of its own: the
      // cleanups have already run, so nothing is torn down underneath it.
      await readWebStatusWidgets();
      expect(closed).toBe(2);
    });
  });
});
