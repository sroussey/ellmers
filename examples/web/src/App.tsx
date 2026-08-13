/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks } from "@workglow/ai";
import { registerHuggingFaceTransformers } from "@workglow/huggingface-transformers/ai";
import type { JsonTaskItem } from "@workglow/task-graph";
import {
  attachUsageRecorder,
  CACHE_REGISTRY,
  DefaultCacheRegistry,
  getTaskQueueRegistry,
  registerBaseTasks,
  TaskGraph,
  Workflow,
} from "@workglow/task-graph";
import { JsonTask, registerCommonTasks } from "@workglow/tasks";
import { registerTensorFlowMediaPipe } from "@workglow/tf-mediapipe/ai";
import { globalServiceRegistry, ServiceRegistry, uuid4 } from "@workglow/util";
import { ReactFlowProvider } from "@xyflow/react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./Resize";
import {
  dependencyJsonHasBoundaryTasks,
  graphFromDependencyJsonItems,
  stripBoundaryTasksFromDependencyJson,
} from "./dependencyJson";
import { GraphStoreStatus } from "./status/GraphStoreStatus";
import { OutputRepositoryStatus } from "./status/OutputRepositoryStatus";
import { QueuesStatus } from "./status/QueueStatus";
import { UsageStatus } from "./status/UsageStatus";
import {
  IndexedDbTaskGraphRepository,
  IndexedDbTaskOutputRepository,
  runUsageStorage,
} from "./storage";

// Task registrations must run before this module's top-level await loads the
// saved graph from IndexedDB — `createGraphFromGraphJSON` looks task classes
// up in `TaskRegistry` by string name, and the call in `main.tsx` runs *after*
// this module finishes evaluating (static imports with TLA evaluate fully
// before the importer's body).
registerBaseTasks();
registerCommonTasks();
registerAiTasks();

const JsonEditor = lazy(async () => {
  const { JsonEditor } = await import("./editor/JsonEditor");
  return { default: JsonEditor };
});

const RunGraphFlow = lazy(async () => {
  const { RunGraphFlow } = await import("./graph/RunGraphFlow");
  return { default: RunGraphFlow };
});

await registerTensorFlowMediaPipe({
  worker: () => new Worker(new URL("./worker_tfmp.ts", import.meta.url), { type: "module" }),
});
await registerHuggingFaceTransformers({
  worker: () => new Worker(new URL("./worker_hft.ts", import.meta.url), { type: "module" }),
});

const queueRegistry = getTaskQueueRegistry();
await queueRegistry.clearQueues();
await queueRegistry.startQueues();
const taskOutputCache = new IndexedDbTaskOutputRepository();
const taskGraphRepo = new IndexedDbTaskGraphRepository();
// Child of the global registry so model.repository / ai.provider.registry /
// resolvers (registered by @workglow/ai and the provider register*() calls
// above) stay visible. A bare `new Container()` isolates the run from them
// and TextClassificationTask.narrowInput fails with "Service not registered".
const cacheServices = new ServiceRegistry(
  globalServiceRegistry.container.createChildContainer()
);
cacheServices.registerInstance(
  CACHE_REGISTRY,
  new DefaultCacheRegistry({ deterministic: taskOutputCache })
);
const resetGraph = () => {
  const workflow = (window as any)["workflow"] as Workflow;
  // Demo flow: embed a sentence + classify its sentiment.
  //
  // We avoid seq2seq architectures (T5, m2m100) on purpose — the
  // `onnxruntime-web@1.26.0-dev` build that ships with
  // `@huggingface/transformers@4.2.0` has multiple optimizer-pass crashes
  // (MatMulNBits Q8 fusion, SimplifiedLayerNormFusion + fp16 cast insertion)
  // that fire reliably on encoder-decoder layer-norm patterns. Encoder-only
  // BERT-family models go through a different optimization path and load
  // cleanly.
  workflow
    .reset()
    .downloadModel({
      model: {
        model_id: "onnx:Xenova/all-MiniLM-L6-v2:fp16",
        // `capabilities` is what AiTask.gateOrThrow checks against the task's
        // `requires`. The `tasks: [...]` field used by older versions of this
        // example is just metadata — it is not what gets checked at runtime.
        capabilities: ["text.embedding"],
        provider: "HF_TRANSFORMERS_ONNX",
        provider_config: {
          pipeline: "feature-extraction",
          model_path: "Xenova/all-MiniLM-L6-v2",
          native_dimensions: 384,
          dtype: "fp16",
          device: "webgpu",
        },
      },
    })
    .textEmbedding({
      text: "The quick brown fox jumps over the lazy dog.",
    })
    .downloadModel({
      model: {
        model_id: "onnx:Xenova/distilbert-sst2:fp16",
        capabilities: ["text.classification"],
        provider: "HF_TRANSFORMERS_ONNX",
        provider_config: {
          pipeline: "text-classification",
          model_path: "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
          dtype: "fp16",
          device: "webgpu",
        },
      },
    })
    .textClassification({
      text: "I love this AI pipeline library — building workflows is really enjoyable.",
    })
    .rename("*", "classifications")
    .rename("*", "embedding", { index: -3 })
    .debugLog({ log_level: "info" });

  taskGraphRepo.saveTaskGraph("default", workflow.graph);
};

(window as any)["workflow"] = new Workflow();
let graph: TaskGraph | undefined;
try {
  graph = await taskGraphRepo.getTaskGraph("default");
} catch (error: any) {
  console.error("Task graph loading error, going to reset:", error.message);
  resetGraph();
  graph = (window as any)["workflow"].graph;
}

