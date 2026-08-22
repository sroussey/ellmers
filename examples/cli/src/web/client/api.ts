/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RunEvent } from "../../run-events/RunEventTypes";
import type { WebInvocation } from "../argv";
import type { WebField } from "../commandFields";
import type { WebCommandNode } from "../commandTree";
import type { PanelData } from "../extensions";

export interface RunSummary {
  readonly id: string;
  readonly cli: string;
  readonly invocation: WebInvocation;
  readonly startedAt: number;
  readonly endedAt: number | undefined;
  readonly state: string;
  readonly exitCode: number | undefined;
}

/**
 * The session token, taken from the URL the CLI printed and then removed from
 * the address bar — a token sitting in a shared screenshot is the likeliest way
 * for this one to leak.
 */
function readToken(): string {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("t");
  if (fromQuery) {
    sessionStorage.setItem("workglow-token", fromQuery);
    url.searchParams.delete("t");
    window.history.replaceState({}, "", url.toString());
    return fromQuery;
  }
  return sessionStorage.getItem("workglow-token") ?? "";
}

const token = readToken();

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "x-workglow-token": token,
      "content-type": "application/json",
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; errors?: string[] };
    throw new Error(body.errors?.join(", ") ?? body.error ?? `request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export function getCommands(): Promise<{
  readonly commands: readonly WebCommandNode[];
  readonly binaryName: string;
}> {
  return api("/api/commands");
}

export function getFields(
  path: readonly string[],
  args: readonly string[]
): Promise<{ readonly fields: readonly (WebField & { widget?: string })[] }> {
  const query = new URLSearchParams({ path: path.join(".") });
  for (const arg of args) if (arg) query.append("arg", arg);
  return api(`/api/fields?${query.toString()}`);
}

export function searchWidget(
  format: string,
  query: string
): Promise<{ readonly items: readonly { value: string; label: string; detail?: string }[] }> {
  const search = new URLSearchParams({ format, q: query });
  return api(`/api/widget-search?${search.toString()}`);
}

export function getStatusWidgets(): Promise<{
  readonly widgets: readonly {
    readonly id: string;
    readonly title: string;
    readonly source: string;
    readonly meters: readonly { label: string; value: number; max: number }[];
  }[];
}> {
  return api("/api/status-widgets");
}

export function listRuns(): Promise<{ readonly runs: readonly RunSummary[] }> {
  return api("/api/runs");
}

export function getRun(
  id: string
): Promise<RunSummary & { readonly events: readonly { seq: number; event: RunEvent }[] }> {
  return api(`/api/runs/${id}`);
}

export function startRun(invocation: WebInvocation): Promise<RunSummary> {
  return api("/api/runs", { method: "POST", body: JSON.stringify(invocation) });
}

export function abortRun(id: string): Promise<{ readonly aborted: boolean }> {
  return api(`/api/runs/${id}/abort`, { method: "POST", body: "{}" });
}

export function answerHuman(
  id: string,
  response: unknown
): Promise<{ readonly delivered: boolean }> {
  return api(`/api/runs/${id}/human`, { method: "POST", body: JSON.stringify(response) });
}

export function getPanels(id: string): Promise<{
  readonly panels: readonly { id: string; title: string; source: string; data: PanelData }[];
}> {
  return api(`/api/runs/${id}/panels`);
}

/**
 * Subscribes to a run's stream, resuming after `afterSeq`.
 *
 * EventSource reconnects on its own and sends `Last-Event-ID`, so a laptop
 * waking up rejoins a run in flight rather than showing an empty console. The
 * token rides in the query because EventSource cannot set a header.
 */
export function openRunStream(
  id: string,
  afterSeq: number,
  onEvent: (seq: number, event: RunEvent) => void,
  onOpenChange?: (open: boolean) => void
): () => void {
  const query = new URLSearchParams({ t: token, after: String(afterSeq) });
  const source = new EventSource(`/api/runs/${id}/events?${query.toString()}`);
  source.onopen = () => onOpenChange?.(true);
  source.onerror = () => onOpenChange?.(false);
  source.onmessage = (message) => {
    const seq = Number.parseInt(message.lastEventId, 10);
    try {
      onEvent(Number.isFinite(seq) ? seq : 0, JSON.parse(message.data) as RunEvent);
    } catch {
      /* a malformed frame is not worth tearing the stream down for */
    }
  };
  return () => source.close();
}
