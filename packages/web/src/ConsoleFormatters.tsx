import { TaskGraphBuilder } from "ellmers-core/browser";

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
    const body = new JsonMLElement("ol").setStyle("list-style-type: none; padding-left: 10px;");
    for (const [key, value] of Object.entries(obj.constructor.prototype)) {
      const item = body.createChild("li").setStyle("list-style-type: none; padding-left: 10px;");
      item.createChild("span").createTextChild(".");
      item.createObjectTag(value, key);
    }

    return body.toJsonML();
  }
}

export class TaskGraphBuilderTaskFormatter extends ConsoleFormatter {
  header(obj: any, config?: Config) {
    if ((obj.inputs && obj.outputs) || (obj.constructor.inputs && obj.constructor.outputs)) {
      const header = new JsonMLElement("div");
      const name = obj.constructor.runtype ?? obj.constructor.type ?? obj.type.replace(/Task$/, "");
      const inputs = (obj.inputs ?? obj.constructor.inputs).map((i) => i.id + ": ...");
      const outputs = (obj.outputs ?? obj.constructor.outputs).map((i) => i.id + ": ...");
      header.createChild("span").setStyle("font-weight: bold;color:#f3ce49").createTextChild(name);
      header
        .createChild("span")
        .setStyle("color:#ddd;")
        .createTextChild(`({${inputs.join(", ")}})`);
      header
        .createChild("span")
        .setStyle("color:#ccc;")
        .createTextChild(`: {${outputs.join(", ")}}`);
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

  createObjectTag(object: any, key?: string) {
    const tag = this.createChild("object");
    tag.addAttribute("object", object);
    if (key) tag.addAttribute("key", key);
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
