/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Types for the vendored JS-Interpreter (`interpreter.js`), which carries
 * Closure-style JSDoc rather than TypeScript. Consumers compiling this package
 * from source have no `allowJs`, so without this the import is an implicit
 * `any` under `noImplicitAny`.
 *
 * Signatures mirror the annotations in `interpreter.js`; keep them in step when
 * the vendored file is updated. Members ending in `_` are private there and are
 * deliberately absent here.
 */

/**
 * A value inside the sandbox: either an interpreter object or a primitive.
 * Sandboxed objects are NOT native objects — cross the boundary with
 * `nativeToPseudo` / `pseudoToNative`.
 */
export type InterpreterValue = InterpreterObject | boolean | number | string | undefined | null;

/** An AST node, as produced by the bundled Acorn parser. */
export interface InterpreterNode {
  type: string;
  [key: string]: unknown;
}

/** A scope in the sandbox's scope chain. */
export declare class InterpreterScope {
  constructor(parentScope: InterpreterScope | null, strict: boolean, object: InterpreterObject);
  parentScope: InterpreterScope | null;
  strict: boolean;
  object: InterpreterObject;
}

/** One frame of the interpreter's execution stack. */
export declare class InterpreterState {
  constructor(node: InterpreterNode, scope: InterpreterScope);
  node: InterpreterNode;
  scope: InterpreterScope;
  done?: boolean;
}

/** An object living inside the sandbox. */
export declare class InterpreterObject {
  constructor(proto: InterpreterObject | null);
  getter: Record<string, InterpreterObject>;
  setter: Record<string, InterpreterObject>;
  properties: Record<string, InterpreterValue>;
  proto: InterpreterObject | null;
  class: string;
  data: Date | RegExp | boolean | number | string | null;
  toString(): string;
  valueOf(): Date | RegExp | boolean | number | string | InterpreterObject;
}

/** A `setTimeout`/`setInterval` task scheduled inside the sandbox. */
export declare class InterpreterTask {
  constructor(
    functionRef: InterpreterObject,
    argsArray: InterpreterValue[],
    scope: InterpreterScope,
    node: InterpreterNode,
    interval: number
  );
  time: number;
}

/** Completion value types, as returned through `unwind`. */
export declare const enum Completion {
  NORMAL = 0,
  BREAK = 1,
  CONTINUE = 2,
  RETURN = 3,
  THROW = 4,
}

/** Interpreter status, as returned by `getStatus`. */
export declare const enum Status {
  DONE = 0,
  STEP = 1,
  TASK = 2,
  ASYNC = 3,
}

export declare class Interpreter {
  /**
   * @param code Raw JavaScript text, or an AST.
   * @param opt_initFunc Called with the interpreter and the global scope
   *   object; the hook for defining APIs the sandboxed code can reach.
   */
  constructor(
    code: string | InterpreterNode,
    opt_initFunc?: (interpreter: Interpreter, globalObject: InterpreterObject) => void
  );

  // ---- Execution --------------------------------------------------------

  /** Runs to completion. Returns true if blocked on async work. Can loop forever. */
  run(): boolean;
  /** Executes one step. Returns false when there are no more instructions. */
  step(): boolean;
  getStatus(): Status;
  /** Adds more code to an interpreter that has already been created. */
  appendCode(code: string | InterpreterNode): void;

  // ---- State ------------------------------------------------------------

  /** Completion value of the last statement executed. */
  value: InterpreterValue;
  ast: InterpreterNode;
  globalObject: InterpreterObject;
  globalScope: InterpreterScope;
  stateStack: InterpreterState[];
  tasks: InterpreterTask[];
  newNode(): InterpreterNode;

  // ---- Crossing the sandbox boundary -------------------------------------

  /** Native → sandbox. Handles JSON-style values, RegExps, Dates and functions. Does NOT handle cycles. */
  nativeToPseudo(nativeObj: unknown): InterpreterValue;
  /** Sandbox → native. Handles cycles. */
  pseudoToNative(pseudoObj: InterpreterValue, opt_cycles?: object): any;
  arrayNativeToPseudo(nativeArray: unknown[]): InterpreterObject;
  arrayPseudoToNative(pseudoArray: InterpreterObject): unknown[];

  // ---- Building sandboxed values ------------------------------------------

  createObject(constructor: InterpreterObject | null): InterpreterObject;
  createObjectProto(proto: InterpreterObject | null): InterpreterObject;
  createArray(): InterpreterObject;
  createFunction(node: InterpreterNode, scope: InterpreterScope, opt_name?: string): InterpreterObject;
  createNativeFunction(nativeFunc: Function, isConstructor: boolean): InterpreterObject;
  createAsyncFunction(asyncFunc: Function): InterpreterObject;
  populateRegExp(pseudoRegexp: InterpreterObject, nativeRegexp: RegExp): void;
  populateError(pseudoError: InterpreterObject, opt_message?: string): void;

  // ---- Properties ---------------------------------------------------------

