/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import type { PanelData } from "../../extensions";
import type { RunSummary } from "../api";
import type { RunViewState } from "../state";

function Panel({ data }: { data: PanelData }): JSX.Element {
  if (data.kind === "table") {
    return (
      <table className="tbl">
        <thead>
          <tr>
            {data.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (data.kind === "kv") {
    return (
      <div className="pb">
        <dl className="kv">
          {data.items.map(([key, value]) => (
            <>
              <dt key={`k-${key}`}>{key}</dt>
              <dd key={`v-${key}`}>{value}</dd>
            </>
          ))}
        </dl>
      </div>
    );
  }
  if (data.kind === "error") {
    return (
      <div className="pb" style="color:var(--fail)">
        {data.message}
      </div>
    );
  }
  return <pre className="json">{data.text}</pre>;
}

export function ResultTab({
  run,
  state,
  panels,
}: {
  run: RunSummary;
  state: RunViewState;
  panels: readonly { id: string; title: string; source: string; data: PanelData }[];
}): JSX.Element {
  return (
    <div className="wrap">
      <h2 className="sec">Result</h2>
      <div className="inspect">
        <div className="panel">
          <h5>
            <span>stdout · JSON</span>
          </h5>
          <pre className="json">
            {state.output === undefined ? "(no output)" : JSON.stringify(state.output, null, 2)}
          </pre>
        </div>
        <div className="panel">
          <h5>
            <span>Run</span>
          </h5>
          <div className="pb">
            <dl className="kv">
              <dt>state</dt>
              <dd>{state.state}</dd>
              <dt>exit</dt>
              <dd>{run.exitCode ?? "—"}</dd>
              <dt>elapsed</dt>
              <dd>
                {run.endedAt ? `${((run.endedAt - run.startedAt) / 1000).toFixed(1)}s` : "running"}
              </dd>
              <dt>tasks</dt>
              <dd>{state.rows.size}</dd>
            </dl>
            {state.error ? <div style="color:var(--fail);margin-top:8px">{state.error}</div> : null}
          </div>
        </div>
      </div>

      {panels.map((panel) => (
        <div key={panel.id}>
          <h2 className="sec">{panel.title}</h2>
          <div className="panel">
            <h5>
              <span>{panel.title}</span>
              <span className="badge ext">{panel.source}</span>
            </h5>
            <Panel data={panel.data} />
          </div>
        </div>
      ))}
    </div>
  );
}
