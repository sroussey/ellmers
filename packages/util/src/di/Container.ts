/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Simple dependency injection container for managing service instances and dependencies
 */
export class Container {
  private services: Map<string, any> = new Map();
  private factories: Map<string, () => any> = new Map();
  private singletons: Set<string> = new Set();
  private resolving: string[] = [];
  /**
   * Tokens whose cached instance was inherited from a parent container (via
   * {@link createChildContainer}). These instances are owned by the parent, so
   * disposing this container must NOT dispose them.
   */
  private inheritedServices: Set<string> = new Set();

  /**
   * Register a service factory. Replacing a factory disposes the previously
   * cached singleton (if any) so a held resource — DB connection, file
   * handle, subscriber — is released before the new factory takes effect.
   * Inherited (parent-owned) instances are skipped here; the parent owns the
   * lifetime.
   * @param token The identifier token for the service
   * @param factory A factory function that creates the service
   * @param singleton Whether the service should be a singleton (created once)
   */
  register<T>(token: string, factory: () => T, singleton = true): void {
    this.factories.set(token, factory);
    // Evict any previously instantiated singleton so the new factory actually
    // takes effect on the next get(). Otherwise get() would keep returning the
    // stale cached instance and the re-registration would be silently dead.
    const previous = this.services.get(token);
    if (previous != null && !this.inheritedServices.has(token)) {
      void this.disposeService(token, previous);
    }
    this.services.delete(token);
    this.inheritedServices.delete(token);
    if (singleton) {
      this.singletons.add(token);
    } else {
      this.singletons.delete(token);
    }
  }

  /**
   * Register a service factory only if the token is not already registered.
   * This is an atomic check-and-register to avoid TOCTOU races.
   * @param token The identifier token for the service
   * @param factory A factory function that creates the service
   * @param singleton Whether the service should be a singleton (created once)
   */
  registerIfAbsent<T>(token: string, factory: () => T, singleton = true): void {
    if (this.factories.has(token) || this.services.has(token)) {
      return;
    }
    this.register(token, factory, singleton);
  }

  /**
   * Register an instance as a service. If a previously cached singleton exists
   * under this token (and was not inherited from a parent), it is disposed
   * before being overwritten.
   * @param token The identifier token for the service
   * @param instance The instance to register
   */
  registerInstance<T>(token: string, instance: T): void {
    const previous = this.services.get(token);
    if (previous != null && previous !== instance && !this.inheritedServices.has(token)) {
      void this.disposeService(token, previous);
    }
    this.services.set(token, instance);
    this.singletons.add(token);
    // An explicitly registered instance is owned by this container.
    this.inheritedServices.delete(token);
  }

  /**
   * Get a service by its token
   * @param token The identifier token for the service
   * @returns The service instance
   */
  get<T>(token: string): T {
    if (this.services.has(token)) {
      return this.services.get(token) as T;
    }

    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(`Service not registered: ${String(token)}`);
    }

    if (this.resolving.includes(token)) {
      const cycle = [...this.resolving.slice(this.resolving.indexOf(token)), token];
      throw new Error(`Circular dependency detected: ${cycle.join(" -> ")}`);
    }

    this.resolving.push(token);
    try {
      const instance = factory();

      if (this.singletons.has(token)) {
        this.services.set(token, instance);
      }

      return instance as T;
    } finally {
      this.resolving.pop();
    }
  }

  /**
   * Check if a service is registered
   * @param token The identifier token for the service
   * @returns True if the service is registered
   */
  has(token: string): boolean {
    return this.services.has(token) || this.factories.has(token);
  }

  /**
   * Remove a service registration
   * @param token The identifier token for the service
   */
  remove(token: string): void {
    this.services.delete(token);
    this.factories.delete(token);
    this.singletons.delete(token);
    this.inheritedServices.delete(token);
  }

  /**
   * Dispose all instantiated singleton services and clear registrations.
   * Services implementing dispose(), Symbol.asyncDispose, or Symbol.dispose will be cleaned up.
   */
  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    try {
      for (const [token, service] of this.services) {
        if (service == null) continue;
        // Instances inherited from a parent container are owned by the parent;
        // disposing them here would leave the parent holding a disposed object.
        if (this.inheritedServices.has(token)) continue;
        try {
          await this.invokeDisposer(service);
        } catch (err) {
          errors.push(err);
        }
      }
    } finally {
      this.services.clear();
      this.factories.clear();
      this.singletons.clear();
      this.inheritedServices.clear();
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more services failed to dispose");
    }
  }

  /**
   * Eviction-path disposer used by {@link register} and {@link registerInstance}
   * when a cached singleton is replaced. Errors are caught here so a buggy
   * disposer cannot prevent the new registration from taking effect — util has
   * no logger dependency, hence console.warn.
   */
  private async disposeService(token: string, service: any): Promise<void> {
    try {
      await this.invokeDisposer(service);
    } catch (err) {
      console.warn(`Container: disposer for ${String(token)} threw`, err);
    }
  }

  /** Invoke whichever disposer protocol the service implements. */
  private async invokeDisposer(service: any): Promise<void> {
    if (typeof service[Symbol.asyncDispose] === "function") {
      await service[Symbol.asyncDispose]();
    } else if (typeof service[Symbol.dispose] === "function") {
      service[Symbol.dispose]();
    } else if (typeof service.dispose === "function") {
      await service.dispose();
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  /**
   * Create a child container that inherits registrations from the parent
   * @returns A new child container
   */
  createChildContainer(): Container {
    const child = new Container();

    this.factories.forEach((factory, token) => {
      child.factories.set(token, factory);
      if (this.singletons.has(token)) {
        child.singletons.add(token);
      }
    });

    this.services.forEach((service, token) => {
      if (this.singletons.has(token)) {
        child.services.set(token, service);
        child.singletons.add(token);
        // Mark the shared instance as parent-owned so child.dispose() does not
        // dispose an instance the parent still hands out.
        child.inheritedServices.add(token);
      }
    });

    return child;
  }
}

/**
 * Global container instance — shared across all bundle copies of this module
 * via a Symbol.for key so that split entry points (e.g. @workglow/util/media)
 * resolve to the same DI registry as @workglow/util.
 */
const GLOBAL_CONTAINER_KEY = Symbol.for("@workglow/util/di/globalContainer");
const _g = globalThis as Record<symbol, unknown>;
if (!_g[GLOBAL_CONTAINER_KEY]) {
  _g[GLOBAL_CONTAINER_KEY] = new Container();
}
export const globalContainer = _g[GLOBAL_CONTAINER_KEY] as Container;
