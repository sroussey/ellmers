//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  SingleTask,
  TaskGraphBuilder,
  TaskGraphBuilderHelper,
  TaskRegistry,
} from "@ellmers/task-graph";
import { Document, DocumentFragment } from "../source/Document";
export type DocumentSplitterTaskInput = {
  parser: "txt" | "md";
  file: Document;
};
export type DocumentSplitterTaskOutput = {
  texts: string[];
};

export class DocumentSplitterTask extends SingleTask {
  static readonly type: string = "DocumentSplitterTask";
  static readonly category = "Input";
  declare runInputData: DocumentSplitterTaskInput;
  declare runOutputData: DocumentSplitterTaskOutput;
  public static inputs = [
    {
      id: "parser",
      name: "Kind",
      valueType: "doc_parser",
      defaultValue: "txt",
    },
    {
      id: "file",
      name: "File",
      valueType: "document",
    },
    // {
    //   id: "variant",
    //   name: "Variant",
    //   valueType: "doc_variant",
    //   defaultValue: "tree",
    // },
  ] as const;
  public static outputs = [
    {
      id: "texts",
      name: "Texts",
      valueType: "text",
      isArray: true,
    },
  ] as const;

  flattenFragmentsToTexts(item: DocumentFragment | Document): string[] {
    if (item instanceof Document) {
      const texts: string[] = [];
      item.fragments.forEach((fragment) => {
        texts.push(...this.flattenFragmentsToTexts(fragment));
      });
      return texts;
    } else {
      return [item.content];
    }
  }

  async runReactive(): Promise<DocumentSplitterTaskOutput> {
    return { texts: this.flattenFragmentsToTexts(this.runInputData.file) };
  }
}
TaskRegistry.registerTask(DocumentSplitterTask);

const DocumentSplitterBuilder = (input: Partial<DocumentSplitterTaskInput>) => {
  return new DocumentSplitterTask({ input });
};

export const DocumentSplitter = (input: DocumentSplitterTaskInput) => {
  return DocumentSplitterBuilder(input).run();
};

declare module "@ellmers/task-graph" {
  interface TaskGraphBuilder {
    DocumentSplitter: TaskGraphBuilderHelper<DocumentSplitterTask>;
  }
}

TaskGraphBuilder.prototype.DocumentSplitter = TaskGraphBuilderHelper(DocumentSplitterTask);
