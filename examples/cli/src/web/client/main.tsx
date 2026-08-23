/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import { render } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { RunEvent } from "../../run-events/RunEventTypes";
import type { WebField } from "../commandFields";
import { findCommandNode, type WebCommandNode } from "../commandTree";
import type { PanelData } from "../extensions";
import {
  abortRun,
  answerHuman,
  getCommands,
  getFields,
  getPanels,
  getRun,
  getStatusWidgets,
  listRuns,
  openRunStream,
  startRun,
  type RunSummary,
} from "./api";
import { formErrors, initialValues, toInvocation, type FormValues } from "./formModel";
import {
  applyRecord,
  emptyRunView,
  filterCommandTree,
  openPathsFor,
  type RunViewState,
} from "./state";
import { CommandTree } from "./views/CommandTree";
import { HumanPrompt } from "./views/HumanPrompt";
import { OptionsForm } from "./views/OptionsForm";
import { ResultTab } from "./views/ResultTab";
import { RunConsole } from "./views/RunConsole";

type Tab = "options" | "run" | "result";
type FieldWithWidget = WebField & { widget?: string };

/** One timer drives every spinner and elapsed clock, as the terminal does. */
function useTick(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((value) => value + 1), 90);
    return () => clearInterval(id);
  }, [active]);
  return tick;
}

