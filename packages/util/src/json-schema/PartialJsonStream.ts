/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parser modes. The tokenizer is a flat state machine so a chunk can end in the
 * middle of any token and resume on the next `push()` without re-reading input.
 */
const Mode = {
  /** Discarding preamble text until the first `{`. */
  Seek: 0,
  /** Expecting the start of a value. */
  Value: 1,
  /** Expecting an object key or the closing `}`. */
  Key: 2,
  /** Expecting the `:` between key and value. */
  Colon: 3,
  /** Expecting `,` or a closing delimiter after a completed value. */
  Comma: 4,
  /** Inside a string literal. */
  String: 5,
  /** Inside a number token. */
  Number: 6,
  /** Inside a `true` / `false` / `null` token. */
  Literal: 7,
  /** The root value closed; further input is ignored. */
  Done: 8,
  /** Malformed input; further input is ignored and the partial root is kept. */
  Invalid: 9,
} as const;
type Mode = (typeof Mode)[keyof typeof Mode];

const CHAR_TAB = 9;
const CHAR_LF = 10;
const CHAR_CR = 13;
const CHAR_SPACE = 32;
const CHAR_QUOTE = 34;
const CHAR_BACKSLASH = 92;

/** Strict JSON number grammar — rejects `1.`, `1e`, `-`, `+1`, `01`. */
const COMPLETE_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i;

const LITERALS: Record<string, boolean | null> = {
  true: true,
  false: false,
  null: null,
};

function isWhitespace(code: number): boolean {
  return code === CHAR_SPACE || code === CHAR_LF || code === CHAR_TAB || code === CHAR_CR;
}

function isNumberChar(code: number): boolean {
  // 0-9, '-', '+', '.', 'e', 'E'
  return (
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 43 ||
    code === 46 ||
    code === 101 ||
    code === 69
  );
}

function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

function isLiteralPrefix(text: string): boolean {
  return "true".startsWith(text) || "false".startsWith(text) || "null".startsWith(text);
}

/**
 * Assigns an own property, matching `JSON.parse` for the `__proto__` key.
 *
 * A plain `target["__proto__"] = value` mutates the prototype instead of
 * creating an own property, so untrusted model output could otherwise reach
 * `Object.prototype`.
 */
function assignKey(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  target[key] = value;
}

interface Frame {
  readonly isArray: boolean;
  readonly value: Record<string, unknown> | unknown[];
  /** Key awaiting a value, for object frames. */
  key: string;
}

/**
 * Where the value currently being tokenized will be written. Held so an
 * in-flight string or number can be revised in place as more of it arrives,
 * instead of being appended twice.
 */
type PendingSlot =
  | { readonly kind: "object"; readonly target: Record<string, unknown>; readonly key: string }
  | { readonly kind: "array"; readonly target: unknown[]; readonly index: number }
  | { readonly kind: "root" };

export interface PartialJsonStreamOptions {
  /**
   * Discard any text before the first `{`. Use for providers that emit prose,
   * a `<think>` block, or a Markdown fence ahead of the JSON. Once the root
   * value closes, trailing text is ignored either way.
   *
   * A `[` never starts the payload in this mode: prose is full of bracketed
   * asides that parse as valid arrays, and the object-only contract makes an
   * array root useless anyway. A document that really is array-rooted must be
   * fed without `skipPreamble`.
   */
  readonly skipPreamble?: boolean;
}

/**
 * An incremental JSON parser that consumes a document in chunks.
 *
 * Each {@link push} costs O(chunk.length) — consumed input is never re-scanned —
 * so feeding a document in N chunks costs O(document length) overall rather than
 * the O(n²) of re-parsing a growing buffer on every delta.
 *
 * ## Aliasing
 *
 * {@link push} returns the **live** root object, which the parser keeps mutating
 * as more input arrives. That aliasing is what keeps the cost linear: deep-cloning
 * per delta would restore the quadratic behavior. It is safe for a consumer that
 * reads each delta before the next `push()`, and safe across a worker boundary
 * (events are structured-cloned on the way out), but a consumer that retains an
 * earlier delta will observe it change. Use {@link snapshot} for a detached copy.
 */
