// Copyright 2022-2024 the oak authors. All rights reserved.

import type {
  Addr,
  Listener,
  RequestEvent as _RequestEvent,
  ServeOptions,
  Server,
  ServeTlsOptions,
} from "./types_internal.ts";
import type {
  IncomingMessage,
  Server as NodeServer,
  ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { createPromiseWithResolvers } from "./util.ts";

class RequestEvent implements _RequestEvent {
  #incomingMessage: IncomingMessage;
  #promise: Promise<Response>;
  // deno-lint-ignore no-explicit-any
  #reject: (reason?: any) => void;
  #request: Request;
  #resolve: (value: Response | PromiseLike<Response>) => void;
  #resolved = false;
  #serverResponse: ServerResponse<IncomingMessage>;

  get addr(): Addr {
    // deno-lint-ignore no-explicit-any
    const value: any = this.#incomingMessage.socket.address();
    return {
      transport: "tcp",
      hostname: value?.address ?? "",
      port: value?.port ?? 0,
    };
  }

  get request(): Request {
    return this.#request;
  }

  get response(): Promise<Response> {
    return this.#promise;
  }

  constructor(
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    host: string,
    address: string | AddressInfo | null,
  ) {
    this.#incomingMessage = req;
    this.#serverResponse = res;
    const { resolve, reject, promise } = createPromiseWithResolvers<Response>();
    this.#resolve = resolve;
    this.#reject = reject;
    this.#promise = promise;
    const headers = req.headers as Record<string, string>;
    const method = req.method ?? "GET";
    const url = new URL(
      req.url ?? "/",
      address
        ? typeof address === "string"
          ? `http://${host}`
          : `http://${host}:${address.port}/`
        : `http://${host}/`,
    );
    const body = (method === "GET" || method === "HEAD")
      ? null
      : new ReadableStream<Uint8Array>({
        start: (controller) => {
          req.on("data", (chunk) => controller.enqueue(chunk));
          req.on("error", (err) => controller.error(err));
          req.on("end", () => {
            try {
              controller.close();
            } catch {
              // just swallow here
            }
          });
        },
      });
    this.#incomingMessage;
    this.#request = new Request(url, { body, headers });
  }

  // deno-lint-ignore no-explicit-any
  error(reason?: any): void {
    this.#reject(reason);
  }

  async respond(response: Response | PromiseLike<Response>): Promise<void> {
    if (this.#resolved) {
      throw new Error("Request already responded to.");
    }
    this.#resolved = true;
    const res = await response;
    const headers = new Map<string, string[]>();
    for (const [key, value] of res.headers) {
      if (!headers.has(key)) {
        headers.set(key, []);
      }
      headers.get(key)!.push(value);
    }
    for (const [key, value] of headers) {
      this.#serverResponse.setHeader(key, value);
    }
    if (res.body) {
      for await (const chunk of res.body) {
        const { promise, resolve, reject } = createPromiseWithResolvers<void>();
        this.#serverResponse.write(chunk, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
        await promise;
      }
    }
    const { promise, resolve } = createPromiseWithResolvers<void>();
    this.#serverResponse.end(resolve);
    await promise;
    this.#resolve(response);
  }
}

/** An abstraction for Node.js's built in HTTP Server that is used to manage
 * HTTP requests in a uniform way. */
export default class HttpServer implements Server {
  #abortController = new AbortController();
  #address: string | AddressInfo | null = null;
  #controller?: ReadableStreamDefaultController<RequestEvent>;
  #host: string;
  #port: number;
  #server?: NodeServer;
  #stream?: ReadableStream<RequestEvent>;

  constructor(options: ServeOptions | ServeTlsOptions) {
    this.#host = options.hostname ?? "localhost";
    this.#port = options.port ?? 80;
  }

  close(): void | Promise<void> {
    this.#abortController.abort();
    try {
      this.#controller?.close();
    } catch {
      // just swallowing here
    }
    this.#controller = undefined;
    this.#server?.close();
    this.#server?.unref();
    this.#server = undefined;
    this.#stream = undefined;
  }

  async listen(): Promise<Listener> {
    if (!("Request" in globalThis) || !("Response" in globalThis)) {
      const { Request, Response } = await import("npm:undici@^6.18");
      Object.defineProperties(globalThis, {
        "Request": {
          value: Request,
          writable: true,
          enumerable: false,
          configurable: true,
        },
        "Response": {
          value: Response,
          writable: true,
          enumerable: false,
          configurable: true,
        },
      });
    }
    if (!("ReadableStream" in globalThis)) {
      const { ReadableStream } = await import("node:stream/web");
      Object.defineProperty(globalThis, "ReadableStream", {
        value: ReadableStream,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    const { createServer } = await import("node:http");
    this.#stream = new ReadableStream<RequestEvent>({
      start: (controller) => {
        this.#controller = controller;
        const server = this.#server = createServer((req, res) => {
          controller.enqueue(
            new RequestEvent(req, res, this.#host, this.#address),
          );
        });
        this.#abortController.signal.addEventListener(
          "abort",
          () => {
            try {
              controller.close();
            } catch {
              // just swallow here
            }
          },
          { once: true },
        );
        server.listen({
          port: this.#port,
          host: this.#host,
          signal: this.#abortController.signal,
        });
        this.#address = server.address();
      },
    });
    return {
      addr: {
        port: this.#port,
        hostname: this.#host,
        transport: "tcp",
      },
    };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<RequestEvent> {
    if (!this.#stream) {
      throw new TypeError("Serer hasn't started listening.");
    }
    return this.#stream[Symbol.asyncIterator]();
  }
}
