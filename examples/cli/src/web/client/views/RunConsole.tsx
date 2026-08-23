/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import { marqueeBar, unicodeBar } from "../../../ui/model/progressBar";
import {
  cliTaskStatusGlyph,
  deriveRunState,
  runStatusBarFields,
  taskDetailText,
} from "../../../ui/model/runRowModel";
import { consoleContent, orderedRows, runLogText, type RunRow, type RunViewState } from "../state";
import { MapView } from "./MapView";

/** Braille frames, the same family the terminal spins. */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const RUNNING = new Set(["PROCESSING", "STREAMING", "ABORTING"]);

function durationOf(row: RunRow): number | undefined {
  if (row.startedAt === undefined || row.endedAt === undefined) return undefined;
  return Math.max(0, row.endedAt - row.startedAt);
}

function numberText(value: number): string {
  return value.toLocaleString("en-US");
}

function TaskRow({
  row,
  tick,
  state,
  selected,
  mapView,
  onSelect,
}: {
  row: RunRow;
  tick: number;
  state: RunViewState;
  selected: boolean;
  mapView: "rows" | "grid";
  onSelect: (id: string) => void;
}): JSX.Element {
  const running = RUNNING.has(row.status);
  const iteration = state.iterations.get(row.id);
  const detail = taskDetailText(row.progress, durationOf(row), running);
  const showBar = running && row.progress !== undefined;
  const indeterminate = running && row.progress === undefined && row.streamText.length > 0;

  return (
    <div>
      <div
        className={`row d${Math.min(row.depth, 3)} st-${row.status}${selected ? " sel" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(row.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onSelect(row.id);
        }}
      >
        {row.depth > 0 ? <span className="guide" /> : null}
        <span className="gl">
          {running ? SPINNER[tick % SPINNER.length] : cliTaskStatusGlyph(row.status)}
        </span>
        <span className="lab">{row.label}</span>
        {running && row.message ? <span className="msg">— {row.message}</span> : null}
        <span className="bar">
          {showBar ? unicodeBar(row.progress ?? 0, 12) : indeterminate ? marqueeBar(tick, 12) : ""}
        </span>
        <span className="pct">{detail}</span>
      </div>
      {row.usage ? (
        <div className={`usage d${Math.min(row.depth, 2)}`}>
          <span className="up">↑ {numberText(row.usage.input)}</span>
          {"  "}
          <span className="dn">↓ {numberText(row.usage.output)}</span>
          {row.usage.cached ? `  ${numberText(row.usage.cached)} cached` : ""}
        </div>
      ) : null}
      {iteration ? <MapView taskId={row.id} map={iteration} tick={tick} view={mapView} /> : null}
      {row.streamText && running ? (
        <div className={`bubble d${Math.min(row.depth, 1)}`}>
          <div className="turn">
            <span className="txt">{row.streamText.slice(-1200)}</span>
            <span className="caret" />
          </div>
        </div>
      ) : null}
      {row.status === "FAILED" && state.error ? (
        <div className={`err d${Math.min(row.depth, 1)}`}>{state.error}</div>
      ) : null}
    </div>
  );
}

export function RunConsole({
  cli,
  state,
  elapsedMs,
  tick,
  sortByStatus,
  selectedId,
  connected,
  mapView,
  onMapView,
  onSelect,
  onAbort,
}: {
  cli: string;
  state: RunViewState;
  elapsedMs: number;
  tick: number;
  sortByStatus: boolean;
  selectedId: string | undefined;
  connected: boolean;
  mapView: "rows" | "grid";
  onMapView: (view: "rows" | "grid") => void;
  onSelect: (id: string) => void;
  onAbort: () => void;
}): JSX.Element {
  const rows = orderedRows(state, sortByStatus);
  const statuses = rows.map((row) => row.status);
  const runState = state.state === "running" ? deriveRunState(statuses) || "running" : state.state;
  const done = statuses.filter((status) => status === "COMPLETED").length;
  const usage = state.usage;
  const usageText = usage ? `↑ ${numberText(usage.input)} ↓ ${numberText(usage.output)}` : "";
  const fields = runStatusBarFields(usageText, done, rows.length, runState);
  // The toggle only appears for a run that owns a map, and the grid only where
  // per-index state is retained — offering it otherwise would promise a view
  // the run cannot fill in.
  const gridable = [...state.iterations.values()].some((map) => map.slots !== undefined);
  const content = consoleContent(rows.length, state);

  return (
    <div className="wrap">
      <div className="screen">
        <div className="scr-head">
          <span
            className={`dot ${runState === "running" ? "run" : runState === "completed" ? "ok" : "fail"}`}
          />
          <span className="cli">
            $ <b>{cli}</b>
          </span>
          <span className="el">{(elapsedMs / 1000).toFixed(1)}s</span>
          {gridable ? (
            <>
              <span className="el">Map</span>
              <div className="seg">
                {(["rows", "grid"] as const).map((candidate) => (
                  <button
                    key={candidate}
                    aria-pressed={mapView === candidate}
                    onClick={() => onMapView(candidate)}
                  >
                    {candidate === "rows" ? "Rows" : "Grid"}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {state.state === "running" ? (
            <button className="ghost" onClick={onAbort}>
              Abort
            </button>
          ) : null}
        </div>
        <div className="scr-body">
          {state.graphProgress !== undefined ? (
            <div className="gline">
              <span className="lb">Workflow</span>
              <span className="bar">{unicodeBar(state.graphProgress, 22)}</span>
              <span className="pct">{Math.round(state.graphProgress)}%</span>
            </div>
          ) : null}
          {content === "waiting" ? (
            <div className="mapmore">
              {state.state === "running" ? "running…" : "this command printed nothing"}
            </div>
          ) : null}
          {content === "output" ? <pre className="scr-out">{runLogText(state)}</pre> : null}
          {content === "tasks"
            ? rows.map((row) => (
                <TaskRow
                  key={row.id}
                  row={row}
                  tick={tick}
                  state={state}
                  selected={selectedId === row.id}
                  mapView={mapView}
                  onSelect={onSelect}
                />
              ))
            : null}
        </div>
        <div className="scr-foot">
          {fields.map((field) => (
            <span key={field}>{field}</span>
          ))}
          {!connected && state.state === "running" ? <span>reconnecting…</span> : null}
        </div>
      </div>

      {content === "tasks" && state.logs.length > 0 ? (
        <div className="inspect">
          <div className="panel">
            <h5>
              <span>Command output</span>
            </h5>
            <pre className="json">{state.logs.map((log) => log.text).join("\n")}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
