//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import React, { ReactNode } from "react";
import { Handle, NodeProps, Position, Node } from "@xyflow/react";
import { FiCloud, FiCloudLightning } from "react-icons/fi";

export type TurboNodeData = {
  title: string;
  icon?: ReactNode;
  subline?: string;
  active?: boolean;
  progress?: number;
  progressText?: string;
};

export const SingleNode = ({ data }: NodeProps<Node<TurboNodeData>>) => {
  return (
    <>
      <div className={`wrapper gradient ${data.active ? "active" : ""}`}>
        <div className="inner">
          <div className="body">
            {data.icon && <div className="icon">{data.icon}</div>}
            <div>
              <div className="title">{data.title}</div>
              {data.subline && <div className="subline">{data.subline}</div>}
            </div>
          </div>
          <Handle type="target" position={Position.Left} />
          <Handle type="source" position={Position.Right} />
          <div className="progress">
            {data.progress !== undefined && (
              <div className="bar" style={{ width: `${data.progress}%` }} />
            )}
            <div className="subline">{data.progressText}</div>
          </div>
        </div>
      </div>
      <div className="cloud gradient">
        <div>{data.active ? <FiCloudLightning /> : <FiCloud />}</div>
      </div>
    </>
  );
};

export const CompoundNode = ({ data }: NodeProps<Node<TurboNodeData>>) => {
  return (
    <div className={`outside ${data.active ? "active" : ""}`}>
      <div className={`wrapper gradient`}>
        <div className="inner">
          <div className="body">
            {data.icon && <div className="icon">{data.icon}</div>}
            <div>
              <div className="title">{data.title}</div>
              {data.subline && <div className="subline">{data.subline}</div>}
            </div>
          </div>
          <Handle type="target" position={Position.Left} />
          <Handle type="source" position={Position.Right} />
          <div className="progress">
            {data.progress !== undefined && (
              <div className="bar" style={{ width: `${data.progress}%` }} />
            )}
            {data.progressText}
          </div>
        </div>
      </div>
      <div className="children"></div>
    </div>
  );
};
