/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { timingSafeEqual } from "node:crypto";
import { validateInvocation, type WebInvocation } from "./argv";
import { resolveCommandFields } from "./commandFields";
import { buildCommandTree, findCommandNode } from "./commandTree";
import { getWebFieldWidget, listWebPanels, loadWebPanel, readWebStatusWidgets } from "./extensions";
import type { RunRegistry } from "./RunRegistry";
import { contentTypeFor, resolveWebAsset, webAssetExists } from "./staticFiles";

export interface WebRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export type WebResult =
  | {
      readonly kind: "json";
      readonly status: number;
      readonly body: unknown;
    }
  | { readonly kind: "file"; readonly path: string; readonly contentType: string }
  | { readonly kind: "sse"; readonly runId: string; readonly afterSeq: number };

export interface WebContext {
  readonly program: Command;
  readonly registry: RunRegistry;
  readonly token: string;
  readonly binaryName: string;
  /** Host values the server will answer to, lower-cased, without the port. */
  readonly allowedHosts: ReadonlySet<string>;
}

const json = (status: number, body: unknown): WebResult => ({ kind: "json", status, body });

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The three defenses this server has, in the order they must run.
 *
 * The token stops another page on this machine driving the console (a run
 * spends model and API quota, so a cross-site POST is not a theoretical harm),
 * and the Host check stops DNS rebinding turning a remote page into a local
 * one. Neither is authentication: this server is for the person sitting at it.
 */
function guard(request: WebRequest, ctx: WebContext): WebResult | undefined {
  const host = (request.headers["host"] ?? "").split(":")[0].toLowerCase();
  if (host && !ctx.allowedHosts.has(host)) {
    return json(403, { error: `refusing requests for host "${host}"` });
  }
  const provided = request.headers["x-workglow-token"] ?? request.query.get("t") ?? "";
  if (!provided || !constantTimeEquals(provided, ctx.token)) {
    return json(401, { error: "missing or invalid session token" });
  }
  return undefined;
}

function parseInvocation(body: string): WebInvocation | undefined {
  try {
    const parsed = JSON.parse(body) as Partial<WebInvocation>;
    if (!Array.isArray(parsed.path) || parsed.path.length === 0) return undefined;
    return {
      path: parsed.path.map(String),
      args: Array.isArray(parsed.args) ? parsed.args.map(String) : [],
      options: (parsed.options ?? {}) as Record<string, string | boolean>,
    };
  } catch {
    return undefined;
  }
}

function runSummary(run: ReturnType<RunRegistry["get"]>): unknown {
  if (!run) return undefined;
  return {
    id: run.id,
    cli: run.cli,
    invocation: run.invocation,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    state: run.state,
    exitCode: run.exitCode,
  };
}

export async function handleWebRequest(request: WebRequest, ctx: WebContext): Promise<WebResult> {
  const isApi = request.path.startsWith("/api/");
  const denied = guard(request, ctx);
  // A page load carries the token in the query; assets it then requests carry
  // none, so only the API is gated. Nothing under the asset root is secret.
  if (denied && isApi) return denied;

  if (request.path === "/api/commands") {
    return json(200, { commands: buildCommandTree(ctx.program), binaryName: ctx.binaryName });
  }

  if (request.path === "/api/fields") {
    const path = (request.query.get("path") ?? "").split(".").filter(Boolean);
    const args = request.query.getAll("arg");
    const node = findCommandNode(buildCommandTree(ctx.program), path);
    if (!node) return json(404, { error: "unknown command" });
    const fields = await resolveCommandFields(node, args);
    return json(200, {
      fields: fields.map((field) => ({
        ...field,
        widget: getWebFieldWidget(field.format) ? "search" : undefined,
      })),
    });
  }

  if (request.path === "/api/widget-search") {
    const widget = getWebFieldWidget(request.query.get("format") ?? undefined);
    if (!widget) return json(404, { error: "no widget for that format" });
    try {
      return json(200, { items: await widget.search(request.query.get("q") ?? "") });
    } catch (error) {
      return json(200, {
        items: [],
        error: error instanceof Error ? error.message : "search failed",
      });
    }
  }

  if (request.path === "/api/status-widgets") {
    return json(200, { widgets: await readWebStatusWidgets() });
  }

  if (request.path === "/api/runs" && request.method === "GET") {
    return json(200, { runs: ctx.registry.list().map(runSummary) });
  }

  if (request.path === "/api/runs" && request.method === "POST") {
    const invocation = parseInvocation(request.body);
    if (!invocation) return json(400, { error: "malformed invocation" });
    const node = findCommandNode(buildCommandTree(ctx.program), invocation.path);
    if (!node) return json(404, { error: "unknown command" });
    const errors = validateInvocation(node, invocation);
    if (errors.length > 0) return json(400, { errors });
    const run = ctx.registry.start(invocation);
    return json(201, runSummary(run));
  }

  const runMatch = /^\/api\/runs\/([^/]+)(\/[a-z-]+)?$/.exec(request.path);
  if (runMatch) {
    const [, id, action] = runMatch;
    const run = ctx.registry.get(id);
    if (!run) return json(404, { error: "unknown run" });
    if (!action) {
      return json(200, {
        ...(runSummary(run) as Record<string, unknown>),
        events: run.events,
      });
    }
    if (action === "/events") {
      const header = request.headers["last-event-id"];
      const afterSeq = Number.parseInt(header ?? request.query.get("after") ?? "0", 10);
      return { kind: "sse", runId: id, afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0 };
    }
    if (action === "/abort" && request.method === "POST") {
      return json(200, { aborted: ctx.registry.abort(id) });
    }
    if (action === "/human" && request.method === "POST") {
      let payload: unknown;
      try {
        payload = JSON.parse(request.body);
      } catch {
        return json(400, { error: "malformed answer" });
      }
      return json(200, { delivered: ctx.registry.answerHuman(id, payload) });
    }
    if (action === "/panels") {
      const panels = listWebPanels(run.invocation);
      const output = run.events.flatMap((record) =>
        record.event.k === "run_end" ? [record.event.output] : []
      );
      const loaded = await Promise.all(
        panels.map(async (panel) => ({
          id: panel.id,
          title: panel.title,
          source: panel.source,
          data: await loadWebPanel(panel, { invocation: run.invocation, output: output.at(-1) }),
        }))
      );
      return json(200, { panels: loaded });
    }
    return json(404, { error: "unknown run action" });
  }

  if (isApi) return json(404, { error: "unknown endpoint" });

  const asset = resolveWebAsset(request.path);
  if (asset && webAssetExists(asset)) {
    return { kind: "file", path: asset, contentType: contentTypeFor(asset) };
  }
  const index = resolveWebAsset("/");
  if (index && webAssetExists(index)) {
    return { kind: "file", path: index, contentType: contentTypeFor(index) };
  }
  return json(
    404,
    "the web client is not built — run `bun run build-web` in examples/cli, or `bun run build-example`"
  );
}
