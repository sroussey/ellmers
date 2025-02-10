//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  TaskGraphBuilder,
  TaskInputDefinition,
  TaskOutputDefinition,
  TaskStatus,
} from "@ellmers/task-graph";

type Config = Record<string, any>;

type JsonMLTagName = string;

interface JsonMLAttributes {
  [key: string]: any;
}

type JsonMLNode = JsonMLText | JsonMLElementDef;

type JsonMLText = string;

type JsonMLElementDef = [JsonMLTagName, JsonMLAttributes?, ...JsonMLNode[]];

abstract class ConsoleFormatter {
  abstract header(value: any, config?: Config): JsonMLElementDef | null;
  abstract hasBody(value: any, config?: Config): boolean;
  abstract body(value: any, config?: Config): JsonMLElementDef;
}

export function isDarkMode() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export class TaskGraphBuilderConsoleFormatter extends ConsoleFormatter {
  header(obj: any, config?: Config) {
    if (obj instanceof TaskGraphBuilder) {
      const header = new JsonMLElement("div");
      header.createChild("span").setStyle("font-weight: bold;").createTextChild("TaskGraphBuilder");
      header
        .createChild("span")
        .setStyle("color: green; margin-left: 10px;")
        .createTextChild(`(${obj.graph.getNodes().length} nodes)`);
      if (obj._error) {
        header
          .createChild("span")
          .setStyle("color: red; margin-left: 10px;")
          .createTextChild(obj._error);
      }
      return header.toJsonML();
    }
    return null;
  }

  hasBody(value: any, config?: Config) {
    return true;
  }

  body(obj: any, config?: Config) {
    const body = new JsonMLElement("div");
    const dark = isDarkMode();
    const grey = dark ? "#aaa" : "#333";
    const inputColor = dark ? "#ada" : "#363";
    const outputColor = dark ? "#caa" : "#633";
    const yellow = dark ? "#f3ce49" : "#a68307";

    const api = body.createChild("ol").setStyle("list-style-type: none; padding-left: 10px;");
    api.createTextChild("API:");
    api
      .createChild("li")
      .setStyle(`color:${yellow}; padding-left: 10px;`)
      .createTextChild(".reset()");
    api
      .createChild("li")
      .setStyle(`color:${yellow}; padding-left: 10px;`)
      .createTextChild(".rename(outputName, inputName)");
    api
      .createChild("li")
      .setStyle(`color:${yellow}; padding-left: 10px;`)
      .createTextChild(".run()");

    for (const [key, value] of Object.entries(obj.constructor.prototype)) {
      const item = api.createChild("li").setStyle("padding-left: 10px;");
      item.createChild("span").createObjectTag(value).addAttribute("key", key);
    }

    const nodes = body.createChild("ol").setStyle("list-style-type: none; padding-left: 10px;");
    const tasks = obj._graph.getNodes();
    if (tasks.length) {
      nodes.createTextChild("Tasks:");
      for (const node of tasks) {
        const nodeTag = nodes
          .createChild("li")
          .setStyle("list-style-type: none; padding-left: 10px;");
        for (const [, , edge] of obj._graph.inEdges(node.config.id)) {
          const edgeTag = nodeTag.createChild("li").setStyle("padding-left: 20px;");
          if (edge.sourceTaskOutputId === edge.targetTaskInputId) continue;
          const num =
            tasks.findIndex((t) => t.config.id === edge.sourceTaskId) -
            tasks.findIndex((t) => t.config.id === node.config.id);
          edgeTag.createChild("span").setStyle(`color:${yellow};`).createTextChild(`rename`);
          edgeTag.createChild("span").setStyle(`color:${grey};`).createTextChild(`( "`);
          edgeTag
            .createChild("span")
            .setStyle(`color:${outputColor};`)
            .createTextChild(`${edge.sourceTaskOutputId}`);
          edgeTag.createChild("span").setStyle(`color:${grey};`).createTextChild(`", "`);
          edgeTag
            .createChild("span")
            .setStyle(`color:${inputColor};`)
            .createTextChild(`${edge.targetTaskInputId}`);
          edgeTag.createChild("span").setStyle(`color:${grey};`).createTextChild('"');
          if (num !== -1)
            edgeTag.createChild("span").setStyle(`color:${grey};`).createTextChild(`, ${num}`);
          edgeTag.createChild("span").setStyle(`color:${grey};`).createTextChild(")");
        }
        nodeTag.createObjectTag(node);
      }
    }
    return body.toJsonML();
  }
}

export class TaskGraphBuilderHelperConsoleFormatter extends ConsoleFormatter {
  header(obj: any, config?: Config) {
    const dark = isDarkMode();
    const inputColor = dark ? "#ada" : "#363";
    const outputColor = dark ? "#caa" : "#633";
    const grey = dark ? "#aaa" : "#333";
    const yellow = dark ? "#f3ce49" : "#a68307";

    if (obj.inputs && obj.outputs) {
      const header = new JsonMLElement("div");
      const name = obj.constructor.runtype ?? obj.constructor.type ?? obj.type.replace(/Task$/, "");
      const inputs = obj.inputs.map((i: TaskInputDefinition) => i.id + ": …");
      const outputs = obj.outputs.map((i: TaskOutputDefinition) => i.id + ": …");
      header
        .createChild("span")
        .setStyle(`font-weight: bold;color:${yellow}`)
        .createTextChild("." + name);
      header.createChild("span").setStyle(`color:${grey}`).createTextChild(`({ `);
      header
        .createChild("span")
        .setStyle(`color:${inputColor}`)
        .createTextChild(`${inputs.join(", ")}`);
      header.createChild("span").setStyle(`color:${grey}`).createTextChild(` }): { `);
      header
        .createChild("span")
        .setStyle(`color:${outputColor}`)
        .createTextChild(`${outputs.join(", ")}`);
      header.createChild("span").setStyle(`color:${grey}`).createTextChild(` }`);
      return header.toJsonML();
    }
    return null;
  }

