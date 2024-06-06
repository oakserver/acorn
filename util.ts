// Copyright 2022-2024 the oak authors. All rights reserved.

/**
 * Contains some internal utilities.
 *
 * @module
 */

import { accepts, contentType, type HttpError, STATUS_TEXT } from "./deps.ts";

export const CONTENT_TYPE_HTML = contentType("html")!;
export const CONTENT_TYPE_JSON = contentType("json")!;
export const CONTENT_TYPE_TEXT = contentType("text/plain")!;

/** A type guard which determines if the value can be used as `BodyInit` for
 * creating a body of a `Response`. */
export function isBodyInit(value: unknown): value is BodyInit {
  return value instanceof Blob || value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) || value instanceof FormData ||
    value instanceof URLSearchParams || value instanceof ReadableStream ||
    typeof value === "string";
}

/** Determines if a string looks like HTML. */
export function isHtmlLike(value: string): boolean {
  return /^\s*<(?:!DOCTYPE|html|body)/i.test(value);
}

/** Determines if the string looks like JSON. */
export function isJsonLike(value: string): boolean {
  return /^\s*["{[]/.test(value);
}

/** Determines if the runtime is Bun or not. */
export function isBun(): boolean {
  return "Bun" in globalThis;
}

/** Determines if the runtime is Node.js or not. */
export function isNode(): boolean {
  return "process" in globalThis && "global" in globalThis &&
    !("Bun" in globalThis) && !("WebSocketPair" in globalThis);
}

const hasPromiseWithResolvers = "withResolvers" in Promise;

/** Offloads to the native `Promise.withResolvers` when available.
 *
 * Currently Node.js does not support it, while Deno and Bun do.
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

/** Generate a `Response` based on the original `Request` and an `HttpError`.
 * It will ensure negotiation of the content type and will provide the stack
 * trace in errors that are marked as expose-able. */
export function responseFromHttpError(
  request: Request,
  error: HttpError,
  preferJson: boolean,
): Response {
  const acceptsContent = preferJson
    ? accepts(request, "application/json", "text/html")
    : accepts(request, "text/html", "application/json");
  let bodyInit;
  switch (acceptsContent) {
    case "text/html":
      bodyInit = `<!DOCTYPE html><html>
        <head>
          <title></title>
        <head>
        <body>
          <h1>${STATUS_TEXT[error.status]} - ${error.status}</h1>
          <h2>${error.message}</h2>
          ${
        error.expose && error.stack
          ? `<h3>Stack trace:</h3><pre>${error.stack}</pre>`
          : ""
      }
        </body>
      </html>`;
      break;
    case "application/json":
      bodyInit = JSON.stringify({
        status: error.status,
        statusText: STATUS_TEXT[error.status],
        message: error.message,
        stack: error.expose ? error.stack : undefined,
      });
      break;
    default:
      bodyInit = `${
        STATUS_TEXT[error.status]
      } - ${error.status}\n${error.message}\n\n${
        error.expose ? error.stack : ""
      }`;
  }
  return new Response(bodyInit, {
    status: error.status,
    statusText: STATUS_TEXT[error.status],
    headers: {
      "content-type": contentType(acceptsContent ?? "text/plain")!,
    },
  });
}
