// Copyright 2018-2024 the oak authors. All rights reserved.

import { createHttpError } from "@oak/commons/http_errors";
import { Status } from "@oak/commons/status";
import hyperid from "hyperid";
import process from "node:process";

import type {
  Addr,
  RequestEvent,
  RequestServer,
  RequestServerOptions,
} from "./types.ts";
import { createPromiseWithResolvers } from "./utils.ts";

type TypedArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array
  | Uint8ClampedArray;
type BunFile = File;

interface Bun {
  serve(options: {
    fetch: (req: Request, server: BunServer) => Response | Promise<Response>;
    hostname?: string;
    port?: number;
    development?: boolean;
    error?: (error: Error) => Response | Promise<Response>;
    tls?: {
      key?:
        | string
        | TypedArray
        | BunFile
        | Array<string | TypedArray | BunFile>;
      cert?:
        | string
        | TypedArray
        | BunFile
        | Array<string | TypedArray | BunFile>;
      ca?: string | TypedArray | BunFile | Array<string | TypedArray | BunFile>;
      passphrase?: string;
      dhParamsFile?: string;
    };
    maxRequestBodySize?: number;
    lowMemoryMode?: boolean;
  }): BunServer;
}

interface BunServer {
  development: boolean;
  hostname: string;
  port: number;
  pendingRequests: number;
  requestIP(req: Request): SocketAddress | null;
  stop(): void;
  upgrade(req: Request, options?: {
    headers?: HeadersInit;
    //deno-lint-ignore no-explicit-any
    data?: any;
  }): boolean;
}

interface SocketAddress {
  address: string;
  port: number;
  family: "IPv4" | "IPv6";
}

declare const Bun: Bun;

const instance = hyperid({ urlSafe: true });

/**
 * The implementation of the {@linkcode RequestEvent} interface for Bun.
 */
class BunRequestEvent<
  Env extends Record<string, string> = Record<string, string>,
> implements RequestEvent<Env> {
  #addr: Addr;
  #id = instance();
  // deno-lint-ignore no-explicit-any
  #reject: (reason?: any) => void;
  #request: Request;
  #resolve: (value: Response | PromiseLike<Response>) => void;
  #responded = false;
  #response: Promise<Response>;
  #url: URL;

  get addr(): Addr {
    return this.#addr;
  }

  get id(): string {
    return this.#id;
  }

  get env(): Env {
    return process.env as Env;
  }

  get request(): Request {
    return this.#request;
  }

  get responded(): boolean {
    return this.#responded;
  }

  get response(): Promise<Response> {
    return this.#response;
  }

  get url(): URL {
    return this.#url;
  }

  constructor(request: Request, server: BunServer) {
    this.#request = request;
    const socketAddr = server.requestIP(request);
    this.#addr = {
      hostname: socketAddr?.address ?? "",
      port: socketAddr?.port ?? 0,
      transport: "tcp",
    };
    const { resolve, reject, promise } = createPromiseWithResolvers<Response>();
    this.#resolve = resolve;
    this.#reject = reject;
    this.#response = promise;
    this.#url = URL.parse(request.url, "http://localhost/") ??
      new URL("http://localhost/");
  }

  //deno-lint-ignore no-explicit-any
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

  respond(response: Response): void {
    if (this.#responded) {
      throw createHttpError(
        Status.InternalServerError,
        "Request already responded to.",
      );
    }
    this.#responded = true;
    this.#resolve(response);
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
        addr: this.#addr,
        env: this.env,
        id: this.#id,
        request: this.#request,
        responded: this.#responded,
        response: this.#response,
        url: this.#url,
      }, newOptions)
    }`;
  }
}

/**
 * A request server that uses the Bun HTTP server to handle requests.
 */
export default class BunRequestServer<
  Env extends Record<string, string> = Record<string, string>,
> implements RequestServer<Env> {
  #closed = true;
  #controller?: ReadableStreamDefaultController<BunRequestEvent<Env>>;
  #options: RequestServerOptions;
  #server?: BunServer;
  #stream?: ReadableStream<BunRequestEvent<Env>>;

  get closed(): boolean {
    return this.#closed;
  }

  constructor(options: RequestServerOptions) {
    this.#options = options;
    this.#options.signal.addEventListener("abort", () => {
      this.#closed = true;
      this.#server?.stop();
      try {
        this.#controller?.close();
      } catch {
        // just swallow here
      }
      this.#server = undefined;
      this.#controller = undefined;
      this.#stream = undefined;
    }, { once: true });
  }

  listen(): Promise<Addr> {
    if (!this.#closed) {
      throw new Error("Server already listening.");
    }
    const { promise, resolve } = createPromiseWithResolvers<Addr>();
    this.#stream = new ReadableStream<BunRequestEvent<Env>>({
      start: (controller) => {
        if (!Bun) {
          return controller.error(
            createHttpError(
              Status.InternalServerError,
              "Unable to start server, cannot find Bun.",
            ),
          );
        }
        this.#controller = controller;
        const { hostname, port } = this.#server = Bun.serve({
          fetch(req, server) {
            const requestEvent = new BunRequestEvent<Env>(req, server);
            controller.enqueue(requestEvent);
            return requestEvent.response;
          },
          hostname: this.#options.hostname,
          port: this.#options.port,
          tls: this.#options.tls,
        });
        resolve({ hostname, port, transport: "tcp" });
      },
    });
    return promise;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<BunRequestEvent<Env>> {
    if (!this.#stream) {
      throw createHttpError(
        Status.InternalServerError,
        "Server hasn't started listening.",
      );
    }
    return this.#stream[Symbol.asyncIterator]();
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