  hasBody(value: any, config?: Config) {
    return false;
  }

  body(obj: any, config?: Config) {
    return null;
  }
}

export class TaskConsoleFormatter extends ConsoleFormatter {
  header(obj: any, config?: Config) {
    const dark = isDarkMode();
    const inputColor = dark ? "#ada" : "#363";
    const outputColor = dark ? "#caa" : "#633";
    const grey = dark ? "#aaa" : "#333";
    const yellow = dark ? "#f3ce49" : "#a68307";
    const classRef = obj.constructor;
    if (!classRef) return null;

    if (classRef.inputs && classRef.outputs) {
      const header = new JsonMLElement("div");
      const name = classRef.runtype ?? classRef.type ?? obj.type.replace(/Task$/, "");
      const inputs = obj.constructor.inputs
        .filter((i) => obj.runInputData[i.id] !== undefined)
        .map((i: TaskInputDefinition) => {
          return { name: i.id, value: obj.runInputData[i.id] };
        });
      const outputs = classRef.outputs
        .filter((i) => obj.runOutputData[i.id] !== undefined && obj.runOutputData[i.id] !== "")
        .filter(
          (i) => !(Array.isArray(obj.runOutputData[i.id]) && obj.runOutputData[i.id].length === 0)
        )
        .map((i: TaskInputDefinition) => {
          return { name: i.id, value: obj.runOutputData[i.id] };
        });
      header
        .createChild("span")
        .setStyle(`font-weight: bold;color:${yellow}`)
        .createTextChild(name);
      header.createChild("span").setStyle(`color:${grey}`).createTextChild(`({ `);
      inputs.forEach((input, i) => {
        if (i > 0) header.createChild("span").setStyle(`color:${grey}`).createTextChild(`, `);
        header.createChild("span").setStyle(`color:${inputColor}`).createTextChild(input.name);
        header.createChild("span").setStyle(`color:${grey}`).createTextChild(`: `);
        header.createValueObject(input.value);
      });
      header.createChild("span").setStyle(`color:${grey}`).createTextChild(` })`);
      if (obj.status === TaskStatus.COMPLETED) {
        header.createChild("span").setStyle(`color:${grey}`).createTextChild(": { ");
        outputs.forEach((output, i) => {
          if (i > 0) header.createChild("span").setStyle(`color:${grey}`).createTextChild(`, `);
          header.createChild("span").setStyle(`color:${outputColor}`).createTextChild(output.name);
          header.createChild("span").setStyle(`color:${grey}`).createTextChild(`: `);
          header.createValueObject(output.value);
        });
        header.createChild("span").setStyle(`color:${grey}`).createTextChild(" }");
      }
      return header.toJsonML();
    }
    return null;
  }

  hasBody(value: any, config?: Config) {
    return true;
  }

  body(obj: any, config?: Config) {
    const classRef = obj.constructor;
    if (!classRef) return null;
    const dark = isDarkMode();
    const inputColor = dark ? "#ada" : "#363";
    const outputColor = dark ? "#caa" : "#633";

    const body = new JsonMLElement("div").setStyle("padding-left: 10px;");

    const inputs = body.createChild("ol").setStyle("list-style-type: none; padding-left: 15px;");
    inputs.createTextChild("Inputs:");
    for (const input of classRef.inputs) {
      const value = obj.runInputData[input.id];
      const li = inputs.createChild("li").setStyle(`padding-left: 20px;`);
      li.createChild("span").setStyle(`color:${inputColor};`).createTextChild(`${input.id}: `);
      li.createValueObject(value);
    }

    const outputs = body.createChild("ol").setStyle("list-style-type: none; padding-left: 15px;");
    outputs.createTextChild("Outputs:");
    for (const out of classRef.outputs) {
      const value = obj.runOutputData[out.id];
      const li = outputs.createChild("li").setStyle(`padding-left: 20px;`);
      li.createChild("span").setStyle(`color:${outputColor};`).createTextChild(`${out.id}: `);
      li.createValueObject(value);
    }

    return body.toJsonML();
  }
}

class JsonMLElement {
  _attributes: Record<string, any>;
  _jsonML: JsonMLElementDef;
  constructor(tagName: JsonMLTagName) {
    this._attributes = {};
    this._jsonML = [tagName, this._attributes];
  }

  createChild(tagName: JsonMLTagName) {
    const c = new JsonMLElement(tagName);
    this._jsonML.push(c.toJsonML());
    return c;
  }

  createObjectTag(object: any) {
    const tag = this.createChild("object");
    tag.addAttribute("object", object);
    return tag;
  }

  createValueObject(value: any) {
    if (Array.isArray(value)) return this.createArrayChild(value);
    if (typeof value === "undefined")
      return this.createChild("span").setStyle("color:#888;").createTextChild("undefined");

    return this.createObjectTag(value);
  }

  setStyle(style: string) {
    this._attributes["style"] = style;
    return this;
  }

  addAttribute(key: string, value: any) {
    this._attributes[key] = value;
    return this;
  }

  createTextChild(text: string) {
    this._jsonML.push(text + "");
  }

  createArrayChild(array: any[]) {
    const j = new JsonMLElement("span");
    j.createTextChild("[");
    for (let i = 0; i < array.length; ++i) {
      if (i != 0) j.createTextChild(", ");
      j.createValueObject(array[i]);
    }
    j.createTextChild("]");
    this._jsonML.push(j.toJsonML());
    return j;
  }

  toJsonML() {
    return this._jsonML;
  }
}