  getProperty(obj: InterpreterValue, name: InterpreterValue): InterpreterValue;
  hasProperty(obj: InterpreterObject, name: InterpreterValue): boolean;
  /**
   * Pass `Interpreter.VALUE_IN_DESCRIPTOR` as `value` to take it from
   * `opt_descriptor` instead. Returns a setter that the caller must invoke, if
   * one applies.
   */
  setProperty(
    obj: InterpreterValue,
    name: InterpreterValue,
    value: InterpreterValue,
    opt_descriptor?: object
  ): InterpreterObject | undefined;
  setNativeFunctionPrototype(obj: InterpreterObject, name: InterpreterValue, wrapper: Function): void;
  setAsyncFunctionPrototype(obj: InterpreterObject, name: InterpreterValue, wrapper: Function): void;
  getPrototype(value: InterpreterValue): InterpreterObject | null;
  isa(child: InterpreterValue, constructor: InterpreterObject | null): boolean;

  // ---- Scopes and references ----------------------------------------------

  getScope(): InterpreterScope;
  createScope(node: InterpreterNode, parentScope: InterpreterScope | null): InterpreterScope;
  createSpecialScope(parentScope: InterpreterScope, opt_object?: InterpreterObject): InterpreterScope;
  getValueFromScope(name: string): InterpreterValue;
  setValueToScope(name: string, value: InterpreterValue): InterpreterObject | undefined;
  /** `ref` is a name, or an [object, propname] tuple. */
  getValue(ref: unknown[]): InterpreterValue;
  setValue(ref: unknown[], value: InterpreterValue): InterpreterObject | undefined;
  calledWithNew(): boolean;

  // ---- Control flow --------------------------------------------------------

  /** Call with an error class and a message, or with a value to throw. */
  throwException(errorClass: InterpreterObject | InterpreterValue, opt_message?: string): void;
  unwind(type: Completion, value: InterpreterValue, label: string | undefined): void;
  /** Summarizes an expression for error messages. Not guaranteed complete. */
  nodeSummary(node: InterpreterNode): string;

  // ---- Global setup --------------------------------------------------------

  initGlobal(globalObject: InterpreterObject): void;
  initFunction(globalObject: InterpreterObject): void;
  initObject(globalObject: InterpreterObject): void;
  initArray(globalObject: InterpreterObject): void;
  initString(globalObject: InterpreterObject): void;
  initBoolean(globalObject: InterpreterObject): void;
  initNumber(globalObject: InterpreterObject): void;
  initDate(globalObject: InterpreterObject): void;
  initRegExp(globalObject: InterpreterObject): void;
  initError(globalObject: InterpreterObject): void;
  initMath(globalObject: InterpreterObject): void;
  initJSON(globalObject: InterpreterObject): void;

  // ---- RegExp execution off the main thread ---------------------------------

  createWorker(): Worker;
  vmCall(code: string, sandbox: object, nativeRegExp: RegExp, callback: Function): void;
  maybeThrowRegExp(nativeRegExp: RegExp, callback: Function): boolean;
  regExpTimeout(nativeRegExp: RegExp, worker: Worker, callback: Function): void;

  // ---- Built-in prototypes, available once the globals are initialized ------

  OBJECT: InterpreterObject;
  OBJECT_PROTO: InterpreterObject;
  FUNCTION: InterpreterObject;
  FUNCTION_PROTO: InterpreterObject;
  ARRAY: InterpreterObject;
  ARRAY_PROTO: InterpreterObject;
  STRING: InterpreterObject;
  BOOLEAN: InterpreterObject;
  NUMBER: InterpreterObject;
  DATE: InterpreterObject;
  DATE_PROTO: InterpreterObject;
  REGEXP: InterpreterObject;
  REGEXP_PROTO: InterpreterObject;
  ERROR: InterpreterObject;
  EVAL_ERROR: InterpreterObject;
  RANGE_ERROR: InterpreterObject;
  REFERENCE_ERROR: InterpreterObject;
  SYNTAX_ERROR: InterpreterObject;
  TYPE_ERROR: InterpreterObject;
  URI_ERROR: InterpreterObject;

  // ---- Statics --------------------------------------------------------------

  static Completion: typeof Completion;
  static Status: typeof Status;
  static Object: typeof InterpreterObject;
  static Scope: typeof InterpreterScope;
  static State: typeof InterpreterState;
  static Task: typeof InterpreterTask;

  static PARSE_OPTIONS: { locations: boolean; ecmaVersion: number };
  static READONLY_DESCRIPTOR: PropertyDescriptor;
  static NONENUMERABLE_DESCRIPTOR: PropertyDescriptor;
  static READONLY_NONENUMERABLE_DESCRIPTOR: PropertyDescriptor;
  static NONCONFIGURABLE_READONLY_NONENUMERABLE_DESCRIPTOR: PropertyDescriptor;
  static VARIABLE_DESCRIPTOR: PropertyDescriptor;

  /** Sentinel: `setProperty` should read the value from the descriptor. */
  static VALUE_IN_DESCRIPTOR: InterpreterValue;
  static STEP_ERROR: { STEP_ERROR: boolean };
  static SCOPE_REFERENCE: { SCOPE_REFERENCE: boolean };
  static REGEXP_TIMEOUT: { REGEXP_TIMEOUT: boolean };
  static WORKER_CODE: string[];

  static nativeGlobal: typeof globalThis;
  static vm: unknown;

  static legalArrayLength(x: InterpreterValue): number;
  static legalArrayIndex(x: InterpreterValue): number;
}
