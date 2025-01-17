//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  Document,
  DocumentFragment,
  SingleTask,
  TaskGraphBuilder,
  TaskGraphBuilderHelper,
  CreateMappedType,
  TaskRegistry,
} from "ellmers-core";

export type DocumentSplitterTaskInput = CreateMappedType<typeof DocumentSplitterTask.inputs>;
export type DocumentSplitterTaskOutput = CreateMappedType<typeof DocumentSplitterTask.outputs>;

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

  runReactive(): DocumentSplitterTaskOutput {
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

declare module "ellmers-core" {
  interface TaskGraphBuilder {
    DocumentSplitter: TaskGraphBuilderHelper<DocumentSplitterTask>;
  }
}

TaskGraphBuilder.prototype.DocumentSplitter = TaskGraphBuilderHelper(DocumentSplitterTask);