export interface PartialJsonStream {
  /**
   * Consumes a chunk and returns the live root object, or `undefined` while the
   * root is not (yet) a plain object — no container has opened, or the document
   * has an array or scalar at its root. Mirrors {@link parsePartialJson}'s
   * object-only contract, so a caller can emit the result as an object delta
   * without first checking for an array.
   */
  push(chunk: string): Record<string, unknown> | undefined;
  /**
   * Closes any open strings and containers and returns the parsed document.
   * A trailing incomplete token (`1.`, `tru`, a partial key) is dropped, matching
   * {@link parsePartialJson}'s repair. Idempotent; input after it is ignored.
   */
  finish(): Record<string, unknown>;
  /** A detached deep copy of the current live root; O(size of the value). */
  snapshot(): Record<string, unknown> | undefined;
  /** Whether the root value closed on its own (as opposed to being truncated). */
  readonly complete: boolean;
}

class PartialJsonStreamImpl implements PartialJsonStream {
  private mode: Mode;
  private readonly skipPreamble: boolean;
  private readonly stack: Frame[] = [];
  private root: unknown = undefined;
  private pending: PendingSlot | undefined = undefined;
  /** Buffer for the token in flight — bounded by that token, not the document. */
  private buf = "";
  private stringIsKey = false;
  private escaped = false;
  private unicodeRemaining = 0;
  private unicodeValue = 0;
  /** Raw hex digits of the `\uXXXX` escape in flight, kept so an invalid one replays verbatim. */
  private unicodeText = "";
  private closed = false;
  private finished = false;

  constructor(skipPreamble: boolean) {
    this.skipPreamble = skipPreamble;
    this.mode = skipPreamble ? Mode.Seek : Mode.Value;
  }

  get complete(): boolean {
    return this.closed;
  }

  push(chunk: string): Record<string, unknown> | undefined {
    if (!this.finished && chunk.length > 0) {
      this.consume(chunk);
    }
    return this.liveRoot();
  }

  finish(): Record<string, unknown> {
    if (!this.finished) {
      this.finished = true;
      this.flushPendingToken();
      this.stack.length = 0;
    }
    const root = this.root;
    return root === undefined ? {} : (root as Record<string, unknown>);
  }

  snapshot(): Record<string, unknown> | undefined {
    const live = this.liveRoot();
    if (live === undefined) return undefined;
    // The tree is JSON by construction, so a round-trip is a faithful clone.
    return JSON.parse(JSON.stringify(live)) as Record<string, unknown>;
  }

  /**
   * Writes the in-flight token into its slot so a caller reading between chunks
   * sees a partially-received string or an already-valid number. Repeatable: the
   * slot is overwritten, never appended to.
   */
  private materializePending(): void {
    if (this.pending === undefined) return;
    if (this.mode === Mode.String) {
      if (!this.stringIsKey) this.writeSlot(this.buf);
      return;
    }
    if (this.mode === Mode.Number) {
      if (COMPLETE_NUMBER.test(this.buf)) this.writeSlot(Number(this.buf));
      else this.clearSlot();
    }
  }

  /** Commits a trailing token at end of stream, dropping anything incomplete. */
  private flushPendingToken(): void {
    if (this.mode === Mode.String) {
      if (this.stringIsKey) this.clearSlot();
      else this.commit(this.buf);
      return;
    }
    if (this.mode === Mode.Number) {
      if (COMPLETE_NUMBER.test(this.buf)) this.commit(Number(this.buf));
      else this.clearSlot();
      return;
    }
    if (this.mode === Mode.Literal) this.clearSlot();
  }

