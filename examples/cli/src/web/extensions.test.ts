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
    expect(widgets[0].meters[0]).toEqual({ label: "req/s", value: 6, max: 8 });
  });
});
