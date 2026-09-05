/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { WebCommandBadge } from "../../annotations";
import { renderCliLine } from "../../argv";
import type { WebField } from "../../commandFields";
import { searchWidget } from "../api";
import {
  appendValue,
  splitFields,
  stableScopeKey,
  toInvocation,
  type FormValues,
  type WidgetScope,
} from "../formModel";
import { CommandBadges } from "./CommandTree";

type FieldWithWidget = WebField & { widget?: string };

function SearchWidget({
  field,
  value,
  scope,
  onChange,
}: {
  field: FieldWithWidget;
  value: string;
  scope: WidgetScope | undefined;
  onChange: (next: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<readonly { value: string; label: string; detail?: string }[]>(
    []
  );
  const [open, setOpen] = useState(false);
  const scopeKey = scope ? stableScopeKey(scope) : "";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // A list field searches on the fragment being typed, not on the list: the
    // whole value of a picked-plus-typing `--models` matches no model at all.
    const needle = field.multiple ? (value.split(",").pop() ?? "").trim() : value;
    void searchWidget(field.format ?? "", needle, scope)
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch(() => setItems([]));
    return () => {
      cancelled = true;
    };
    // `scope` is a fresh object on every render of the form, so depending on it
    // directly re-fires this search whenever ANY field changes — a keystroke in
    // one box re-queries every open picker on the page. The effect depends on a
    // serialization of what the search actually reads instead, so it re-runs
    // when the scope's CONTENT changes and not when its identity does.
  }, [open, value, field.format, field.multiple, scopeKey, scope]);

  return (
    <div>
      <div className="wlookup">
        <input
          type="text"
          value={value}
          placeholder={field.placeholder}
          onInput={(event) => onChange((event.target as HTMLInputElement).value)}
          onFocus={() => setOpen(true)}
        />
        <button className="btn" type="button" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Browse"}
        </button>
      </div>
      {open && items.length > 0 ? (
        <div className="card" style="margin-top:6px;max-height:220px;overflow:auto">
          {items.map((item) => (
            <button
              key={item.value}
              className="cmd"
              onClick={() => {
                onChange(field.multiple ? appendValue(value, item.value) : item.value);
                if (!field.multiple) setOpen(false);
              }}
            >
              <span className="cmd-n">{item.label}</span>
              <span className="cmd-d">{item.detail ?? ""}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Control({
  field,
  value,
  scope,
  onChange,
}: {
  field: FieldWithWidget;
  value: string | boolean | undefined;
  scope: WidgetScope | undefined;
  onChange: (next: string | boolean) => void;
}): JSX.Element {
  if (field.type === "boolean") {
    return (
      <label className="swi">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange((event.target as HTMLInputElement).checked)}
        />
        <span>{value === true ? "on" : "off"}</span>
      </label>
    );
  }
  if (field.choices) {
    return (
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        <option value="">—</option>
        {field.choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  }
  if (field.widget === "search") {
    return (
      <SearchWidget field={field} value={String(value ?? "")} scope={scope} onChange={onChange} />
    );
  }
  if (field.type === "object" || field.type === "array" || field.description.length > 90) {
    return (
      <textarea
        value={String(value ?? "")}
        placeholder={field.placeholder}
        onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
      />
    );
  }
  return (
    <input
      type={field.type === "number" || field.type === "integer" ? "number" : "text"}
      value={String(value ?? "")}
      placeholder={field.placeholder}
      onInput={(event) => onChange((event.target as HTMLInputElement).value)}
    />
  );
}

function FieldRows({
  fields,
  values,
  scope,
  onChange,
}: {
  fields: readonly FieldWithWidget[];
  values: FormValues;
  scope: WidgetScope | undefined;
  onChange: (key: string, value: string | boolean) => void;
}): JSX.Element {
  return (
    <div className="card">
      {fields.map((field) => (
        <div className={`field${field.required ? " req" : ""}`} key={field.key}>
          <div className="fl">
            <b>{field.key}</b>
            {field.description ? <span>{field.description}</span> : null}
            {field.source === "config" ? <span className="badge">config</span> : null}
          </div>
          <div className="fc">
            <Control
              field={field}
              value={values[field.key]}
              scope={scope}
              onChange={(next) => onChange(field.key, next)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function OptionsForm({
  binaryName,
  path,
  description,
  fields,
  values,
  errors,
  badges,
  note,
  onChange,
  onRun,
  canRun = true,
}: {
  binaryName: string;
  path: readonly string[];
  /**
   * The command's one-line help. It reads here rather than in the breadcrumb:
   * the crumb clips it to whatever the topbar has left over, and this is the
   * pane where someone is deciding what the command does before running it.
   */
  description?: string;
  fields: readonly FieldWithWidget[];
  values: FormValues;
  errors: readonly string[];
  badges?: readonly WebCommandBadge[];
  note?: string;
  onChange: (key: string, value: string | boolean) => void;
  onRun: (dryRun: boolean) => void;
  /** False while the CLI is not answering its heartbeat; running would just fail. */
  canRun?: boolean;
}): JSX.Element {
  const { args, inputs, advanced } = splitFields(fields);
  const line = renderCliLine(binaryName, toInvocation(fields, values, path));
  // The picker for one field is answered from the whole form, so the scope is
  // rebuilt from the values on every render rather than captured per field.
  const scope: WidgetScope = {
    path,
    args: args.map((field) => String(values[field.key] ?? "")),
    values,
  };
  // Offering a flag the command does not declare produces a rejected run, so
  // the button exists only where `--dry-run` is real.
  const hasDryRun = fields.some((field) => field.key === "dry-run" && field.source === "option");

  const hasBadges = badges !== undefined && badges.length > 0;

  return (
    <div className="wrap">
      {description ? <p className="lede">{description}</p> : null}
      {hasBadges || note ? (
        <div className={`cnote${badges?.includes("destructive") ? " danger" : ""}`}>
          <CommandBadges badges={badges} />
          {note ? <span>{note}</span> : null}
        </div>
      ) : null}
      {args.length > 0 ? (
        <>
          <h2 className="sec">Arguments</h2>
          <FieldRows fields={args} values={values} scope={scope} onChange={onChange} />
        </>
      ) : null}
      {inputs.length > 0 ? (
        <>
          <h2 className="sec">Inputs</h2>
          <FieldRows fields={inputs} values={values} scope={scope} onChange={onChange} />
        </>
      ) : null}
      {advanced.length > 0 ? (
        <details className="adv">
          <summary>{advanced.length} more options</summary>
          <FieldRows fields={advanced} values={values} scope={scope} onChange={onChange} />
        </details>
      ) : null}

      <div className="cmdbar">
        <code>
          <span className="pr">$ </span>
          {line}
        </code>
        <div className="acts">
          <button className="ghost" onClick={() => void navigator.clipboard?.writeText(line)}>
            Copy
          </button>
          {hasDryRun ? (
            <button className="ghost" onClick={() => onRun(true)} disabled={!canRun}>
              Dry run
            </button>
          ) : null}
          <button
            className="btn primary"
            onClick={() => onRun(false)}
            disabled={errors.length > 0 || !canRun}
            title={canRun ? undefined : "the CLI is not responding"}
          >
            Run <span className="kbd">↵</span>
          </button>
        </div>
      </div>
      {errors.length > 0 ? (
        <div className="mapmore" style="color:var(--fail);padding-top:8px">
          {errors.join(" · ")}
        </div>
      ) : null}
    </div>
  );
}
