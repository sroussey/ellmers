import React, { useEffect, useRef } from "react";
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
import TurboNode, { TurboNodeData } from "./TurboNode";
import TurboEdge from "./TurboEdge";
import FunctionIcon from "./FunctionIcon";
import {
  JsonTask,
  TaskGraph,
  TaskGraphRunner,
  registerHuggingfaceLocalTasksInMemory,
  registerMediaPipeTfJsLocalInMemory,
} from "ellmers-core/browser";
import { GraphPipelineLayout, computeLayout } from "./layout";

registerHuggingfaceLocalTasksInMemory();
registerMediaPipeTfJsLocalInMemory();

const nodeTypes = {
  turbo: TurboNode,
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
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const oldJson = useRef<string>("");
  const graphRef = useRef<TaskGraph | null>(null);

  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (initialized && nodes[0]?.computed) {
      setNodes(computeLayout(GraphPipelineLayout, nodes, edges) as Node<TurboNodeData>[]);
      window.requestAnimationFrame(() => fitView());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, nodes[0]?.computed]);

  useEffect(() => {
    if (json !== oldJson.current) {
      const jsonTask = new JsonTask({ name: "Test JSON", input: { json } });
      oldJson.current = json;
      graphRef.current = jsonTask.subGraph;
      const tasks = jsonTask.subGraph.getNodes();
      setNodes(
        tasks.map((node, index) => {
          return {
            id: node.config.id,
            position: { x: 0, y: 0 },
            data: {
              icon: <FunctionIcon />,
              title: (node.constructor as any).type,
              subline: node.config.name,
            },
            type: "turbo",
          };
        }) as Node<TurboNodeData>[]
      );
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
      console.log("Running graph");
      const graph = graphRef.current;
      const runner = new TaskGraphRunner(graph);
      graph.getNodes().forEach((node) => {
        node.on("progress", (progress, progressText) => {
          setNodes((nds) =>
            nds.map((nd) => {
              if (nd.id === node.config.id) {
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
        node.on("start", () => {
          setNodes((nds) =>
            nds.map((nd) => {
              if (nd.id === node.config.id) {
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
        node.on("complete", () => {
          setNodes((nds) =>
            nds.map((nd) => {
              if (nd.id === node.config.id) {
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
      });
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
      fitView
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
