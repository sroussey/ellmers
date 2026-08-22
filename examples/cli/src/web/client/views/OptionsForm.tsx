/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { renderCliLine } from "../../argv";
import type { WebField } from "../../commandFields";
import { searchWidget } from "../api";
import { splitFields, toInvocation, type FormValues } from "../formModel";

type FieldWithWidget = WebField & { widget?: string };

function SearchWidget({
  field,
  value,
  onChange,
}: {
  field: FieldWithWidget;
  value: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<readonly { value: string; label: string; detail?: string }[]>(
    []
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void searchWidget(field.format ?? "", value)
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch(() => setItems([]));
    return () => {
      cancelled = true;
    };
  }, [open, value, field.format]);

  return (
    <div>
      <div className="wlookup">
        <input
          type="text"
          value={value}
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
                onChange(item.value);
                setOpen(false);
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
  onChange,
}: {
  field: FieldWithWidget;
  value: string | boolean | undefined;
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
    return <SearchWidget field={field} value={String(value ?? "")} onChange={onChange} />;
  }
  if (field.type === "object" || field.type === "array" || field.description.length > 90) {
    return (
      <textarea
        value={String(value ?? "")}
        onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
      />
    );
  }
  return (
    <input
      type={field.type === "number" || field.type === "integer" ? "number" : "text"}
      value={String(value ?? "")}
      onInput={(event) => onChange((event.target as HTMLInputElement).value)}
    />
  );
}

function FieldRows({
  fields,
  values,
  onChange,
}: {
  fields: readonly FieldWithWidget[];
  values: FormValues;
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
  fields,
  values,
  errors,
  onChange,
  onRun,
}: {
  binaryName: string;
  path: readonly string[];
  fields: readonly FieldWithWidget[];
  values: FormValues;
  errors: readonly string[];
  onChange: (key: string, value: string | boolean) => void;
  onRun: (dryRun: boolean) => void;
}): JSX.Element {
  const { args, inputs, advanced } = splitFields(fields);
  const line = renderCliLine(binaryName, toInvocation(fields, values, path));
  // Offering a flag the command does not declare produces a rejected run, so
  // the button exists only where `--dry-run` is real.
  const hasDryRun = fields.some((field) => field.key === "dry-run" && field.source === "option");

  return (
    <div className="wrap">
      {args.length > 0 ? (
        <>
          <h2 className="sec">Arguments</h2>
          <FieldRows fields={args} values={values} onChange={onChange} />
        </>
      ) : null}
      {inputs.length > 0 ? (
        <>
          <h2 className="sec">Inputs</h2>
          <FieldRows fields={inputs} values={values} onChange={onChange} />
        </>
      ) : null}
      {advanced.length > 0 ? (
        <details className="adv">
          <summary>{advanced.length} more options</summary>
          <FieldRows fields={advanced} values={values} onChange={onChange} />
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
            <button className="ghost" onClick={() => onRun(true)}>
              Dry run
            </button>
          ) : null}
          <button className="btn primary" onClick={() => onRun(false)} disabled={errors.length > 0}>
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
