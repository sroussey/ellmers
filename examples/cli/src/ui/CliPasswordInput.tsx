/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Password line editor with optional initial value so tabbing back into the field
 * preserves the secret. @inkjs/ui PasswordInput does not support defaultValue.
 *
 * Adapted from @inkjs/ui (MIT) password-input components.
 */

import { Text, useInput, usePaste } from "ink";
import pc from "picocolors";
import { useCallback, useEffect, useMemo, useReducer, type ReactElement } from "react";

const cursor = pc.inverse(" ");

type PasswordReducerState = {
  previousValue: string;
  value: string;
  cursorOffset: number;
};

type PasswordReducerAction =
  | { type: "move-cursor-left" }
  | { type: "move-cursor-right" }
  | { type: "insert"; text: string }
  | { type: "delete" }
  | { type: "forward-delete" };

function passwordReducer(
  state: PasswordReducerState,
  action: PasswordReducerAction
): PasswordReducerState {
  switch (action.type) {
    case "move-cursor-left": {
      return {
        ...state,
        cursorOffset: Math.max(0, state.cursorOffset - 1),
      };
    }
    case "move-cursor-right": {
      return {
        ...state,
        cursorOffset: Math.min(state.value.length, state.cursorOffset + 1),
      };
    }
    case "insert": {
      return {
        ...state,
        previousValue: state.value,
        value:
          state.value.slice(0, state.cursorOffset) +
          action.text +
          state.value.slice(state.cursorOffset),
        cursorOffset: state.cursorOffset + action.text.length,
      };
    }
    case "delete": {
      if (state.cursorOffset === 0) return state;
      const newCursorOffset = state.cursorOffset - 1;
      return {
        ...state,
        previousValue: state.value,
        value: state.value.slice(0, newCursorOffset) + state.value.slice(newCursorOffset + 1),
        cursorOffset: newCursorOffset,
      };
    }
    case "forward-delete": {
      if (state.cursorOffset >= state.value.length) return state;
      return {
        ...state,
        previousValue: state.value,
        value: state.value.slice(0, state.cursorOffset) + state.value.slice(state.cursorOffset + 1),
        cursorOffset: state.cursorOffset,
      };
    }
    default:
      return state;
  }
}

function useCliPasswordInputState({
  defaultValue,
  onChange,
  onSubmit,
}: {
  readonly defaultValue: string;
  readonly onChange?: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
}): PasswordReducerState & {
  moveCursorLeft: () => void;
  moveCursorRight: () => void;
  insert: (text: string) => void;
  delete: () => void;
  forwardDelete: () => void;
  submit: () => void;
} {
  const [state, dispatch] = useReducer(passwordReducer, {
    previousValue: "",
    value: defaultValue,
    cursorOffset: defaultValue.length,
  });

  const moveCursorLeft = useCallback(() => {
    dispatch({ type: "move-cursor-left" });
  }, []);
  const moveCursorRight = useCallback(() => {
    dispatch({ type: "move-cursor-right" });
  }, []);
  const insert = useCallback((text: string) => {
    dispatch({ type: "insert", text });
  }, []);
  const deleteCharacter = useCallback(() => {
    dispatch({ type: "delete" });
  }, []);
  const forwardDeleteCharacter = useCallback(() => {
    dispatch({ type: "forward-delete" });
  }, []);
  const submit = useCallback(() => {
    onSubmit?.(state.value);
  }, [state.value, onSubmit]);

  useEffect(() => {
    if (state.value !== state.previousValue) {
      onChange?.(state.value);
    }
  }, [state.previousValue, state.value, onChange]);

  return {
    ...state,
    moveCursorLeft,
    moveCursorRight,
    insert,
    delete: deleteCharacter,
    forwardDelete: forwardDeleteCharacter,
    submit,
  };
}

function useCliPasswordInput({
  isDisabled = false,
  state,
  placeholder = "",
}: {
  readonly isDisabled?: boolean;
  readonly state: ReturnType<typeof useCliPasswordInputState>;
  readonly placeholder?: string;
}): { inputValue: string } {
  const renderedPlaceholder = useMemo(() => {
    if (isDisabled) {
      return placeholder ? pc.dim(placeholder) : "";
    }
    if (!placeholder || placeholder.length === 0) return cursor;
    // pc.dim("") still emits an open/close pair, so skip it for a one-character placeholder.
    const rest = placeholder.slice(1);
    return pc.inverse(placeholder[0]) + (rest.length > 0 ? pc.dim(rest) : "");
  }, [isDisabled, placeholder]);

  const renderedValue = useMemo(() => {
    const value = "*".repeat(state.value.length);
    if (isDisabled) {
      return value;
    }
    let index = 0;
    let result = value.length > 0 ? "" : cursor;
    for (const char of value) {
      result += index === state.cursorOffset ? pc.inverse(char) : char;
      index++;
    }
    if (value.length > 0 && state.cursorOffset === state.value.length) {
      result += cursor;
    }
    return result;
  }, [isDisabled, state.value, state.cursorOffset]);

  usePaste(
    (text) => {
      state.insert(text);
    },
    { isActive: !isDisabled }
  );

  useInput(
    (input, key) => {
      if (
        key.upArrow ||
        key.downArrow ||
        (key.ctrl && input === "c") ||
        key.tab ||
        (key.shift && key.tab)
      ) {
        return;
      }
      if (key.return) {
        state.submit();
        return;
      }
      if (key.leftArrow) {
        state.moveCursorLeft();
      } else if (key.rightArrow) {
        state.moveCursorRight();
      } else if (key.backspace) {
        state.delete();
      } else if (key.delete) {
        state.forwardDelete();
      } else {
        state.insert(input);
      }
    },
    { isActive: !isDisabled }
  );

  return {
    inputValue: state.value.length > 0 ? renderedValue : renderedPlaceholder,
  };
}

export interface CliPasswordInputProps {
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly onChange?: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
}

export function CliPasswordInput({
  defaultValue = "",
  placeholder = "",
  onChange,
  onSubmit,
}: CliPasswordInputProps): ReactElement {
  const state = useCliPasswordInputState({
    defaultValue,
    onChange,
    onSubmit,
  });
  const { inputValue } = useCliPasswordInput({
    isDisabled: false,
    state,
    placeholder,
  });
  return <Text>{inputValue}</Text>;
}