const wfForLoad = (window as any)["workflow"] as Workflow;
if (graph) {
  wfForLoad.graph = graph;
} else {
  resetGraph();
}

const dependencyJsonOpts = { withBoundaryNodes: false };
const depItems = wfForLoad.graph.toDependencyJSON(dependencyJsonOpts);
if (dependencyJsonHasBoundaryTasks(depItems)) {
  wfForLoad.graph = graphFromDependencyJsonItems(stripBoundaryTasksFromDependencyJson(depItems));
  taskGraphRepo.saveTaskGraph("default", wfForLoad.graph);
}

// console access. what happens there will be reflected in the UI
const setupWorkflow = async () => {
  const workflow = (window as any)["workflow"] as Workflow;
  const run = workflow.run.bind(workflow);
  workflow.run = async () => {
    console.log("Running task graph...");
    const runId = uuid4();
    const detachUsage = attachUsageRecorder(workflow.graph.usageAggregator, runUsageStorage, {
      runId,
    });
    try {
      const result = await run({}, { registry: cacheServices });
      console.log("Task graph complete.", workflow);
      return result;
    } catch (error: any) {
      console.error("Task graph error:", error.message, error.errors, error);
      throw error;
    } finally {
      // Awaited after run() resolves: run() owns the ResourceScope, so it has
      // already disposed the run's checkpoints and their storage charges have
      // been recorded by the time we detach.
      await detachUsage();
    }
  };

  workflow.on("changed", () => {
    taskGraphRepo.saveTaskGraph("default", workflow.graph);
  });
  workflow.on("reset", () => {
    taskGraphRepo.saveTaskGraph("default", workflow.graph);
  });
  taskGraphRepo.on("graph_cleared", () => {
    resetGraph();
  });
};
setupWorkflow();
let workflow: Workflow = (window as any)["workflow"] as Workflow;

const initialJsonObj: JsonTaskItem[] = workflow.toDependencyJSON(dependencyJsonOpts);
const initialJson = JSON.stringify(initialJsonObj, null, 2);

export const App = () => {
  const [graph, setGraph] = useState<TaskGraph>(workflow.graph);
  const [w, setWorkflow] = useState<Workflow>((window as any)["workflow"] as Workflow);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isAborting, setIsAborting] = useState<boolean>(false);
  const [jsonData, setJsonData] = useState<string>(initialJson);
  const [cacheEnabled, setCacheEnabled] = useState<boolean>(true);

  const handleCacheToggle = useCallback((enabled: boolean) => {
    setCacheEnabled(enabled);
    cacheServices.registerInstance(
      CACHE_REGISTRY,
      new DefaultCacheRegistry({ deterministic: enabled ? taskOutputCache : undefined })
    );
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (
        workflow !== (window as any)["workflow"] &&
        (window as any)["workflow"] instanceof Workflow
      ) {
        workflow = (window as any)["workflow"] as Workflow;
        setWorkflow(workflow);
        setupWorkflow();
      }
    }, 10);

    function listen() {
      setJsonData(JSON.stringify(workflow.toDependencyJSON(dependencyJsonOpts), null, 2));
      setGraph(workflow.graph);
    }
    workflow.on("changed", listen);
    workflow.on("reset", listen);
    listen();
    return () => {
      workflow.off("changed", listen);
      workflow.off("reset", listen);
      clearInterval(interval);
    };
  }, [w, cacheEnabled]);

  useEffect(() => {
    function start() {
      setIsRunning(true);
    }
    function complete() {
      setIsRunning(false);
      setIsAborting(false);
    }
    function abort() {
      setIsAborting(true);
    }
    workflow.on("start", start);
    workflow.on("complete", complete);
    workflow.on("error", complete);
    workflow.on("abort", abort);
    return () => {
      workflow.off("start", start);
      workflow.off("complete", complete);
      workflow.off("error", complete);
      workflow.off("abort", abort);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow]);

  const setNewJson = useCallback(
    (json: string) => {
      const task = new JsonTask({ defaults: { json } });
      if (task.hasChildren()) {
        workflow.graph = task.subGraph;
      } else {
        workflow.graph = new TaskGraph();
      }
      setJsonData(json);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workflow]
  );

  return (
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel>
        <ReactFlowProvider>
          <Suspense fallback={<div className="p-4 text-sm text-neutral-400">Loading graph…</div>}>
            <RunGraphFlow graph={graph} />
          </Suspense>
        </ReactFlowProvider>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="30%">
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel defaultSize="82%">
            <Suspense
              fallback={<div className="p-4 text-sm text-neutral-400">Loading editor…</div>}
            >
              <JsonEditor
                json={jsonData}
                onJsonChange={setNewJson}
                run={() => {
                  workflow.run();
                }}
                stop={() => workflow.abort()}
                running={isRunning}
                aborting={isAborting}
              />
            </Suspense>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel style={{ backgroundColor: "#222", color: "#bbb", padding: "10px" }}>
            <QueuesStatus />
            <hr className="my-2 border-[#777]" />
            <OutputRepositoryStatus
              repository={taskOutputCache}
              enabled={cacheEnabled}
              onToggle={handleCacheToggle}
            />
            <hr className="my-2 border-[#777]" />
            <GraphStoreStatus repository={taskGraphRepo} />
            <hr className="my-2 border-[#777]" />
            <UsageStatus graph={graph} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
