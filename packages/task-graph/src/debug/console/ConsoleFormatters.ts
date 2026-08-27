/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DirectedAcyclicGraph } from "@workglow/util/graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { Dataflow } from "../../task-graph/Dataflow";
import { TaskGraph } from "../../task-graph/TaskGraph";
import { Workflow } from "../../task-graph/Workflow";
import { Task } from "../../task/Task";
import { TaskStatus } from "../../task/TaskTypes";

type Config = Record<string, unknown>;

/**
 * Formats a duration in milliseconds as a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}\u00B5s`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Extracts property keys from a JSON schema, handling boolean schemas.
 * Boolean schemas: true = accepts any, false = rejects all
 */
function getSchemaProperties(schema: DataPortSchema): Record<string, DataPortSchema> | null {
  if (typeof schema === "boolean") {
    // Boolean schemas don't have properties
    // true = accepts any value, false = rejects all values
    return null;
  }
  return schema.properties as Record<string, DataPortSchema> | null;
}

type JsonMLTagName = string;

interface JsonMLAttributes {
  readonly [key: string]: unknown;
}

type JsonMLNode = JsonMLText | JsonMLElementDef;

type JsonMLText = string;

type JsonMLElementDef = [JsonMLTagName, JsonMLAttributes?, ...JsonMLNode[]];

abstract class ConsoleFormatter {
  abstract header(value: unknown, config?: Config): JsonMLElementDef | null;
  abstract hasBody(value: unknown, config?: Config): boolean;
  abstract body(value: unknown, config?: Config): JsonMLElementDef | null;
}

/**
 * Returns whether the browser is in dark mode
 */
