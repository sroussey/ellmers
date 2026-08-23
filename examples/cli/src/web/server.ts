/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handleWebRequest, type WebContext, type WebRequest } from "./handler";
import { RunRegistry } from "./RunRegistry";

/** Refuse a request body larger than this. Every form here is a handful of fields. */
const MAX_BODY_BYTES = 256 * 1024;

/** Heartbeat for an idle event stream, so a proxy does not reap it. */
const SSE_KEEPALIVE_MS = 25_000;

export interface WebServerHandle {
  readonly server: Server;
  readonly registry: RunRegistry;
  readonly url: string;
  readonly token: string;
  readonly close: () => Promise<void>;
}

export interface StartWebServerArgs {
  readonly port: number;
  readonly host: string;
  readonly program: Command;
  readonly binaryName: string;
  readonly binary: readonly string[];
  readonly cwd: string;
  readonly logDir: string;
  readonly token?: string;
}

/**
 * `node:http` rather than `Bun.serve`, so one implementation serves both
 * runtimes: the CLI runs under Bun and the tests run under Node.
 */
export async function startWebServer(args: StartWebServerArgs): Promise<WebServerHandle> {
  const registry = new RunRegistry({
    binary: args.binary,
    cwd: args.cwd,
    logDir: args.logDir,
    binaryName: args.binaryName,
  });
  const ctx: WebContext = {
    program: args.program,
    registry,
    token: args.token ?? randomUUID(),
    binaryName: args.binaryName,
    allowedHosts: new Set([args.host.toLowerCase(), "localhost", "127.0.0.1", "[::1]", "::1"]),
    startedAt: Date.now(),
  };

  const server = createServer((req, res) => {
    void serve(req, res, ctx);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port, args.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : args.port;
  // A bare wildcard is not something you can paste into a browser.
  const displayHost = args.host === "0.0.0.0" || args.host === "::" ? "localhost" : args.host;
  return {
    server,
    registry,
    token: ctx.token,
    url: `http://${displayHost}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        registry.closeAll();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serve(req: IncomingMessage, res: ServerResponse, ctx: WebContext): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const request: WebRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers as Record<string, string | undefined>,
      body: req.method === "POST" ? await readBody(req) : "",
    };
    const result = await handleWebRequest(request, ctx);

    if (result.kind === "sse") {
      streamEvents(res, ctx, result.runId, result.afterSeq);
      return;
    }
    if (result.kind === "file") {
      res.writeHead(200, { "content-type": result.contentType, "cache-control": "no-cache" });
      createReadStream(result.path).pipe(res);
      return;
    }
    res.writeHead(result.status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A page that throws must say so in the browser rather than hanging the
    // socket — the point of this server is looking at things going wrong.
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`500 ${message}`);
  }
}

function streamEvents(res: ServerResponse, ctx: WebContext, runId: string, afterSeq: number): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  const unsubscribe = ctx.registry.subscribe(runId, afterSeq, (record) => {
    res.write(`id: ${record.seq}\ndata: ${JSON.stringify(record.event)}\n\n`);
  });
  const keepalive = setInterval(() => res.write(": keepalive\n\n"), SSE_KEEPALIVE_MS);
  keepalive.unref?.();
  const stop = (): void => {
    clearInterval(keepalive);
    unsubscribe();
  };
  res.on("close", stop);
  res.on("error", stop);
}
