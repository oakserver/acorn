import { accepts, contentType, type HttpError, STATUS_TEXT } from "./deps.ts";

export const CONTENT_TYPE_JSON = contentType("json")!;

export function assert(
  cond: unknown,
  message = "Assertion Error",
): asserts cond {
  if (!cond) {
    throw new Error(message);
  }
}

/** A class which provides an "unwraped" promise. */
export class Deferred<T> {
  #promise: Promise<T>;
  // deno-lint-ignore no-explicit-any
  #reject!: (reason?: any) => void;
  #resolve!: (value: T | PromiseLike<T>) => void;

  constructor() {
    this.#promise = new Promise((res, rej) => {
      this.#resolve = res;
      this.#reject = rej;
    });
  }

  get promise() {
    return this.#promise;
  }

  get reject() {
    return this.#reject;
  }

  get resolve() {
    return this.#resolve;
  }
}

/** A type guard which determines if the value can be used as `BodyInit` for
 * creating a body of a `Response`. */
export function isBodyInit(value: unknown): value is BodyInit {
  return value instanceof Blob || value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) || value instanceof FormData ||
    value instanceof URLSearchParams || value instanceof ReadableStream ||
    typeof value === "string";
}

/** Generate a `Response` based on the original `Request` and an `HttpError`.
 * It will ensure negotiation of the content type and will provide the stack
 * trace in errors that are marked as exposeable. */
export function responseFromHttpError(
  request: Request,
  error: HttpError,
): Response {
  const acceptsContent = accepts(request, "text/html", "application/json");
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
