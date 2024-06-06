// Copyright 2022-2024 the oak authors. All rights reserved.

/**
 * Node.js does not have the web standard {@linkcode ErrorEvent} and acorn
 * extends it for router error events, so we need to polyfill it.
 *
 * @module
 */

if (!("ErrorEvent" in globalThis)) {
  class ErrorEvent extends Event {
    #message: string;
    #filename: string;
    #lineno: number;
    #colno: number;
    // deno-lint-ignore no-explicit-any
    #error: any;

    get message(): string {
      return this.#message;
    }
    get filename(): string {
      return this.#filename;
    }
    get lineno(): number {
      return this.#lineno;
    }
    get colno(): number {
      return this.#colno;
    }
    // deno-lint-ignore no-explicit-any
    get error(): any {
      return this.#error;
    }

    constructor(type: string, eventInitDict: ErrorEventInit = {}) {
      super(type, eventInitDict);
      const { message = "error", filename = "", lineno = 0, colno = 0, error } =
        eventInitDict;
      this.#message = message;
      this.#filename = filename;
      this.#lineno = lineno;
      this.#colno = colno;
      this.#error = error;
    }
  }

  Object.defineProperty(globalThis, "ErrorEvent", {
    value: ErrorEvent,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
