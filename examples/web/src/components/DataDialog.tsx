import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { JsonTree } from "./JsonTree";

function DialogPortal({ children }: { children: React.ReactNode }) {
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "auto",
      }}
    >
      {children}
    </div>,
    document.body
  );
}
interface DataDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  data: Record<string, unknown> | null;
}

export const DataDialog: React.FC<DataDialogProps> = ({ isOpen, onClose, title, data }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <DialogPortal>
      <div className="fixed inset-0 flex items-center justify-center z-[2000] pointer-events-auto">
        <button
          type="button"
          aria-label="Close dialog"
          className="absolute inset-0 bg-black/50"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="data-dialog-title"
          className="relative bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col"
        >
          <div className="flex justify-between items-center p-4 border-b border-gray-700">
            <h2 id="data-dialog-title" className="text-lg font-semibold text-white">
              {title}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              ✕
            </button>
          </div>
          <div className="p-4 overflow-auto flex-1">
            {data && Object.keys(data).length > 0 ? (
              <JsonTree data={data} expandLevel={2} />
            ) : (
              <div className="text-gray-400">No data available</div>
            )}
          </div>
        </div>
      </div>
    </DialogPortal>
  );
};
