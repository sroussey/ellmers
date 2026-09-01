/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a host wants in the ambient `TaskRegistry`.
 *
 * `fileSystemTasks` is required rather than defaulted, and that is the whole
 * point of the option: the registry is what a DESERIALIZED graph resolves a
 * task type through, so which types are registered decides what stored JSON can
 * name. A default either quietly hands every host the filesystem tasks, or
 * quietly takes them away from a host whose saved workflows already name them —
 * both are invisible at the call site. Stating it makes the choice a compile
 * error until the host has made it.
 */
export interface RegisterCommonTasksOptions {
  /**
   * Whether `FileGrepTask`, `FileLoaderTask` and `FileSedTask` join the
   * registry, making them resolvable by type name.
   *
   * `true` only where every graph reaching the registry is trusted: a
   * serialized node supplies its own `config`, so a graph naming `FileGrepTask`
   * also states its own `roots` and no default this package picks constrains
   * it. Registration is the boundary; the tasks' own containment is the
   * backstop behind it.
   */
  readonly fileSystemTasks: boolean;
}