function App(): JSX.Element {
  const [commands, setCommands] = useState<readonly WebCommandNode[]>([]);
  const [binaryName, setBinaryName] = useState("workglow");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [node, setNode] = useState<WebCommandNode | undefined>(undefined);
  const [fields, setFields] = useState<readonly FieldWithWidget[]>([]);
  const [values, setValues] = useState<FormValues>({});
  const [tab, setTab] = useState<Tab>("options");
  const [runs, setRuns] = useState<readonly RunSummary[]>([]);
  const [run, setRun] = useState<RunSummary | undefined>(undefined);
  const [view, setView] = useState<RunViewState>(emptyRunView());
  const [connected, setConnected] = useState(true);
  const [sortByStatus, setSortByStatus] = useState(true);
  const [mapView, setMapView] = useState<"rows" | "grid">("rows");
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [panels, setPanels] = useState<
    readonly { id: string; title: string; source: string; data: PanelData }[]
  >([]);
  const [widgets, setWidgets] = useState<
    readonly {
      id: string;
      title: string;
      source: string;
      meters: readonly { label: string; value: number; max: number }[];
    }[]
  >([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [theme, setTheme] = useState<"light" | "auto" | "dark">("auto");
  const closeStreamRef = useRef<(() => void) | undefined>(undefined);

  const running = run !== undefined && view.state === "running";
  const tick = useTick(running);
  // Clock for the elapsed readout, started in an effect so render stays pure.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    void getCommands()
      .then((result) => {
        setCommands(result.commands);
        setBinaryName(result.binaryName);
        setOpen(new Set(result.commands.map((command) => command.path.join("."))));
      })
      .catch((cause: Error) => setError(cause.message));
    void listRuns()
      .then((result) => setRuns(result.runs))
      .catch(() => {});
    void getStatusWidgets()
      .then((result) => setWidgets(result.widgets))
      .catch(() => {});
  }, []);

  /**
   * Detaches the run being watched. Switching commands does this, because the
   * tabs describe the command in front of you: leaving a finished run attached
   * made `model detail` report itself completed, with `model list`'s results on
   * its Result tab.
   */
  const detachRun = useCallback(() => {
    closeStreamRef.current?.();
    closeStreamRef.current = undefined;
    setRun(undefined);
    setView(emptyRunView());
    setPanels([]);
    setSelected(undefined);
  }, []);

  const selectNode = useCallback(
    (next: WebCommandNode) => {
      if (next !== node) detachRun();
      setNode(next);
      setTab("options");
      setOpen((current) => new Set([...current, ...openPathsFor(next.path)]));
      void getFields(next.path, [])
        .then((result) => {
          setFields(result.fields);
          setValues(initialValues(result.fields));
        })
        .catch((cause: Error) => setError(cause.message));
    },
    [detachRun, node]
  );

  /** An argument decides which schema applies, so changing one re-asks. */
  const onFieldChange = useCallback(
    (key: string, value: string | boolean) => {
      setValues((current) => {
        const next = { ...current, [key]: value };
        const field = fields.find((candidate) => candidate.key === key);
        if (field?.source === "argument" && node) {
          const args = fields
            .filter((candidate) => candidate.source === "argument")
            .map((candidate) => String(next[candidate.key] ?? ""));
          void getFields(node.path, args).then((result) => {
            setFields(result.fields);
            setValues((values2) => ({ ...initialValues(result.fields), ...values2, [key]: value }));
          });
        }
        return next;
      });
    },
    [fields, node]
  );

  const attach = useCallback(
    (summary: RunSummary, keepCommand = false) => {
      // One stream at a time: without this, every run you opened kept its own
      // EventSource for the life of the page.
      closeStreamRef.current?.();
      closeStreamRef.current = undefined;
      setRun(summary);
      setSelected(undefined);
      setPanels([]);
      setView(emptyRunView());
      setTab("run");
      // Show the command the run actually ran, so the crumb and the options
      // under it describe what you are looking at.
      if (!keepCommand) {
        const owner = findCommandNode(commands, summary.invocation.path);
        if (owner && owner !== node) {
          setNode(owner);
          setOpen((current) => new Set([...current, ...openPathsFor(owner.path)]));
          void getFields(owner.path, summary.invocation.args)
            .then((result) => {
              setFields(result.fields);
              setValues(initialValues(result.fields));
            })
            .catch(() => {});
        }
      }
      void getRun(summary.id).then((detail) => {
        let next = emptyRunView();
        for (const record of detail.events) next = applyRecord(next, record.seq, record.event);
        setView(next);
        closeStreamRef.current = openRunStream(
          summary.id,
          next.lastSeq,
          (seq, event: RunEvent) => setView((current) => applyRecord(current, seq, event)),
          setConnected
        );
      });
    },
    [commands, node]
  );

  const onRun = useCallback(
    (dryRun: boolean) => {
      if (!node) return;
      const invocation = toInvocation(fields, values, node.path);
      const withDry = dryRun
        ? { ...invocation, options: { ...invocation.options, "dry-run": true } }
        : invocation;
      void startRun(withDry)
        .then((summary) => {
          attach(summary, true);
          void listRuns().then((result) => setRuns(result.runs));
        })
        .catch((cause: Error) => setError(cause.message));
    },
    [attach, fields, node, values]
  );

  // A finished run is where the Result tab and any contributed panels come from.
  useEffect(() => {
    if (!run || view.state === "running") return;
    void getPanels(run.id)
      .then((result) => setPanels(result.panels))
      .catch(() => {});
    void listRuns()
      .then((result) => setRuns(result.runs))
      .catch(() => {});
  }, [run, view.state]);

  // "auto" is the absence of a choice: the stylesheet reads the viewer's own
  // setting when nothing is stamped, so clearing is what auto means.
  useEffect(() => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => () => closeStreamRef.current?.(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        document.getElementById("filter")?.focus();
      }
      if (
        event.key === "Enter" &&
        (!typing || event.metaKey || event.ctrlKey) &&
        tab === "options"
      ) {
        event.preventDefault();
        onRun(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRun, tab]);

  const filtered = useMemo(() => filterCommandTree(commands, filter), [commands, filter]);
  const errors = node ? formErrors(fields, values) : [];
  const elapsed = run ? Math.max(0, (run.endedAt ?? (now || run.startedAt)) - run.startedAt) : 0;
  const crumbs = node ? [binaryName, ...node.path] : [binaryName];

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <div className="mark">w</div>
          <div>
            <div className="brand-t">{binaryName}</div>
            <div className="brand-s">{window.location.host}</div>
          </div>
        </div>
        <div className="searchbox">
          <input
            id="filter"
            type="text"
            placeholder="Filter commands   /"
            value={filter}
            onInput={(event) => setFilter((event.target as HTMLInputElement).value)}
          />
        </div>
        <CommandTree
          nodes={filtered}
          open={open}
          selectedPath={node?.path ?? []}
          onToggle={(key) =>
            setOpen((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          onSelect={selectNode}
        />
        <div className="railsec">
          <h4>Runs</h4>
          {runs.length === 0 ? <div className="cmd-d">Nothing has run yet.</div> : null}
          {runs.slice(0, 6).map((summary) => (
            <button key={summary.id} className="runitem" onClick={() => attach(summary)}>
              <span
                className={`dot ${summary.state === "running" ? "run" : summary.state === "completed" ? "ok" : "fail"}`}
              />
              <span className="lbl">{summary.cli.replace(`${binaryName} `, "")}</span>
              <span className="t">
                {summary.endedAt
                  ? `${((summary.endedAt - summary.startedAt) / 1000).toFixed(1)}s`
                  : "…"}
              </span>
            </button>
          ))}
        </div>
        {widgets.map((widget) => (
          <div className="railsec" key={widget.id}>
            <h4>{widget.title}</h4>
            {widget.meters.map((meter) => (
              <div className="meter" key={meter.label}>
                <span>
                  {meter.value} / {meter.max} {meter.label}
                </span>
                <span className="bar">
                  <i style={`width:${Math.min(100, (meter.value / (meter.max || 1)) * 100)}%`} />
                </span>
              </div>
            ))}
          </div>
        ))}
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">
            {crumbs.map((segment, index) => (
              <>
                {index > 0 ? <span className="sep">›</span> : null}
                {index === crumbs.length - 1 && node ? (
                  <b key={segment}>{segment}</b>
                ) : (
                  <span className="dim" key={segment}>
                    {segment}
                  </span>
                )}
              </>
            ))}
            {node ? <span className="cmd-d">{node.description}</span> : null}
          </div>
          <div className="spacer" />
          <div className="ctl">
            <div className="tgl" role="group" aria-label="Row order">
              <button aria-pressed={sortByStatus} onClick={() => setSortByStatus(true)}>
                CLI order
              </button>
              <button aria-pressed={!sortByStatus} onClick={() => setSortByStatus(false)}>
                Graph order
              </button>
            </div>
            <div className="tgl" role="group" aria-label="Theme">
              {(["light", "auto", "dark"] as const).map((candidate) => (
                <button
                  key={candidate}
                  aria-pressed={theme === candidate}
                  onClick={() => setTheme(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="tabs" role="tablist">
          {(["options", "run", "result"] as const).map((candidate) => (
            <button
              key={candidate}
              className="tab"
              role="tab"
              aria-selected={tab === candidate}
              disabled={candidate !== "options" && !run}
              onClick={() => setTab(candidate)}
            >
              <span>
                {candidate === "options" ? "Options" : candidate === "run" ? "Run" : "Result"}
              </span>
              {candidate === "run" && run ? (
                <span className="pill">{view.state === "running" ? "live" : view.state}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="body">
          {error ? (
            <div className="wrap" style="color:var(--fail)">
              {error}
            </div>
          ) : null}
          {view.humanRequest && run ? (
            <HumanPrompt
              request={view.humanRequest}
              onAnswer={(action, content) => {
                void answerHuman(run.id, {
                  requestId: view.humanRequest!.requestId,
                  action,
                  content,
                  done: true,
                });
                setView((current) => ({ ...current, humanRequest: undefined }));
              }}
            />
          ) : null}
          {tab === "options" && node ? (
            <OptionsForm
              binaryName={binaryName}
              path={node.path}
              fields={fields}
              values={values}
              errors={errors}
              onChange={onFieldChange}
              onRun={onRun}
            />
          ) : null}
          {tab === "options" && !node ? (
            <div className="wrap">
              <p className="lede">
                Pick a command on the left. Its options come from the same schemas the terminal
                prompts from, and the line at the bottom is exactly what will run.
              </p>
            </div>
          ) : null}
          {tab === "run" && run ? (
            <RunConsole
              cli={run.cli}
              state={view}
              elapsedMs={elapsed}
              tick={tick}
              sortByStatus={sortByStatus}
              selectedId={selected}
              connected={connected}
              mapView={mapView}
              onMapView={setMapView}
              onSelect={setSelected}
              onAbort={() => void abortRun(run.id)}
            />
          ) : null}
          {tab === "result" && run ? <ResultTab run={run} state={view} panels={panels} /> : null}
        </div>

        <footer className="statusbar">
          <span className="live">
            <span className={`dot ${connected ? "ok" : "fail"}`} />{" "}
            {connected ? "connected" : "reconnecting"}
          </span>
          <span>{run ? `run ${run.id.slice(0, 8)}` : "no run"}</span>
          <span className="spacer" />
          <span>No page reloads — the document is mounted once and patched per event</span>
        </footer>
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (root) render(<App />, root);