export function isDarkMode(): boolean {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

class WorkflowConsoleFormatter extends ConsoleFormatter {
  header(workflow: Workflow | TaskGraph, _config?: Config): JsonMLElementDef | null {
    if (workflow instanceof Workflow || workflow instanceof TaskGraph) {
      const graph: TaskGraph = workflow instanceof TaskGraph ? workflow : workflow.graph;
      const error = workflow instanceof Workflow ? workflow.error : "";
      const title = workflow instanceof Workflow ? "Workflow" : "TaskGraph";
      const header = new JsonMLElement("div");
      header.sectionHeader(title);
      header.styledText(`(${graph.getTasks().length} tasks)`, "color: green; margin-left: 10px;");
      if (error) {
        header.styledText(error, "color: red; margin-left: 10px;");
      }

      return header.toJsonML();
    }
    return null;
  }

  hasBody(_value: unknown, _config?: Config): boolean {
    return true;
  }

  body(obj: unknown, _config?: Config): JsonMLElementDef {
    const body = new JsonMLElement("div");
    const graph: TaskGraph = obj instanceof TaskGraph ? obj : (obj as Workflow).graph;
    const nodes = body.createStyledList();
    const tasks = graph.getTasks();
    if (tasks.length) {
      nodes.createTextChild("Tasks:");
      for (const node of tasks) {
        const nodeTag = nodes.createListItem("", "list-style-type: none;");
        if (obj instanceof Workflow) {
          for (const df of graph.getSourceDataflows(node.config.id)) {
            const edgeTag = nodeTag.createChild("li").setStyle("padding-left: 20px;");
            if (df.sourceTaskPortId === df.targetTaskPortId) continue;
            const num =
              tasks.findIndex((t) => t.config.id === df.sourceTaskId) -
              tasks.findIndex((t) => t.config.id === node.config.id);

            edgeTag.highlightText("rename");
            edgeTag.functionCall((el) => {
              el.greyText('"');
              el.outputText(`${df.sourceTaskPortId}`);
              el.greyText('", "');
              el.inputText(`${df.targetTaskPortId}`);
              el.greyText('"');
              if (num !== -1) el.greyText(`, ${num}`);
            });
          }
        }
        nodeTag.createObjectTag(node, { graph, workflow: obj });
      }
    }
    if (obj instanceof TaskGraph) {
      const dfList = nodes.createTextChild("Dataflows:");
      for (const df of obj.getDataflows()) {
        const dfTag = dfList.createListItem("", "list-style-type: none;");
        dfTag.createObjectTag(df);
      }
    }

    // Show total duration computed from earliest startedAt to latest completedAt
    let earliestStart: Date | undefined;
    let latestEnd: Date | undefined;
    for (const t of tasks) {
      if (t.startedAt && (!earliestStart || t.startedAt < earliestStart)) {
        earliestStart = t.startedAt;
      }
      if (t.completedAt && (!latestEnd || t.completedAt > latestEnd)) {
        latestEnd = t.completedAt;
      }
    }
    if (earliestStart && latestEnd) {
      const durationMs = latestEnd.getTime() - earliestStart.getTime();
      const timing = nodes.createListItem("", "list-style-type: none;");
      timing.highlightText("Total duration: ");
      timing.createTextChild(formatDuration(durationMs));
    }

    // @ts-expect-error internal DAG handle is not on public types
    const dag = obj._dag ?? obj.graph._dag;

    if (dag && dag.getNodes().length > 0) body.createObjectTag(dag);

    return body.toJsonML();
  }
}

class WorkflowAPIConsoleFormatter extends ConsoleFormatter {
  header(obj: unknown, _config?: Config): JsonMLElementDef | null {
    if (obj === Workflow.prototype || obj === Workflow) {
      const header = new JsonMLElement("div");
      header.sectionHeader("Workflow API");
      return header.toJsonML();
    }
    return null;
  }

  hasBody(_value: unknown, _config?: Config): boolean {
    return true;
  }

  body(): JsonMLElementDef {
    const body = new JsonMLElement("div");
    const apiSection = body.createChild("div");
    const apiList = apiSection.createStyledList();
    const apiTag = apiList.createListItem("", "list-style-type: none;");
    apiTag.createHighlightedListItem(".reset()");
    apiTag.createHighlightedListItem(".rename(outputName, inputName)");
    apiTag.createHighlightedListItem(".run()");
    apiTag.createHighlightedListItem(".abort()");
    apiTag.createHighlightedListItem(".toJSON()");
    apiTag.createHighlightedListItem(".toDependencyJSON()");

    for (const [key, value] of Object.entries(Workflow.prototype)) {
      if (typeof value === "function" && key !== "constructor") {
        const item = apiTag.createListItem("");
        item.createChild("span").createObjectTag(value);
      }
    }

    return body.toJsonML();
  }
}

interface WorkflowCreateObject {
  readonly workflowCreate: boolean;
  readonly constructor: { readonly runtype?: string; readonly type?: string };
  readonly type: string;
  inputSchema(): DataPortSchema;
  outputSchema(): DataPortSchema;
}

class CreateWorkflowConsoleFormatter extends ConsoleFormatter {
  header(obj: unknown, _config?: Config): JsonMLElementDef | null {
    const workflowObj = obj as WorkflowCreateObject;
    if (workflowObj.workflowCreate) {
      const header = new JsonMLElement("div");
      const name =
        workflowObj.constructor.runtype ??
        workflowObj.constructor.type ??
        workflowObj.type.replace(/Task$/, "");
      const inputSchema = workflowObj.inputSchema();
      const outputSchema = workflowObj.outputSchema();
      const inputProperties = getSchemaProperties(inputSchema);
      const outputProperties = getSchemaProperties(outputSchema);

      const inputs = inputProperties
        ? Object.keys(inputProperties).map((key) => `${key}: …`)
        : typeof inputSchema === "boolean"
          ? inputSchema
            ? ["…"] // true = accepts any
            : ["never"] // false = rejects all
          : [];

      const outputs = outputProperties
        ? Object.keys(outputProperties).map((key) => `${key}: …`)
        : typeof outputSchema === "boolean"
          ? outputSchema
            ? ["…"] // true = accepts any
            : ["never"] // false = rejects all
          : [];

      header.methodSignature(name);
      header.functionCall((el) => {
        el.objectBraces((innerObj) => {
          innerObj.inputText(`${inputs.join(", ")}`);
        });
      });
      header.greyText("): ");
      header.objectBraces((el) => {
        el.outputText(`${outputs.join(", ")}`);
      });

      return header.toJsonML();
    }
    return null;
  }

  hasBody(_value: unknown, _config?: Config): boolean {
    return false;
  }

  body(_obj: unknown, _config?: Config): JsonMLElementDef | null {
    return null;
  }
}

class TaskConsoleFormatter extends ConsoleFormatter {
  header(task: Task, config?: Config): JsonMLElementDef | null {
    if (!task) return null;

    if (
      task instanceof Task &&
      task.inputSchema &&
      task.outputSchema &&
      task.runInputData &&
      task.runOutputData
    ) {
      const header = new JsonMLElement("div");
      let name = task.type ?? task.constructor.name;
      if ((config as { workflow?: unknown })?.workflow) name = name.replace(/Task$/, "");
      const inputSchema = task.inputSchema();
      const outputSchema = task.outputSchema();
      const inputProperties = getSchemaProperties(inputSchema);
      const outputProperties = getSchemaProperties(outputSchema);

      const inputs = inputProperties
        ? Object.keys(inputProperties)
            .filter((key) => task.runInputData[key] !== undefined)
            .map((key) => {
              const value = task.runInputData[key];
              return { name: key, value };
            })
        : typeof inputSchema === "boolean" && inputSchema
          ? Object.keys(task.runInputData || {})
              .filter((key) => task.runInputData[key] !== undefined)
              .map((key) => {
                const value = task.runInputData[key];
                return { name: key, value };
              })
          : [];

      const outputs = outputProperties
        ? Object.keys(outputProperties)
            .filter(
              (key) => task.runOutputData[key] !== undefined && task.runOutputData[key] !== ""
            )
            .filter(
              (key) =>
                !(Array.isArray(task.runOutputData[key]) && task.runOutputData[key].length === 0)
            )
            .map((key) => {
              return { name: key, value: task.runOutputData[key] };
            })
        : typeof outputSchema === "boolean" && outputSchema
          ? Object.keys(task.runOutputData || {})
              .filter(
                (key) => task.runOutputData[key] !== undefined && task.runOutputData[key] !== ""
              )
              .filter(
                (key) =>
                  !(Array.isArray(task.runOutputData[key]) && task.runOutputData[key].length === 0)
              )
              .map((key) => {
                return { name: key, value: task.runOutputData[key] };
              })
          : [];

      header.highlightText(name);
      header.functionCall((el) => {
        el.objectBraces((innerObj) => {
          innerObj.parameterList(inputs);
        });
        el.greyText(", ");
        el.objectBraces((innerObj) => {
          innerObj.parameterList([{ name: "id", value: task.config.id }]);
        });
      });

      if (task.status === TaskStatus.COMPLETED) {
        header.greyText(": ");
        header.objectBraces((el) => {
          el.parameterList(outputs, true);
        });
      }
      return header.toJsonML();
    }
    return null;
  }

  hasBody(task: unknown, _config?: Config): boolean {
    return task instanceof Task;
  }

  body(task: Task, config?: Config): JsonMLElementDef | null {
    if (!task) return null;
    if (!(task instanceof Task)) return null;

    const body = new JsonMLElement("div").setStyle("padding-left: 10px;");

    const inputs = body.createStyledList("Inputs:");
    const allInboundDataflows = (config as { graph?: TaskGraph })?.graph?.getSourceDataflows(
      task.config.id
    );

    const inputSchema = task.inputSchema();
    const inputProperties = getSchemaProperties(inputSchema);
    const schemaKeys =
      inputProperties !== null
        ? Object.keys(inputProperties)
        : inputSchema === true
          ? Object.keys(task.runInputData || {})
          : [];

    for (const key of schemaKeys) {
      const value = task.runInputData[key];
      const li = inputs.createListItem("", "padding-left: 20px;");
      li.inputText(`${key}: `);
      const inputInboundDataflows = allInboundDataflows?.filter((e) => e.targetTaskPortId === key);
      if (inputInboundDataflows) {
        const sources: string[] = [];
        const sourceValues: unknown[] = [];
        inputInboundDataflows.forEach((df) => {
          const sourceTask = (config as { graph?: TaskGraph })?.graph?.getTask(df.sourceTaskId);
          sources.push(`${sourceTask?.type}->Output{${df.sourceTaskPortId}}`);
          if (df.status === TaskStatus.COMPLETED) {
            sourceValues.push(df.value);
          }
        });
        if (sources.length > 1) {
          if (sourceValues.length > 0) {
            li.createValueObject(sourceValues);
            li.createTextChild(" ");
          }
          li.createTextChild(`from [${sources.join(", ")}]`);
        } else if (sources.length === 1) {
          if (sourceValues.length > 0) {
            li.createValueObject(sourceValues[0]);
            li.createTextChild(" ");
          }
          li.createTextChild("from " + sources[0]);
        } else {
          li.createValueObject(value);
        }
      } else {
        li.createValueObject(value);
      }
    }

    const outputsList = body.createStyledList("Outputs:");
    const outputSchema = task.outputSchema();
    const outputProperties = getSchemaProperties(outputSchema);
    const outputKeys =
      outputProperties !== null
        ? Object.keys(outputProperties)
        : outputSchema === true
          ? Object.keys(task.runOutputData || {})
          : [];

    for (const key of outputKeys) {
      const value = task.runOutputData[key];
      const li = outputsList.createListItem("", "padding-left: 20px;");
      li.outputText(`${key}: `);
      li.createValueObject(value);
    }

    const taskConfig = body.createStyledList("Config:");
    for (const [key, value] of Object.entries(task.config)) {
      if (value === undefined) continue;
      const li = taskConfig.createListItem("", "padding-left: 20px;");
      li.inputText(`${key}: `);
      li.createValueObject(value);
    }

    body.createStatusListItem(task.status);

    if (task.startedAt || task.completedAt) {
      const timing = body.createStyledList("Timing:");
      if (task.startedAt) {
        const li = timing.createListItem("", "padding-left: 20px;");
        li.inputText("startedAt: ");
        li.createTextChild(task.startedAt.toISOString());
      }
      if (task.completedAt) {
        const li = timing.createListItem("", "padding-left: 20px;");
        li.inputText("completedAt: ");
        li.createTextChild(task.completedAt.toISOString());
      }
      if (task.startedAt && task.completedAt) {
        const durationMs = task.completedAt.getTime() - task.startedAt.getTime();
        const li = timing.createListItem("", "padding-left: 20px;");
        li.highlightText("duration: ");
        li.createTextChild(formatDuration(durationMs));
      }
    }

    // @ts-expect-error internal DAG handle is not on public types
    const dag = task.subGraph?._dag;

    if (dag && dag.getNodes().length > 0) body.createObjectTag(dag);

    return body.toJsonML();
  }
}

class DAGConsoleFormatter extends ConsoleFormatter {
  header(obj: unknown, _config?: Config): JsonMLElementDef | null {
    if (obj instanceof DirectedAcyclicGraph) {
      const header = new JsonMLElement("div");
      header.createTextChild("DAG");
      return header.toJsonML();
    }
    return null;
  }

  hasBody(_value: unknown, _config?: Config): boolean {
    return true;
  }

  body(obj: unknown, _config?: Config): JsonMLElementDef {
    const body = new JsonMLElement("div");
    body.createStyledList();
    const dag = obj as DirectedAcyclicGraph<NodeWithConfig, unknown, string, unknown>;
    if (dag.getNodes().length > 0) {
      const { dataURL, height } = generateGraphImage(dag);
      if (dataURL) {
        const imageTag = body.createChild("div");
        imageTag.addAttribute(
          "style",
          `background-image: url(${dataURL}); background-size: cover; background-position: center; width: 800px; height: ${height}px;`
        );
      }
    }
    return body.toJsonML();
  }
}

class DataflowConsoleFormatter extends ConsoleFormatter {
  header(obj: unknown, _config?: Config): JsonMLElementDef | null {
    if (obj instanceof Dataflow) {
      const header = new JsonMLElement("div");
      header.highlightText("Dataflow ");
      header.inputText(`${obj.sourceTaskId}.${obj.sourceTaskPortId}`);
      header.createTextChild(" -> ");
      header.outputText(`${obj.targetTaskId}.${obj.targetTaskPortId}`);
      if (obj.status === TaskStatus.COMPLETED) {
        header.greyText(" = ");
        header.createValueObject(obj.value);
      }
      return header.toJsonML();
    }
    return null;
  }

  hasBody(_value: unknown, _config?: Config): boolean {
    return true;
  }

  body(_obj: unknown, _config?: Config): JsonMLElementDef | null {
    return null;
  }
}

interface ReactElement {
  readonly $$typeof?: { toString(): string };
  readonly displayName?: string;
  readonly type?: {
    readonly $$typeof?: { toString(): string };
    readonly displayName?: string;
    readonly name?: string;
    readonly type?: {
      readonly displayName?: string;
      readonly name?: string;
    };
  };
  readonly key?: string;
  readonly props?: Record<string, unknown>;
}

class ReactElementConsoleFormatter extends ConsoleFormatter {
  header(obj: unknown, config?: Config): JsonMLElementDef | null {
    const reactEl = obj as ReactElement;
    if (
      reactEl?.$$typeof?.toString() === "Symbol(react.transitional.element)" &&
      !(config as { parent?: unknown })?.parent
    ) {
      const header = new JsonMLElement("div");
      const isMemo = reactEl.type?.$$typeof?.toString() === "Symbol(react.memo)";
      const name = !isMemo
        ? reactEl.displayName || reactEl.type?.displayName || reactEl.type?.name
        : reactEl.type?.type?.displayName || reactEl.type?.type?.name;
      header.greyText(`<`);
      header.sectionHeader(`${name}`);
      header.greyText(`/>`);
      if (reactEl.key) {
        header.createTextChild(" ");
        header.inputText(`key={${reactEl.key}}`);
      }
      if (isMemo) {
        header.createTextChild(" ");
        header.pill(`Memo`);
      }
      // header.createObjectTag(obj, { parent: obj });
      return header.toJsonML();
    }
    return null;
  }

  hasBody(_value: unknown, _config?: Config): boolean {
    return true;
  }

  body(obj: unknown, _config?: Config): JsonMLElementDef {
    const body = new JsonMLElement("div");
    const props = body.createStyledList("Props:");
    const reactEl = obj as ReactElement;
    props.propertyBlock(reactEl.props ?? {});
    return body.toJsonML();
  }
}

class JsonMLElement {
  _attributes: Record<string, unknown>;
  _jsonML: JsonMLElementDef;

  // Color constants
  static getColors(): {
    readonly grey: string;
    readonly inputColor: string;
    readonly outputColor: string;
    readonly yellow: string;
    readonly undefined: string;
  } {
    const dark = isDarkMode();
    return {
      grey: dark ? "#aaa" : "#333",
      inputColor: dark ? "#ada" : "#363",
      outputColor: dark ? "#caa" : "#633",
      yellow: dark ? "#f3ce49" : "#a68307",
      undefined: "#888",
    };
  }

  constructor(tagName: JsonMLTagName) {
    this._attributes = {};
    this._jsonML = [tagName, this._attributes];
  }

  // Add a helper method for creating colored text in one call
  coloredText(text: string, color: string): JsonMLElement {
    this.createChild("span").setStyle(`color:${color};`).createTextChild(text);
    return this;
  }

  // Helper for creating styled text with any style
  styledText(text: string, style: string): JsonMLElement {
    this.createChild("span").setStyle(style).createTextChild(text);
    return this;
  }

  // Helper specifically for input-colored text
  inputText(text: string): JsonMLElement {
    const colors = JsonMLElement.getColors();
    return this.coloredText(text, colors.inputColor);
  }

  // Helper specifically for output-colored text
  outputText(text: string): JsonMLElement {
    const colors = JsonMLElement.getColors();
    return this.coloredText(text, colors.outputColor);
  }

  // Helper for grey text which is commonly used
  greyText(text: string): JsonMLElement {
    const colors = JsonMLElement.getColors();
    return this.coloredText(text, colors.grey);
  }

  // Helper for yellow/highlight text
  highlightText(text: string): JsonMLElement {
    const colors = JsonMLElement.getColors();
    return this.coloredText(text, colors.yellow);
  }

  // Helper for creating a section header
  sectionHeader(text: string): JsonMLElement {
    return this.styledText(text, "font-weight: bold;");
  }

  pill(text: string): JsonMLElement {
    return this.styledText(
      text,
      "color: #009; background-color: #ccf; padding: 2px 4px; border-radius: 4px; font-size: 0.7em;"
    );
  }

  // Helper for creating a method signature
  methodSignature(name: string, params: string = ""): JsonMLElement {
    const colors = JsonMLElement.getColors();
    this.styledText("." + name, `font-weight: bold;color:${colors.yellow}`);
    if (params) this.greyText(`(${params})`);
    return this;
  }

  // Helper for creating a parameter list with input/output coloring
  parameterList(
    params: ReadonlyArray<{ readonly name: string; readonly value: unknown }>,
    isOutput: boolean = false
  ): JsonMLElement {
    params.forEach((param, i) => {
      if (i > 0) this.greyText(`, `);
      if (isOutput) {
        this.outputText(param.name);
      } else {
        this.inputText(param.name);
      }
      this.greyText(`: `);
      this.createValueObject(param.value);
    });
    return this;
  }

  // Helper for creating a parameter list with coloring
  propertyBlock(params: Record<string, unknown>): JsonMLElement {
    for (const [key, value] of Object.entries(params)) {
      const item = this.createListItem("");
      item.inputText(key);
      item.greyText(`: `);
      item.createValueObject(value);
    }
    return this;
  }

  // Helper for creating list items with padding
  createListItem(text: string, style?: string): JsonMLElement {
    const li = this.createChild("li").setStyle(`padding-left: 10px;${style ? " " + style : ""}`);
    if (text) li.createTextChild(text);
    return li;
  }

  // Helper for creating highlighted list items (commonly used in API sections)
  createHighlightedListItem(text: string): JsonMLElement {
    const colors = JsonMLElement.getColors();
    this.createChild("li")
      .setStyle(`color:${colors.yellow}; padding-left: 10px;`)
      .createTextChild(text);
    return this;
  }

  createStatusListItem(text: string): JsonMLElement {
    this.createStyledList("Status: ");
    let color = "grey";
    switch (text) {
      case TaskStatus.COMPLETED:
        color = "green";
        break;
      case TaskStatus.ABORTING:
      case TaskStatus.FAILED:
        color = "red";
        break;
      default:
        color = "grey";
    }
    return this.createListItem(text, `padding-left: 30px;color: ${color};`);
  }

  // Helper for creating a styled list
  createStyledList(title?: string): JsonMLElement {
    const list = this.createChild("ol").setStyle("list-style-type: none; padding-left: 10px;");
    if (title) list.createTextChild(title);
    return list;
  }

  // Helper for creating an object-like structure with braces
  objectBraces(content: (element: JsonMLElement) => void): JsonMLElement {
    this.greyText("{ ");
    content(this);
    this.greyText(" }");
    return this;
  }

  // Helper for creating a function call-like structure with parentheses
  functionCall(content: (element: JsonMLElement) => void): JsonMLElement {
    this.greyText("(");
    content(this);
    this.greyText(")");
    return this;
  }

  createChild(tagName: JsonMLTagName): JsonMLElement {
    const c = new JsonMLElement(tagName);
    this._jsonML.push(c.toJsonML());
    return c;
  }

  createObjectTag(object: unknown, config?: Config): JsonMLElement {
    const tag = this.createChild("object");
    tag.addAttribute("object", object);
    if (config) {
      tag.addAttribute("config", config);
    }
    return tag;
  }

  createValueObject(value: unknown, config?: Config): JsonMLElement {
    if (Array.isArray(value)) return this.createArrayChild(value, config);
    if (typeof value === "undefined") {
      const colors = JsonMLElement.getColors();
      return this.createChild("span")
        .setStyle(`color:${colors.undefined};`)
        .createTextChild("undefined");
    }

    return this.createObjectTag(value, config);
  }

  setStyle(style: string): JsonMLElement {
    this._attributes["style"] = style;
    return this;
  }

  addAttribute(key: string, value: unknown): JsonMLElement {
    this._attributes[key] = value;
    return this;
  }

  createTextChild(text: string): JsonMLElement {
    this._jsonML.push(text + "");
    return this;
  }

  createArrayChild(array: readonly unknown[], config?: Config): JsonMLElement {
    const j = new JsonMLElement("span");
    j.createTextChild("[");
    for (let i = 0; i < array.length; ++i) {
      if (i != 0) j.createTextChild(", ");
      j.createValueObject(array[i], config);
    }
    j.createTextChild("]");
    this._jsonML.push(j.toJsonML());
    return j;
  }

  toJsonML(): JsonMLElementDef {
    return this._jsonML;
  }
}

interface NodeWithConfig {
  readonly config: { readonly id: string };
  readonly type?: string;
}

function computeLayout(
  graph: DirectedAcyclicGraph<NodeWithConfig, unknown, string, unknown>,
  canvasWidth: number
): {
  readonly positions: { readonly [id: string]: { readonly x: number; readonly y: number } };
  readonly requiredHeight: number;
} {
  const positions: { [id: string]: { x: number; y: number } } = {};
  const layers: Map<number, string[]> = new Map();
  const depths: { [id: string]: number } = {};

  // Compute depth (longest path from any root)
  for (const node of graph.topologicallySortedNodes()) {
    const incomingEdges = graph.inEdges(node.config.id).map(([from]) => from);
    const depth =
      incomingEdges.length > 0 ? Math.max(...incomingEdges.map((from) => depths[from])) + 1 : 0;
    depths[node.config.id] = depth;

    if (!layers.has(depth)) layers.set(depth, []);
    layers.get(depth)!.push(node.config.id);
  }

  // Compute spacing based on available canvas size
  const totalLayers = layers.size;
  const layerSpacing = totalLayers > 1 ? Math.max(canvasWidth / totalLayers, 150) : 150;

  // Determine the required height dynamically
  const maxNodesInLayer = Math.max(...Array.from(layers.values()).map((layer) => layer.length));
  const nodeSpacing = 100;
  const requiredHeight = maxNodesInLayer * nodeSpacing + 100; // Extra padding

  layers.forEach((layerNodes, layerIndex) => {
    const yStart = (requiredHeight - layerNodes.length * nodeSpacing) / 2;
    layerNodes.forEach((nodeId, index) => {
      positions[nodeId] = {
        x: layerIndex * layerSpacing + layerSpacing / 2,
        y: yStart + index * nodeSpacing,
      };
    });
  });

  return { positions, requiredHeight };
}

function generateGraphImage(
  graph: DirectedAcyclicGraph<NodeWithConfig, unknown, string, unknown>,
  width = 800
): { readonly dataURL: string; readonly height: number } {
  const ratio = window.devicePixelRatio || 1;
  const { positions, requiredHeight } = computeLayout(graph, width);
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = requiredHeight * ratio;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    console.error("Canvas context is not available.");
    return { dataURL: "", height: requiredHeight };
  }
  ctx.scale(ratio, ratio);

  // Draw edges first
  ctx.clearRect(0, 0, width, requiredHeight);
  ctx.strokeStyle = "#aaa";
  ctx.lineWidth = 2;
  for (const [source, target] of graph.getEdges()) {
    const fromNode = positions[source];
    const toNode = positions[target];
    if (fromNode && toNode) {
      ctx.beginPath();
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);
      ctx.stroke();
    }
  }

  // Draw nodes over the edges
  ctx.fillStyle = "#3498db";
  for (const node of graph.getNodes()) {
    const pos = positions[node.config.id];
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "black";
    ctx.font = `12px Arial`;
    ctx.textAlign = "center";
    ctx.fillText(node.type ?? "", pos.x, pos.y - 15);
    ctx.fillStyle = "#3498db";
  }

  const dataURL = canvas.toDataURL("image/png");

  return { dataURL, height: requiredHeight };
}

declare global {
  interface Window {
    devtoolsFormatters?: ConsoleFormatter[];
  }
}

/**
 * Installs custom DevTools formatters for Workglow task graphs, workflows, and related objects.
 * Call this function once in your application to enable rich console output for debugging.
 *
 * @example
 * ```ts
 * import { installDevToolsFormatters } from "@workglow/task-graph";
 *
 * // Call early in your app initialization
 * installDevToolsFormatters();
 *
 * // Now console.log will show rich output for Workflow, Task, TaskGraph, etc.
 * console.log(myWorkflow);
 * ```
 */
export function installDevToolsFormatters(): void {
  window.devtoolsFormatters = window.devtoolsFormatters || [];
  window.devtoolsFormatters.push(
    new WorkflowAPIConsoleFormatter(),
    new CreateWorkflowConsoleFormatter(),
    new WorkflowConsoleFormatter(),
    new TaskConsoleFormatter(),
    new ReactElementConsoleFormatter(),
    new DataflowConsoleFormatter(),
    new DAGConsoleFormatter()
  );
}
