// Copyright 2018-2024 the oak authors. All rights reserved.

const hasPromiseWithResolvers = "withResolvers" in Promise;

/** Append a set of headers onto a response. */
export function appendHeaders(response: Response, headers: Headers): Response {
  for (const [key, value] of headers) {
    response.headers.append(key, value);
  }
  return response;
}

/**
 * Creates a promise with resolve and reject functions that can be called.
 *
 * Offloads to the native `Promise.withResolvers` when available.
 */
export function createPromiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  // deno-lint-ignore no-explicit-any
  reject: (reason?: any) => void;
} {
  if (hasPromiseWithResolvers) {
    return Promise.withResolvers<T>();
  }
  let resolve;
  let reject;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

/**
 * Safely decode a URI component, where if it fails, instead of throwing,
 * just returns the original string.
 */
export function decodeComponent(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Determines if the runtime is Bun or not. */
export function isBun(): boolean {
  return "Bun" in globalThis;
}

/** Determines if the runtime is Node.js or not. */
export function isNode(): boolean {
  return "process" in globalThis && "global" in globalThis &&
    !("Bun" in globalThis) && !("WebSocketPair" in globalThis) &&
    !("Deno" in globalThis);
}
