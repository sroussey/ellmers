/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MapTask, ReduceTask, WhileTask } from "@workglow/task-graph";
import {
  Dataflow,
  graphToWorkflowCode,
  resetMethodNameCache,
  TaskGraph,
  Workflow,
} from "@workglow/task-graph";
import {
  AddToSumTask,
  DoubleToResultTask as DoubleTask,
  ProcessItemTask,
  RefineTask,
  TestInputTask,
  TestOutputTask,
  TestSimpleTask,
} from "@workglow/task-graph/test";
import { deepEqual, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
// Import to register workflow prototype methods

// Import to register RAG and pipeline workflow prototype methods (side-effect imports)
import { registerAiTasks } from "@workglow/ai";
import { registerBaseTasks } from "@workglow/task-graph";
import { registerCommonTasks } from "@workglow/tasks";

export const registerTasks = () => {
  registerBaseTasks();
  registerCommonTasks({ fileSystemTasks: false });
  registerAiTasks();
};

/**
 * Helper: compare two graphs by their JSON representation (without boundary nodes).
 * Normalizes task IDs and focuses on structure + dataflow topology.
 */
function compareGraphStructure(
  graphA: TaskGraph,
  graphB: TaskGraph
): { tasksMatch: boolean; dataflowsMatch: boolean } {
  const jsonA = graphA.toJSON({ withBoundaryNodes: false });
  const jsonB = graphB.toJSON({ withBoundaryNodes: false });

  const typesA = jsonA.tasks.map((t) => t.type);
  const typesB = jsonB.tasks.map((t) => t.type);
  const tasksMatch = deepEqual(typesA, typesB);

  // Normalize dataflows by mapping task IDs to indices
  const idToIndexA = new Map(jsonA.tasks.map((t, i) => [t.id, i]));
  const idToIndexB = new Map(jsonB.tasks.map((t, i) => [t.id, i]));

  const normalizeDataflows = (dfs: typeof jsonA.dataflows, idToIndex: Map<unknown, number>) =>
    dfs
      .map((df) => ({
        sourceIdx: idToIndex.get(df.sourceTaskId),
        sourcePort: df.sourceTaskPortId,
        targetIdx: idToIndex.get(df.targetTaskId),
        targetPort: df.targetTaskPortId,
      }))
      .sort(
        (a, b) =>
          (a.sourceIdx ?? 0) - (b.sourceIdx ?? 0) ||
          a.sourcePort.localeCompare(b.sourcePort) ||
          (a.targetIdx ?? 0) - (b.targetIdx ?? 0) ||
          a.targetPort.localeCompare(b.targetPort)
      );

  const dfNormA = normalizeDataflows(jsonA.dataflows, idToIndexA);
  const dfNormB = normalizeDataflows(jsonB.dataflows, idToIndexB);
  const dataflowsMatch = deepEqual(dfNormA, dfNormB);

  return { tasksMatch, dataflowsMatch };
}

/**
 * Helper: rebuild a workflow by evaluating generated code.
 * The code is evaluated with `workflow` bound to a fresh Workflow instance.
 * Additional task classes can be passed as named bindings.
 */
function rebuildFromCode(code: string, taskBindings: Record<string, unknown> = {}): Workflow {
  const rebuilt = new Workflow();
  const bindingNames = Object.keys(taskBindings);
  const bindingValues = Object.values(taskBindings);
  // oxlint-disable-next-line typescript/no-implied-eval -- running the generated code is the assertion
  const fn = new Function("workflow", ...bindingNames, code);
  fn(rebuilt, ...bindingValues);
  return rebuilt;
}

describe("GraphToWorkflowCode", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  beforeAll(() => {
    registerTasks();
  });

  beforeEach(() => {
    resetMethodNameCache();
  });

  describe("basic code generation", () => {
    it("should generate code for a single task", () => {
      const workflow = new Workflow();
      workflow.addTask(TestSimpleTask, { input: "hello" });

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain("new Workflow()");
      expect(code).toContain("testSimple");
      expect(code).toContain('"hello"');
    });

    it("should generate code for a linear chain of tasks", () => {
      const workflow = new Workflow();
      workflow.addTask(TestSimpleTask, { input: "test" }).addTask(TestSimpleTask);

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain("testSimple");
      const matches = code.match(/testSimple/g);
      expect(matches).toHaveLength(2);
    });

    it("should generate code without declaration when option is false", () => {
      const workflow = new Workflow();
      workflow.addTask(TestSimpleTask, { input: "test" });

      const code = graphToWorkflowCode(workflow.graph, { includeDeclaration: false });

      expect(code).not.toContain("new Workflow()");
      expect(code).toContain("testSimple");
    });

    it("should use custom variable name", () => {
      const workflow = new Workflow();
      workflow.addTask(TestSimpleTask, { input: "test" });

      const code = graphToWorkflowCode(workflow.graph, { variableName: "wf" });

      expect(code).toContain("const wf = new Workflow()");
      expect(code).toContain("wf.testSimple");
    });

    it("should generate code for empty graph", () => {
      const graph = new TaskGraph();
      const code = graphToWorkflowCode(graph);
      expect(code).toBe("const workflow = new Workflow();");
    });
  });

  describe("rename handling", () => {
    it("should generate rename for different port names", () => {
      const workflow = new Workflow();
      workflow
        .addTask(TestOutputTask, { input: "test" })
        .rename("customOutput", "customInput")
        .addTask(TestInputTask);

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain('.rename("customOutput", "customInput")');
    });
  });

  describe("map task", () => {
    it("should generate map builder code", () => {
      const workflow = new Workflow();
      workflow.map({ maxIterations: "unbounded" }).addTask(ProcessItemTask).endMap();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".map(");
      expect(code).toContain("processItem");
      expect(code).toContain(".endMap()");
    });

    it("should generate map with config options", () => {
      const workflow = new Workflow();
      workflow
        .map({
          preserveOrder: false,
          concurrencyLimit: 5,
          flatten: true,
          maxIterations: "unbounded",
        })
        .addTask(ProcessItemTask)
        .endMap();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain("preserveOrder: false");
      expect(code).toContain("concurrencyLimit: 5");
      expect(code).toContain("flatten: true");
    });

    it("should not emit preserveOrder when default (true)", () => {
      const workflow = new Workflow();
      workflow
        .map({ preserveOrder: true, maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .endMap();

      const code = graphToWorkflowCode(workflow.graph);
      expect(code).not.toContain("preserveOrder");
    });

    it("should generate map with multiple inner tasks", () => {
      const workflow = new Workflow();
      workflow
        .map({ maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .addTask(DoubleTask)
        .endMap();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".map(");
      expect(code).toContain("processItem");
      expect(code).toContain(".endMap()");
    });
  });

  describe("forEach task", () => {
    it("should generate forEach builder code with inner task and endForEach", () => {
      const workflow = new Workflow();
      workflow.forEach({ maxIterations: "unbounded" }).addTask(ProcessItemTask).endForEach();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".forEach(");
      expect(code).toContain("processItem");
      expect(code).toContain(".endForEach()");
      // Must not fall through to a regular .addTask(ForEachTask) call
      expect(code).not.toContain("ForEachTask");
    });

    it("should emit maxIterations in forEach code", () => {
      const workflow = new Workflow();
      workflow.forEach({ maxIterations: 5 }).addTask(ProcessItemTask).endForEach();

      const code = graphToWorkflowCode(workflow.graph);
      expect(code).toContain("maxIterations: 5");
    });
  });

  describe("reduce task", () => {
    it("should generate reduce builder code", () => {
      const workflow = new Workflow();
      workflow
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(AddToSumTask)
        .endReduce();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".reduce(");
      expect(code).toContain("initialValue");
      expect(code).toContain("sum: 0");
      expect(code).toContain(".endReduce()");
    });
  });

  describe("while task", () => {
    it("should generate while builder code with serializable condition", () => {
      const workflow = new Workflow();
      workflow
        .while({
          conditionField: "quality",
          conditionOperator: "lt",
          conditionValue: "0.9",
          maxIterations: 20,
        })
        .addTask(RefineTask)
        .endWhile();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".while(");
      expect(code).toContain('conditionField: "quality"');
      expect(code).toContain('conditionOperator: "lt"');
      expect(code).toContain('conditionValue: "0.9"');
      expect(code).toContain("maxIterations: 20");
      expect(code).toContain(".endWhile()");
    });

    it("should handle while with function condition", () => {
      const workflow = new Workflow();
      workflow
        .while({
          condition: (output: { quality: number }) => output.quality < 0.9,
          maxIterations: 10,
        })
        .addTask(RefineTask)
        .endWhile();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".while(");
      expect(code).toContain("maxIterations: 10");
      expect(code).toContain("condition");
    });

    it("should round-trip explicit unbounded maxIterations", () => {
      const workflow = new Workflow();
      workflow
        .while({
          conditionField: "done",
          conditionOperator: "eq",
          conditionValue: "false",
          maxIterations: "unbounded",
        })
        .addTask(RefineTask)
        .endWhile();

      const code = graphToWorkflowCode(workflow.graph);
      expect(code).toContain('maxIterations: "unbounded"');
    });
  });

  describe("nested loops", () => {
    it("should generate map with while inside", () => {
      const workflow = new Workflow();
      workflow
        .map({ maxIterations: "unbounded" })
        .while({
          conditionField: "quality",
          conditionOperator: "lt",
          conditionValue: "0.9",
          maxIterations: 10,
        })
        .addTask(RefineTask)
        .endWhile()
        .endMap();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".map(");
      expect(code).toContain(".while(");
      expect(code).toContain(".endWhile()");
      expect(code).toContain(".endMap()");
    });

    it("should generate while with map inside", () => {
      const workflow = new Workflow();
      workflow
        .while({
          conditionField: "done",
          conditionOperator: "eq",
          conditionValue: "false",
          maxIterations: 5,
        })
        .map({ maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .endMap()
        .endWhile();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".while(");
      expect(code).toContain(".map(");
      expect(code).toContain(".endMap()");
      expect(code).toContain(".endWhile()");
    });

    it("should generate chained map then reduce", () => {
      const workflow = new Workflow();
      workflow
        .map({ concurrencyLimit: 1, maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .endMap()
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(AddToSumTask)
        .endReduce();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".map(");
      expect(code).toContain(".endMap()");
      expect(code).toContain(".reduce(");
      expect(code).toContain(".endReduce()");
    });

    it("should generate map -> rename -> reduce", () => {
      const workflow = new Workflow();
      workflow
        .map({ concurrencyLimit: 1, maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .endMap()
        .rename("processed", "currentItem")
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(AddToSumTask)
        .endReduce();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain('.rename("processed", "currentItem")');
    });
  });

  describe("group task", () => {
    it("should generate group builder code", () => {
      const workflow = new Workflow();
      workflow.group().addTask(TestSimpleTask, { input: "inner" }).endGroup();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".group(");
      expect(code).toContain("testSimple");
      expect(code).toContain(".endGroup()");
    });

    it("should generate group with inner chain", () => {
      const workflow = new Workflow();
      workflow
        .group()
        .addTask(TestSimpleTask, { input: "first" })
        .addTask(TestSimpleTask)
        .endGroup();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".group(");
      const matches = code.match(/testSimple/g);
      expect(matches).toHaveLength(2);
      expect(code).toContain(".endGroup()");
    });

    it("should generate group with map inside", () => {
      const workflow = new Workflow();
      workflow
        .group()
        .map({ maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .endMap()
        .endGroup();

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain(".group(");
      expect(code).toContain(".map(");
      expect(code).toContain(".endMap()");
      expect(code).toContain(".endGroup()");
    });

    it("should round-trip a group workflow", () => {
      const original = new Workflow();
      original.group().addTask(TestSimpleTask, { input: "grouped" }).endGroup();

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);
    });
  });

  describe("round-trip: workflow -> graph -> code -> workflow -> graph comparison", () => {
    it("should round-trip a simple linear chain", () => {
      const original = new Workflow();
      original.addTask(TestSimpleTask, { input: "test" }).addTask(TestSimpleTask);

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch, dataflowsMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);
      expect(dataflowsMatch).toBe(true);
    });

    it("should round-trip a chain with rename", () => {
      const original = new Workflow();
      original
        .addTask(TestOutputTask, { input: "test" })
        .rename("customOutput", "customInput")
        .addTask(TestInputTask);

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch, dataflowsMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);
      expect(dataflowsMatch).toBe(true);
    });

    it("should round-trip a map workflow", () => {
      const original = new Workflow();
      original.map({ maxIterations: "unbounded" }).addTask(ProcessItemTask).endMap();

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);

      const origMap = original.graph.getTasks()[0] as MapTask;
      const rebuiltMap = rebuilt.graph.getTasks()[0] as MapTask;
      expect(origMap.subGraph?.getTasks().length).toBe(rebuiltMap.subGraph?.getTasks().length);
    });

    it("should round-trip a reduce workflow", () => {
      const original = new Workflow();
      original
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(AddToSumTask)
        .endReduce();

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);

      const origReduce = original.graph.getTasks()[0] as ReduceTask;
      const rebuiltReduce = rebuilt.graph.getTasks()[0] as ReduceTask;
      expect(rebuiltReduce.initialValue).toEqual({ sum: 0 });
      expect(origReduce.subGraph?.getTasks().length).toBe(
        rebuiltReduce.subGraph?.getTasks().length
      );
    });

    it("should round-trip a while workflow with serializable condition", () => {
      const original = new Workflow();
      original
        .while({
          conditionField: "quality",
          conditionOperator: "lt",
          conditionValue: "0.9",
          maxIterations: 20,
        })
        .addTask(RefineTask)
        .endWhile();

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);

      const rebuiltWhile = rebuilt.graph.getTasks()[0] as WhileTask;
      expect(rebuiltWhile.maxIterations).toBe(20);
    });

    it("should round-trip nested map with while inside", () => {
      const original = new Workflow();
      original
        .map({ maxIterations: "unbounded" })
        .while({
          conditionField: "quality",
          conditionOperator: "lt",
          conditionValue: "0.9",
          maxIterations: 10,
        })
        .addTask(RefineTask)
        .endWhile()
        .endMap();

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);

      const origMap = original.graph.getTasks()[0] as MapTask;
      const rebuiltMap = rebuilt.graph.getTasks()[0] as MapTask;
      const origWhile = origMap.subGraph?.getTasks()[0] as WhileTask;
      const rebuiltWhile = rebuiltMap.subGraph?.getTasks()[0] as WhileTask;
      expect(origWhile.subGraph?.getTasks().length).toBe(rebuiltWhile.subGraph?.getTasks().length);
    });

    it("should round-trip chained map then reduce", () => {
      const original = new Workflow();
      original
        .map({ concurrencyLimit: 1, maxIterations: "unbounded" })
        .addTask(ProcessItemTask)
        .endMap()
        .reduce({ initialValue: { sum: 0 }, maxIterations: "unbounded" })
        .addTask(AddToSumTask)
        .endReduce();

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);
    });
  });

  describe("graph -> code -> workflow -> graph (starting from raw graph)", () => {
    it("should convert a manually built graph with simple chain", () => {
      const graph = new TaskGraph();
      const t1 = new TestSimpleTask({ defaults: { input: "hello" } });
      const t2 = new TestSimpleTask();
      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDataflow(new Dataflow(t1.id, "output", t2.id, "input"));

      const code = graphToWorkflowCode(graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      expect(rebuilt.graph.getTasks()).toHaveLength(2);
      expect(rebuilt.graph.getDataflows()).toHaveLength(1);
    });
  });

  describe("JSON round-trip: workflow -> graph -> JSON -> graph -> code -> workflow -> JSON", () => {
    it("should produce equivalent JSON after full round-trip", () => {
      const original = new Workflow();
      original.addTask(TestSimpleTask, { input: "roundtrip" }).addTask(TestSimpleTask);

      const originalJson = original.toJSON({ withBoundaryNodes: false });

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const rebuiltJson = rebuilt.toJSON({ withBoundaryNodes: false });

      expect(rebuiltJson.tasks.map((t) => t.type)).toEqual(originalJson.tasks.map((t) => t.type));
    });
  });

  describe("RAG pipeline workflows", () => {
    const embeddingModel = "onnx:Qwen3-Embedding-0.6B:auto";
    const summaryModel = "onnx:Falconsai/text_summarization:fp32";
    const nerModel = "onnx:onnx-community/NeuroBERT-NER-ONNX:q8";
    const kbName = "test-kb";

    it("should generate code for document ingestion pipeline", () => {
      const workflow = new Workflow()
        .input({ url: ["file:///test.md", "file:///test2.md"] })
        .map({ maxIterations: "unbounded" })
        .fileLoader({
          format: "markdown",
        })
        .structuralParser({
          title: "Test Document",
          format: "markdown",
          sourceUri: "/test.md",
        })
        .documentEnricher({
          generateSummaries: true,
          summaryModel,
          extractEntities: true,
          nerModel,
        })
        .hierarchicalChunker({
          maxTokens: 512,
          overlap: 50,
          strategy: "hierarchical",
        })
        .textEmbedding({
          model: embeddingModel,
        })
        .chunkVectorUpsert({
          knowledgeBase: kbName,
        })
        .endMap();

      expect(workflow.error).toBe("");

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain("fileLoader");
      expect(code).toContain("structuralParser");
      expect(code).toContain("documentEnricher");
      expect(code).toContain("hierarchicalChunker");
      expect(code).toContain("textEmbedding");
      expect(code).toContain("chunkVectorUpsert");

      expect(code).toContain('"markdown"');
      expect(code).toContain('"Test Document"');
      expect(code).toContain(`"${summaryModel}"`);
      expect(code).toContain(`"${nerModel}"`);
      expect(code).toContain(`"${embeddingModel}"`);
      expect(code).toContain(`"${kbName}"`);
      expect(code).toContain("512");
      expect(code).toContain("50");
    });

    it("should generate code for query retrieval pipeline", () => {
      const workflow = new Workflow()
        .chunkRetrieval({
          knowledgeBase: kbName,
          query: "What caused the Civil War?",
          model: embeddingModel,
          topK: 10,
          scoreThreshold: 0.1,
        })
        .reranker({
          query: "What caused the Civil War?",
          method: "simple",
          topK: 5,
        })
        .contextBuilder({
          format: "numbered",
          includeMetadata: false,
          separator: "\n\n---\n\n",
        });

      expect(workflow.error).toBe("");

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain("chunkRetrieval");
      expect(code).toContain("reranker");
      expect(code).toContain("contextBuilder");
      expect(code).toContain('"What caused the Civil War?"');
      expect(code).toContain('"simple"');
      expect(code).toContain('"numbered"');
    });

    it("should generate code for hierarchy join pipeline", () => {
      const workflow = new Workflow()
        .chunkRetrieval({
          knowledgeBase: kbName,
          query: "American Revolution",
          model: embeddingModel,
          topK: 3,
          scoreThreshold: 0.0,
        })
        .hierarchyJoin({
          knowledgeBase: kbName,
          includeParentSummaries: true,
          includeEntities: true,
        });

      expect(workflow.error).toBe("");

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain("chunkRetrieval");
      expect(code).toContain("hierarchyJoin");
      expect(code).toContain(`"${kbName}"`);
      expect(code).toContain("includeParentSummaries: true");
      expect(code).toContain("includeEntities: true");
    });

    it("should generate code for hybrid retrieval pipeline", () => {
      const workflow = new Workflow()
        .chunkRetrieval({
          knowledgeBase: kbName,
          query: "test query",
          model: embeddingModel,
          method: "hybrid",
          topK: 5,
        })
        .reranker({
          query: "test query",
          method: "simple",
          topK: 3,
        })
        .contextBuilder({
          format: "markdown",
        });

      expect(workflow.error).toBe("");

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain("chunkRetrieval");
      expect(code).toContain("reranker");
      expect(code).toContain("contextBuilder");
      expect(code).toContain('"test query"');
      expect(code).toContain('"markdown"');
      expect(code).toContain('"hybrid"');
    });

    it("should generate code for query expander workflow", () => {
      const workflow = new Workflow().queryExpander({
        query: "What were the major battles?",
        method: "multi-query",
        numVariations: 3,
      });

      expect(workflow.error).toBe("");

      const code = graphToWorkflowCode(workflow.graph);

      expect(code).toContain("queryExpander");
      expect(code).toContain('"What were the major battles?"');
      expect(code).toContain('"multi-query"');
      expect(code).toContain("numVariations: 3");
    });

    it("should round-trip document ingestion pipeline", () => {
      const original = new Workflow()
        .fileLoader({ url: "file:///test.md", format: "markdown" })
        .structuralParser({ title: "Test" })
        .documentEnricher({})
        .hierarchicalChunker({ maxTokens: 512 })
        .textEmbedding({ model: embeddingModel })
        .chunkVectorUpsert({ knowledgeBase: kbName });

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);
      expect(rebuilt.graph.getTasks()).toHaveLength(6);
      expect(rebuilt.graph.getDataflows().length).toBeGreaterThan(0);
    });

    it("should round-trip query retrieval pipeline", () => {
      const original = new Workflow()
        .chunkRetrieval({
          knowledgeBase: kbName,
          query: "test",
          model: embeddingModel,
        })
        .hierarchyJoin({ knowledgeBase: kbName })
        .reranker({
          query: "test",
          method: "simple",
          topK: 5,
        })
        .contextBuilder({ format: "numbered", includeMetadata: true });

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch, dataflowsMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);
      expect(dataflowsMatch).toBe(true);
    });

    it("should round-trip hybrid retrieval pipeline", () => {
      const original = new Workflow()
        .chunkRetrieval({
          knowledgeBase: kbName,
          query: "test query",
          model: embeddingModel,
          method: "hybrid",
          topK: 5,
        })
        .reranker({
          query: "test query",
          method: "simple",
          topK: 3,
        })
        .contextBuilder({ format: "markdown" });

      const code = graphToWorkflowCode(original.graph, { includeDeclaration: false });
      const rebuilt = rebuildFromCode(code);

      const { tasksMatch, dataflowsMatch } = compareGraphStructure(original.graph, rebuilt.graph);
      expect(tasksMatch).toBe(true);
      expect(dataflowsMatch).toBe(true);
    });
  });
});
