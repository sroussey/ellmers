import React, { Dispatch, SetStateAction, useEffect, useRef } from "react";
import {
  ReactFlow,
  Controls,
  useNodesState,
  useEdgesState,
  Node,
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";

import "@xyflow/react/dist/base.css";
import "./RunGraphFlow.css";
import { TurboNodeData, SingleNode, CompoundNode } from "./TurboNode";
import TurboEdge from "./TurboEdge";
import FunctionIcon from "./FunctionIcon";
import {
  JsonTask,
  Task,
  TaskGraph,
  TaskGraphRunner,
  registerHuggingfaceLocalTasksInMemory,
  registerMediaPipeTfJsLocalInMemory,
} from "ellmers-core/browser";
import { GraphPipelineLayout, computeLayout } from "./layout";

registerHuggingfaceLocalTasksInMemory();
registerMediaPipeTfJsLocalInMemory();

function convertGraphToNodes(graph: TaskGraph): Node<TurboNodeData>[] {
  const tasks = graph.getNodes();
  const nodes = tasks.flatMap((node, index) => {
    let n: Node<TurboNodeData>[] = [
      {
        id: node.config.id as string,
        position: { x: 0, y: 0 },
        data: {
          icon: <FunctionIcon />,
          title: (node.constructor as any).type,
          subline: node.config.name,
        },
        type: node.isCompound ? "compound" : "single",
      },
    ];
    if (node.isCompound) {
      const subNodes = convertGraphToNodes(node.subGraph).map((n) => {
        return {
          ...n,
          parentNode: node.config.id as string,
          extent: "parent" as Node<TurboNodeData>["extent"],
          selectable: false,
          connectable: false,
        };
      });
      n = [...n, ...subNodes];
    }
    return n;
  });
  return nodes;
}

function listenToNode(task: Task, setNodes: Dispatch<SetStateAction<Node<TurboNodeData>[]>>) {
  task.on("progress", (progress, progressText) => {
    setNodes((nds) =>
      nds.map((nd) => {
        if (nd.id === task.config.id) {
          return {
            ...nd,
            data: {
              ...nd.data,
              active: true,
              progress,
              progressText,
            },
          };
        }
        return nd;
      })
    );
  });
  task.on("start", () => {
    console.log("Node started", task.config.id);
    setNodes((nds) =>
      nds.map((nd) => {
        if (nd.id === task.config.id) {
          return {
            ...nd,
            data: {
              ...nd.data,
              active: true,
              progress: 1,
              progressText: "",
            },
          };
        }
        return nd;
      })
    );
  });
  task.on("complete", () => {
    console.log("Node completed", task.config.id);
    setNodes((nds) =>
      nds.map((nd) => {
        if (nd.id === task.config.id) {
          return {
            ...nd,
            data: {
              ...nd.data,
              active: false,
              progress: 100,
            },
          };
        }
        return nd;
      })
    );
  });
  if (task.isCompound) {
    listenToGraphNodes(task.subGraph, setNodes);
    task.on("regenerate", () => {
      console.log("Node regenerated", task.config.id);
      setNodes((nodess) => nodess.filter((n) => n.parentNode !== task.config.id));
      setNodes((nodes) =>
        nodes.concat(
          convertGraphToNodes(task.subGraph).map((n) => ({
            ...n,
            parentNode: task.config.id as string,
            extent: "parent",
            selectable: false,
            connectable: false,
          }))
        )
      );
      listenToGraphNodes(task.subGraph, setNodes);
    });
  }
}

function listenToGraphNodes(
  graph: TaskGraph,
  setNodes: Dispatch<SetStateAction<Node<TurboNodeData>[]>>
) {
  const nodes = graph.getNodes();
  for (const node of nodes) {
    listenToNode(node, setNodes);
  }
}

const nodeTypes = {
  single: SingleNode,
  compound: CompoundNode,
};

const edgeTypes = {
  turbo: TurboEdge,
};

const defaultEdgeOptions = {
  type: "turbo",
  markerEnd: "edge-circle",
};

export const RunGraphFlow: React.FC<{
  json: string;
  running: boolean;
  setIsRunning: (isRunning: boolean) => void;
}> = ({ json, running, setIsRunning }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TurboNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const oldJson = useRef<string>("");
  const graphRef = useRef<TaskGraph | null>(null);

  const initialized = useNodesInitialized() && !nodes.some((n) => !n.computed);
  // const { fitView } = useReactFlow();

  useEffect(() => {
    if (initialized) {
      setNodes(computeLayout(GraphPipelineLayout, nodes, edges) as Node<TurboNodeData>[]);
      // window.requestAnimationFrame(() => fitView());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  useEffect(() => {
    if (json !== oldJson.current) {
      const jsonTask = new JsonTask({ name: "Test JSON", input: { json } });
      oldJson.current = json;
      graphRef.current = jsonTask.subGraph;
      const nodes = convertGraphToNodes(jsonTask.subGraph);
      setNodes(nodes);

      setEdges(
        jsonTask.subGraph.getEdges().map(([source, target, edge]) => {
          return {
            id: edge.id,
            source: source as string,
            target: target as string,
          };
        })
      );
    }

    if (running) {
      const graph = graphRef.current;
      const runner = new TaskGraphRunner(graph);
      listenToGraphNodes(graph, setNodes);
      (async () => {
        await runner.runGraph();
        setIsRunning(false);
      })();
    }
  }, [running, json]);

  // const onConnect = useCallback(
  //   (params: any) => setEdges((els) => addEdge(params, els)),
  //   [setEdges]
  // );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      // onConnect={onConnect}
      // fitView
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
    >
      <Controls showInteractive={false} />

      <svg>
        <defs>
          <linearGradient id="edge-gradient">
            <stop offset="0%" stopColor="#ae53ba" />
            <stop offset="100%" stopColor="#2a8af6" />
          </linearGradient>

          <marker
            id="edge-circle"
            viewBox="-5 -5 10 10"
            refX="0"
            refY="0"
            markerUnits="strokeWidth"
            markerWidth="10"
            markerHeight="10"
            orient="auto"
          >
            <circle stroke="#2a8af6" strokeOpacity="0.75" r="2" cx="0" cy="0" />
          </marker>
        </defs>
      </svg>
    </ReactFlow>
  );
};