  /**
   * Handles a character that cannot occur in the current state.
   *
   * Normally the rest of the stream is abandoned and whatever was parsed so far
   * is kept. When skipping preamble the text is untrusted prose, so a candidate
   * that never yielded any data — prose braces such as `{braces}` inside a
   * `<think>` block — is discarded and scanning resumes for the real payload. A
   * candidate that did produce data is kept rather than gambling on a better one.
   */
  private fail(index: number): number {
    if (this.skipPreamble && !this.closed && this.rootIsEmpty()) {
      this.stack.length = 0;
      this.pending = undefined;
      this.buf = "";
      this.escaped = false;
      this.unicodeRemaining = 0;
      this.unicodeValue = 0;
      this.unicodeText = "";
      this.root = undefined;
      this.mode = Mode.Seek;
      return index;
    }
    this.mode = Mode.Invalid;
    return index;
  }

  private rootIsEmpty(): boolean {
    const root = this.root;
    if (root === undefined) return true;
    if (Array.isArray(root)) return root.length === 0;
    if (root !== null && typeof root === "object") {
      return Object.keys(root).length === 0;
    }
    return false;
  }

  private liveRoot(): Record<string, unknown> | undefined {
    this.materializePending();
    const root = this.root;
    if (root === null || typeof root !== "object" || Array.isArray(root)) return undefined;
    return root as Record<string, unknown>;
  }

  private writeSlot(value: unknown): void {
    const slot = this.pending;
    if (slot === undefined) return;
    if (slot.kind === "object") assignKey(slot.target, slot.key, value);
    else if (slot.kind === "array") slot.target[slot.index] = value;
    else this.root = value;
  }

  private clearSlot(): void {
    const slot = this.pending;
    if (slot === undefined) return;
    if (slot.kind === "object") delete slot.target[slot.key];
    else if (slot.kind === "array") slot.target.length = slot.index;
    else this.root = undefined;
  }

  /**
   * Reserves the destination of a value that is about to be tokenized. Array
   * slots record the index rather than pushing a placeholder, so an incomplete
   * token leaves no hole behind.
   */
  private beginValue(): void {
    const top = this.stack[this.stack.length - 1];
    if (top === undefined) {
      this.pending = { kind: "root" };
    } else if (top.isArray) {
      const target = top.value as unknown[];
      this.pending = { kind: "array", target, index: target.length };
    } else {
      this.pending = { kind: "object", target: top.value as Record<string, unknown>, key: top.key };
    }
  }

  private commit(value: unknown): void {
    this.writeSlot(value);
    this.pending = undefined;
    this.buf = "";
    this.afterValue();
  }

  private afterValue(): void {
    if (this.stack.length === 0) {
      this.mode = Mode.Done;
      this.closed = true;
      return;
    }
    this.mode = Mode.Comma;
  }

  private openContainer(isArray: boolean): void {
    this.beginValue();
    const value: Record<string, unknown> | unknown[] = isArray ? [] : {};
    this.writeSlot(value);
    this.pending = undefined;
    this.stack.push({ isArray, value, key: "" });
    this.mode = isArray ? Mode.Value : Mode.Key;
  }

  private closeContainer(): void {
    this.stack.pop();
    this.buf = "";
    this.pending = undefined;
    this.afterValue();
  }

  private consume(chunk: string): void {
    const len = chunk.length;
    let i = 0;
    while (i < len) {
      switch (this.mode) {
        case Mode.Seek:
          i = this.consumeSeek(chunk, i, len);
          break;
        case Mode.String:
          i = this.consumeString(chunk, i, len);
          break;
        case Mode.Number:
          i = this.consumeNumber(chunk, i, len);
          break;
        case Mode.Literal:
          i = this.consumeLiteral(chunk, i, len);
          break;
        case Mode.Value:
          i = this.consumeValueStart(chunk, i, len);
          break;
        case Mode.Key:
          i = this.consumeKeyStart(chunk, i, len);
          break;
        case Mode.Colon:
          i = this.consumeColon(chunk, i, len);
          break;
        case Mode.Comma:
          i = this.consumeComma(chunk, i, len);
          break;
        default:
          // Done or Invalid: the rest of the stream is ignored.
          return;
      }
    }
  }

