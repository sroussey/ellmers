import React, { useState, useEffect } from "react";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs/components/prism-core";
import "prismjs/components/prism-json";
import "prismjs/themes/prism.css"; // Importing Prism CSS for syntax highlighting
import { JsonTask } from "ellmers-core/browser";

interface PopupProps {
  initialJson: string;
  onJsonChange: (json: string) => void;
  closePopup: () => void;
}

export const PopupWithJsonEditor: React.FC<PopupProps> = ({
  initialJson,
  onJsonChange,
  closePopup,
}) => {
  const [code, setCode] = useState<string>(initialJson);
  const [isValidJSON, setIsValidJSON] = useState<boolean>(true);

  // Function to validate JSON
  const validateJSON = (jsonString: string) => {
    try {
      const val = JSON.parse(jsonString);
      new JsonTask({ name: "Test JSON", input: { json: jsonString } });
      setIsValidJSON(true);
    } catch (error) {
      setIsValidJSON(false);
    }
  };

  // Effect hook to validate JSON whenever code changes
  useEffect(() => {
    validateJSON(code);
  }, [code]);

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backdropFilter: "blur(5px)",
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 999,
        }}
      >
        <div
          style={{
            width: "400px",
            height: "600px",
            padding: 20,
            border: "1px solid #444",
            borderRadius: 5,
            backgroundColor: "#333",
            display: "flex",
            flexDirection: "column",
            zIndex: 1000,
          }}
        >
          <div>Enter JSON definition to run:</div>
          <Editor
            value={code}
            onValueChange={(code) => setCode(code)}
            highlight={(code) => highlight(code, languages.json)}
            padding={10}
            style={{
              fontFamily: '"Fira code", "Fira Mono", monospace',
              fontSize: 12,
              border: "1px solid #3d3d3d",
              borderRadius: 4,
              flexGrow: 1,
              marginTop: "10px",
              marginBottom: "10px",
              backgroundColor: "#222",
            }}
          />
          <button
            disabled={!isValidJSON}
            onClick={() => closePopup()}
            style={{ alignSelf: "center", marginTop: "10px" }}
          >
            GO
          </button>
        </div>
      </div>
    </>
  );
};
