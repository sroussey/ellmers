//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import React, { useState, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { json } from "@codemirror/lang-json";
import { JsonTask } from "@ellmers/task-graph";

import "./JsonEditor.css";

const extensions = [json()];

interface PopupProps {
  json: string;
  onJsonChange: (json: string) => void;
  running: boolean;
  run: () => void;
}

export const JsonEditor: React.FC<PopupProps> = ({ json, onJsonChange, run, running }) => {
  const [code, setCode] = useState<string>(json);
  const [isValidJSON, setIsValidJSON] = useState<boolean>(true);

  // Function to validate JSON
  const validateJSON = (jsonString: string) => {
    try {
      // this will throw an error if the JSON is invalid
      JSON.parse(jsonString);
      // this will throw an error if the JSON is not a valid task graph
      new JsonTask({ name: "Test JSON", input: { json: jsonString } });

      setIsValidJSON(true);
      setCode(jsonString);
      onJsonChange(jsonString);
    } catch (error) {
      setIsValidJSON(false);
    }
  };

  // Effect hook to validate JSON whenever code changes
  useEffect(() => {
    validateJSON(code);
  }, [code]);

  // Effect hook to validate JSON whenever builder changes
  useEffect(() => {
    validateJSON(json);
  }, [json]);

  return (
    <div className="flex h-full w-full p-6 bg-[#333] text-[#ddd] flex-col">
      <div>Enter JSON definition to run:</div>
      <div className="flex-1 border-1 border-[#3d3d3d] rounded-md mt-2 mb-2 bg-[#222] text-xs">
        <CodeMirror
          value={code}
          onChange={setCode}
          theme={vscodeDark}
          extensions={extensions}
          style={{ height: "100%" }}
          aria-disabled={running}
          readOnly={running}
        />
      </div>
      <button
        disabled={!isValidJSON || running}
        onClick={run}
        className="bg-black text-white p-2 rounded-md hover:bg-gray-900 disabled:opacity-50 disabled:bg-gray-950 disabled:cursor-not-allowed"
      >
        RUN
      </button>
    </div>
  );
};