  /**
   * Scans past preamble to the start of the payload. Only `{` opens a
   * candidate: the parser's contract is object-only, and prose is full of
   * bracketed asides (`[1]`, `[2024 figures]`) that parse as a perfectly
   * valid array. A complete one would close the root and make the parser
   * ignore the real payload behind it; an incomplete one leaves a non-empty
   * root, which {@link fail} then refuses to discard. Neither is recoverable,
   * so a bracket never starts a candidate here.
   */
  private consumeSeek(chunk: string, start: number, len: number): number {
    for (let i = start; i < len; i++) {
      if (chunk[i] === "{") {
        this.mode = Mode.Value;
        return i;
      }
    }
    return len;
  }

  private consumeValueStart(chunk: string, start: number, len: number): number {
    let i = start;
    while (i < len) {
      const code = chunk.charCodeAt(i);
      if (isWhitespace(code)) {
        i++;
        continue;
      }
      const ch = chunk[i]!;
      i++;
      if (ch === "{") {
        this.openContainer(false);
        return i;
      }
      if (ch === "[") {
        this.openContainer(true);
        return i;
      }
      if (ch === '"') {
        this.beginValue();
        this.buf = "";
        this.stringIsKey = false;
        this.mode = Mode.String;
        return i;
      }
      if (ch === "}" || ch === "]") {
        // Lenient close: an empty container, or a trailing comma before the
        // close, which a truncated model response often produces.
        this.closeContainer();
        return i;
      }
      if (code === 45 || (code >= 48 && code <= 57)) {
        this.beginValue();
        this.buf = ch;
        this.mode = Mode.Number;
        return i;
      }
      if (ch === "t" || ch === "f" || ch === "n") {
        this.beginValue();
        this.buf = ch;
        this.mode = Mode.Literal;
        return i;
      }
      return this.fail(i);
    }
    return i;
  }

  private consumeKeyStart(chunk: string, start: number, len: number): number {
    let i = start;
    while (i < len) {
      const code = chunk.charCodeAt(i);
      if (isWhitespace(code)) {
        i++;
        continue;
      }
      const ch = chunk[i]!;
      i++;
      if (ch === '"') {
        this.buf = "";
        this.stringIsKey = true;
        this.mode = Mode.String;
        return i;
      }
      if (ch === "}") {
        this.closeContainer();
        return i;
      }
      if (ch === ",") continue;
      return this.fail(i);
    }
    return i;
  }

  private consumeColon(chunk: string, start: number, len: number): number {
    let i = start;
    while (i < len) {
      const code = chunk.charCodeAt(i);
      if (isWhitespace(code)) {
        i++;
        continue;
      }
      const ch = chunk[i]!;
      i++;
      if (ch === ":") {
        this.mode = Mode.Value;
        return i;
      }
      return this.fail(i);
    }
    return i;
  }

  private consumeComma(chunk: string, start: number, len: number): number {
    let i = start;
    while (i < len) {
      const code = chunk.charCodeAt(i);
      if (isWhitespace(code)) {
        i++;
        continue;
      }
      const ch = chunk[i]!;
      i++;
      if (ch === ",") {
        const top = this.stack[this.stack.length - 1];
        this.mode = top !== undefined && !top.isArray ? Mode.Key : Mode.Value;
        return i;
      }
      if (ch === "}" || ch === "]") {
        this.closeContainer();
        return i;
      }
      return this.fail(i);
    }
    return i;
  }

