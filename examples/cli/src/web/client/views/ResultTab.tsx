/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import type { PanelData, PanelRowAction } from "../../extensions";
import type { WebInvocation } from "../../argv";
import type { RunSummary } from "../api";
import type { RunViewState } from "../state";

function Panel({
  data,
  onAction,
}: {
  data: PanelData;
  onAction?: (invocation: WebInvocation) => void;
}): JSX.Element {
  if (data.kind === "table") {
    // The action column exists only where a row actually carries one, so a
    // table without actions renders exactly as it always has.
    const actions: readonly (readonly PanelRowAction[] | undefined)[] | undefined =
      onAction && data.rowActions?.some((row) => row && row.length > 0)
        ? data.rowActions
        : undefined;
    return (
      <>
        <div className="tblwrap">
          <table className="tbl">
            <thead>
              <tr>
                {data.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
                {actions ? <th scope="col">action</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr
                  key={index}
                  className={data.rowTones?.[index] ? `t-${data.rowTones[index]}` : undefined}
                >
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                  {actions ? (
                    <td>
                      <div className="rowacts">
                        {(actions[index] ?? []).map((action) => (
                          <button
                            key={action.label}
                            type="button"
                            className="btn sm"
                            title={action.title}
                            onClick={() => onAction?.(action.invocation)}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.note ? <div className="pnote">{data.note}</div> : null}
      </>
    );
  }
  if (data.kind === "stats") {
    return (
      <div className="stats">
        {data.items.map((item) => (
          <div className={`stat${item.tone ? ` t-${item.tone}` : ""}`} key={item.label}>
            <span className="stat-l">{item.label}</span>
            <span className="stat-v">{item.value}</span>
            {item.detail ? <span className="stat-d">{item.detail}</span> : null}
          </div>
        ))}
      </div>
    );
  }
  if (data.kind === "timeline") {
    return (
      <ol className="tline">
        {data.events.map((event, index) => (
          <li key={`${event.date}-${index}`} className={event.tone ? `t-${event.tone}` : undefined}>
            <span className="tl-d">{event.date}</span>
            <span className="tl-l">{event.label}</span>
            {event.detail ? <span className="tl-x">{event.detail}</span> : null}
          </li>
        ))}
      </ol>
    );
  }
  if (data.kind === "empty") {
    return <div className="pb cmd-d">{data.message}</div>;
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
  onAction,
}: {
  run: RunSummary;
  state: RunViewState;
  panels: readonly { id: string; title: string; source: string; data: PanelData }[];
  /**
   * Carries one row into the command it is an argument for: the console
   * selects that command and fills its form, leaving the run attached so the
   * table behind the button is still there for the next row.
   */
  onAction?: (invocation: WebInvocation) => void;
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
            <Panel data={panel.data} onAction={onAction} />
          </div>
        </div>
      ))}
    </div>
  );
}
