import {
  TaskBase,
  TaskGraphBuilder,
  TaskInputDefinition,
  TaskOutputDefinition,
  TaskStatus,
} from "ellmers-core/browser";

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
        .createTextChild(`(${obj._graph.getNodes().length} nodes)`);
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
      .createTextChild(".connect(outputName, inputName)");
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
        nodeTag.createObjectTag(node);
        for (const [, , edge] of obj._graph.outEdges(node.config.id)) {
          const edgeTag = nodeTag.createChild("li").setStyle("padding-left: 20px;");
          edgeTag.createTextChild(
            `connection: ${edge.sourceTaskOutputId} -> ${edge.targetTaskInputId}`
          );
        }
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
      header.createChild("span").setStyle(`color:${grey}`).createTextChild(`({`);
      header
        .createChild("span")
        .setStyle(`color:${inputColor}`)
        .createTextChild(`${inputs.join(", ")}`);
      header.createChild("span").setStyle(`color:${grey}`).createTextChild(`}): {`);
      header
        .createChild("span")
        .setStyle(`color:${outputColor}`)
        .createTextChild(`${outputs.join(", ")}`);
      header.createChild("span").setStyle(`color:${grey}`).createTextChild(`}`);
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
        .map((i: TaskInputDefinition) => i.id + ": " + obj.runInputData[i.id]);
      const outputs = classRef.outputs
        .filter((i) => obj.runOutputData[i.id] !== undefined && obj.runOutputData[i.id] !== "")
        .map((i: TaskOutputDefinition) => i.id + ": " + obj.runOutputData[i.id]);
      header
        .createChild("span")
        .setStyle(`font-weight: bold;color:${yellow}`)
        .createTextChild(name);
      header.createChild("span").setStyle(`color:${grey}`).createTextChild(`({`);
      header
        .createChild("span")
        .setStyle(`color:${inputColor}`)
        .createTextChild(`${inputs.join(", ")}`);
      header.createChild("span").setStyle(`color:${grey}`).createTextChild(`})`);
      if (obj.status === TaskStatus.COMPLETED) {
        header.createChild("span").setStyle(`color:${grey}`).createTextChild(`: {`);
        header
          .createChild("span")
          .setStyle(`color:${outputColor}`)
          .createTextChild(`${outputs.join(", ")}`);
        header.createChild("span").setStyle(`color:${grey}`).createTextChild(`}`);
      }
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

class Formatter extends ConsoleFormatter {
  description(object: any) {
    if (typeof object === "object" && object)
      return object.constructor.type ?? object.constructor.name;
    return object;
  }

  hasChildren(object: any) {
    return typeof object === "object";
  }

  children(object: any) {
    const result = [];
    for (const key in object) result.push({ key: key, value: object[key] });
    return result;
  }

  header(object: any, config?: Config) {
    if (object instanceof Node) return null;

    const header = new JsonMLElement("span");
    header.createTextChild(this.description(object));
    return header.toJsonML();
  }

  hasBody(object: any, config?: Config) {
    if (object instanceof Array) return false;
    return this.hasChildren(object);
  }

  body(object: any, config?: Config) {
    const body = new JsonMLElement("ol");
    body.setStyle(
      "list-style-type:none; padding-left: 0px; margin-top: 0px; margin-bottom: 0px; margin-left: 12px"
    );
    const children = this.children(object);
    for (let i = 0; i < children.length; ++i) {
      const child = children[i];
      const li = body.createChild("li");
      let objectTag;
      if (typeof child.value === "object") objectTag = li.createObjectTag(child.value);
      else objectTag = li.createChild("span");

      const nameSpan = objectTag.createChild("span");
      nameSpan.createTextChild(child.key + ": ");
      nameSpan.setStyle("color: rgb(136, 19, 145); background-color: #bada55");
      if (child.value instanceof Node) {
        const node = child.value;
        objectTag.createTextChild(node.nodeName.toLowerCase());
        if (node.id) objectTag.createTextChild("#" + node.id);
        else objectTag.createTextChild("." + node.className);
      }
      if (typeof child.value !== "object") objectTag.createTextChild("" + child.value);
    }
    return body.toJsonML();
  }

  _arrayFormatter(array) {
    const j = new JsonMLElement("span");
    j.createTextChild("[");
    for (let i = 0; i < array.length; ++i) {
      if (i != 0) j.createTextChild(", ");
      j.createObjectTag(array[i]);
    }
    j.createTextChild("]");
    return j;
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

  toJsonML() {
    return this._jsonML;
  }
}