  private consumeString(chunk: string, start: number, len: number): number {
    let i = start;
    while (i < len) {
      if (this.unicodeRemaining > 0) {
        const digit = hexValue(chunk.charCodeAt(i));
        if (digit < 0) {
          // Not a valid \uXXXX escape; keep the text exactly as written,
          // including any hex digits already consumed (`\u00zz` must not
          // come back as `\uzz`). The offending character is re-dispatched.
          this.buf += `\\u${this.unicodeText}`;
          this.unicodeRemaining = 0;
          this.unicodeValue = 0;
          this.unicodeText = "";
          continue;
        }
        this.unicodeValue = this.unicodeValue * 16 + digit;
        this.unicodeText += chunk[i]!;
        this.unicodeRemaining--;
        i++;
        if (this.unicodeRemaining === 0) {
          this.buf += String.fromCharCode(this.unicodeValue);
          this.unicodeValue = 0;
          this.unicodeText = "";
        }
        continue;
      }

      if (this.escaped) {
        const ch = chunk[i]!;
        this.escaped = false;
        i++;
        switch (ch) {
          case "b":
            this.buf += "\b";
            break;
          case "f":
            this.buf += "\f";
            break;
          case "n":
            this.buf += "\n";
            break;
          case "r":
            this.buf += "\r";
            break;
          case "t":
            this.buf += "\t";
            break;
          case "u":
            this.unicodeRemaining = 4;
            this.unicodeValue = 0;
            break;
          default:
            this.buf += ch;
            break;
        }
        continue;
      }

      // Bulk-copy the run up to the next quote or backslash.
      let j = i;
      while (j < len) {
        const code = chunk.charCodeAt(j);
        if (code === CHAR_QUOTE || code === CHAR_BACKSLASH) break;
        j++;
      }
      if (j > i) {
        this.buf += chunk.slice(i, j);
        i = j;
      }
      if (i >= len) return len;
      const code = chunk.charCodeAt(i);
      i++;
      if (code === CHAR_BACKSLASH) {
        this.escaped = true;
        continue;
      }
      this.endString();
      return i;
    }
    return i;
  }

  private endString(): void {
    if (this.stringIsKey) {
      const top = this.stack[this.stack.length - 1];
      if (top !== undefined) top.key = this.buf;
      this.buf = "";
      this.mode = Mode.Colon;
      return;
    }
    this.commit(this.buf);
  }

  private consumeNumber(chunk: string, start: number, len: number): number {
    let i = start;
    while (i < len && isNumberChar(chunk.charCodeAt(i))) i++;
    if (i > start) this.buf += chunk.slice(start, i);
    if (i >= len) return len;
    if (!COMPLETE_NUMBER.test(this.buf)) {
      this.clearSlot();
      return this.fail(i);
    }
    // The terminator belongs to the enclosing container; re-dispatch it.
    this.commit(Number(this.buf));
    return i;
  }

  private consumeLiteral(chunk: string, start: number, len: number): number {
    let i = start;
    while (i < len) {
      const code = chunk.charCodeAt(i);
      if (code < 97 || code > 122) break;
      this.buf += chunk[i]!;
      i++;
      if (this.buf in LITERALS) {
        this.commit(LITERALS[this.buf]);
        return i;
      }
      if (!isLiteralPrefix(this.buf)) {
        this.clearSlot();
        return this.fail(i);
      }
    }
    if (i < len) {
      // A non-letter terminated a literal that never completed.
      this.clearSlot();
      return this.fail(i);
    }
    return i;
  }
}

/**
 * Creates an incremental partial-JSON parser.
 *
 * Feed it provider deltas as they arrive and emit the value `push` returns; call
 * `finish()` once for the final document. See {@link PartialJsonStream} for the
 * live-root aliasing contract.
 *
 * For a one-shot repair of an already-accumulated buffer, use
 * {@link parsePartialJson} instead.
 */
export function createPartialJsonStream(options: PartialJsonStreamOptions = {}): PartialJsonStream {
  return new PartialJsonStreamImpl(options.skipPreamble === true);
}
