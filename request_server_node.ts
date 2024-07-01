// Copyright 2018-2024 the oak authors. All rights reserved.

import { createHttpError } from "@oak/commons/http_errors";
import { Status } from "@oak/commons/status";
import hyperid from "hyperid";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type {
  Addr,
  RequestEvent,
  RequestServer,
  RequestServerOptions,
} from "./types.ts";
import { createPromiseWithResolvers } from "./utils.ts";

const instance = hyperid({ urlSafe: true });

class NodeRequestEvent<Env extends Record<string, string>>
  implements RequestEvent<Env> {
  #id = instance();
  #incomingMessage: IncomingMessage;
  #promise: Promise<Response>;
  //deno-lint-ignore no-explicit-any
  #reject: (reason?: any) => void;
  #request: Request;
  #resolve: (value: Response | PromiseLike<Response>) => void;
  #responded = false;
  #serverResponse: ServerResponse<IncomingMessage>;
  #url: URL;

  get addr(): Addr {
    // deno-lint-ignore no-explicit-any
    const value: any = this.#incomingMessage.socket.address();
    return {
      transport: "tcp",
      hostname: value?.address ?? "",
      port: value?.port ?? 0,
    };
  }

  get env(): Env {
    // @ts-ignore available when running under Node.js
    return process.env;
  }

  get id(): string {
    return this.#id;
  }

  get request(): Request {
    return this.#request;
  }

  get responded(): boolean {
    return this.#responded;
  }

  get response(): Promise<Response> {
    return this.#promise;
  }

  get url(): URL {
    return this.#url;
  }

  constructor(
    incomingMessage: IncomingMessage,
    serverResponse: ServerResponse<IncomingMessage>,
    host: string,
    address: string | AddressInfo | null,
  ) {
    this.#incomingMessage = incomingMessage;
    this.#serverResponse = serverResponse;
    const { promise, resolve, reject } = createPromiseWithResolvers<Response>();
    this.#promise = promise;
    this.#resolve = resolve;
    this.#reject = reject;
    const headers = incomingMessage.headers as Record<string, string>;
    const method = incomingMessage.method ?? "GET";
    const url = this.#url = new URL(
      incomingMessage.url ?? "/",
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
          incomingMessage.on("data", (chunk) => controller.enqueue(chunk));
          incomingMessage.on("error", (err) => controller.error(err));
          incomingMessage.on("end", () => {
            try {
              controller.close();
            } catch {
              // just swallow here
            }
          });
        },
      });
    this.#request = new Request(url, { body, headers, method });
  }

  // deno-lint-ignore no-explicit-any
  error(reason?: any): void {
    if (this.#responded) {
      throw createHttpError(
        Status.InternalServerError,
        "Request already responded to.",
      );
    }
    this.#responded = true;
    this.#reject(reason);
  }

  async respond(response: Response): Promise<void> {
    if (this.#responded) {
      throw createHttpError(
        Status.InternalServerError,
        "Request already responded to.",
      );
    }
    this.#responded = true;
    const headers = new Map<string, string[]>();
    for (const [key, value] of response.headers) {
      if (!headers.has(key)) {
        headers.set(key, []);
      }
      headers.get(key)!.push(value);
    }
    for (const [key, value] of headers) {
      this.#serverResponse.setHeader(key, value);
    }
    if (response.body) {
      for await (const chunk of response.body) {
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

  [Symbol.for("Deno.customInspect")](
    inspect: (value: unknown) => string,
  ): string {
    return `${this.constructor.name} ${
      inspect({
        addr: this.addr,
        env: this.env,
        id: this.#id,
        request: this.#request,
        responded: this.#responded,
        response: this.#promise,
        url: this.#url,
      })
    }`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](
    depth: number,
    // deno-lint-ignore no-explicit-any
    options: any,
    inspect: (value: unknown, options?: unknown) => string,
    // deno-lint-ignore no-explicit-any
  ): any {
    if (depth < 0) {
      return options.stylize(`[${this.constructor.name}]`, "special");
    }

    const newOptions = Object.assign({}, options, {
      depth: options.depth === null ? null : options.depth - 1,
    });
    return `${options.stylize(this.constructor.name, "special")} ${
      inspect({
        addr: this.addr,
        env: this.env,
        id: this.#id,
        request: this.#request,
        responded: this.#responded,
        response: this.#promise,
        url: this.#url,
      }, newOptions)
    }`;
  }
}

export default class NodeRequestServer<
  Env extends Record<string, string> = Record<string, string>,
> implements RequestServer<Env> {
  #address: string | AddressInfo | null = null;
  #closed = true;
  #hostname: string;
  #port: number;
  #signal: AbortSignal;
  #stream?: ReadableStream<NodeRequestEvent<Env>>;

  get closed(): boolean {
    return this.#closed;
  }

  constructor(options: RequestServerOptions) {
    const { hostname, port, signal } = options;
    this.#hostname = hostname ?? "127.0.0.1";
    this.#port = port ?? 80;
    this.#signal = signal;
  }

  async listen(): Promise<Addr> {
    if (!("Request" in globalThis) || !("Response" in globalThis)) {
      await import("npm:buffer@^6.0");
      await import("npm:string_decoder@^1.3");
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
    const { resolve, promise } = createPromiseWithResolvers<Addr>();
    this.#stream = new ReadableStream<NodeRequestEvent<Env>>({
      start: (controller) => {
        const server = createServer(
          (incomingMessage, serverResponse) => {
            controller.enqueue(
              new NodeRequestEvent(
                incomingMessage,
                serverResponse,
                this.#hostname,
                this.#address,
              ),
            );
          },
        );
        this.#closed = false;
        this.#signal.addEventListener("abort", () => {
          try {
            controller.close();
          } catch {
            // just ignore here
          }
        });
        server.listen(
          {
            port: this.#port,
            hostname: this.#hostname,
            signal: this.#signal,
          },
          () =>
            resolve({
              port: this.#port,
              hostname: this.#hostname,
              transport: "tcp",
            }),
        );
      },
    });
    return promise;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<NodeRequestEvent<Env>> {
    if (!this.#stream) {
      throw new TypeError("Server hasn't started listening.");
    }
    return this.#stream[Symbol.asyncIterator]();
  }

  [Symbol.for("Deno.customInspect")](
    inspect: (value: unknown) => string,
  ): string {
    return `${this.constructor.name} ${inspect({ closed: this.#closed })}`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](
    depth: number,
    // deno-lint-ignore no-explicit-any
    options: any,
    inspect: (value: unknown, options?: unknown) => string,
    // deno-lint-ignore no-explicit-any
  ): any {
    if (depth < 0) {
      return options.stylize(`[${this.constructor.name}]`, "special");
    }

    const newOptions = Object.assign({}, options, {
      depth: options.depth === null ? null : options.depth - 1,
    });
    return `${options.stylize(this.constructor.name, "special")} ${
      inspect({ closed: this.#closed }, newOptions)
    }`;
  }
}
