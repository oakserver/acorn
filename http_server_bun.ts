// Copyright 2022-2024 the oak authors. All rights reserved.

/**
 * The implementation of the acorn server interface for Deno CLI and Deno
 * Deploy.
 *
 * @module
 */

import type {
  Addr,
  Listener,
  RequestEvent as _RequestEvent,
  ServeOptions,
  Server,
  ServeTlsOptions,
} from "./types_internal.ts";
import { createPromiseWithResolvers } from "./util.ts";

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

function isServeTlsOptions(
  value: Omit<ServeOptions | ServeTlsOptions, "signal">,
): value is Omit<ServeTlsOptions, "signal"> {
  return !!("cert" in value && "key" in value);
}

class RequestEvent implements _RequestEvent {
  #promise: Promise<Response>;
  // deno-lint-ignore no-explicit-any
  #reject: (reason?: any) => void;
  #request: Request;
  #resolve: (value: Response | PromiseLike<Response>) => void;
  #resolved = false;
  #socketAddr: SocketAddress | null;

  get addr(): Addr {
    return {
      transport: "tcp",
      hostname: this.#socketAddr?.address ?? "",
      port: this.#socketAddr?.port ?? 0,
    };
  }

  get request(): Request {
    return this.#request;
  }

  get response(): Promise<Response> {
    return this.#promise;
  }

  constructor(request: Request, server: BunServer) {
    this.#request = request;
    this.#socketAddr = server.requestIP(request);
    const { resolve, reject, promise } = createPromiseWithResolvers<Response>();
    this.#resolve = resolve;
    this.#reject = reject;
    this.#promise = promise;
  }

  // deno-lint-ignore no-explicit-any
  error(reason?: any): void {
    if (this.#resolved) {
      throw new Error("Request already responded to.");
    }
    this.#resolved = true;
    this.#reject(reason);
  }

  respond(response: Response | PromiseLike<Response>): void {
    if (this.#resolved) {
      throw new Error("Request already responded to.");
    }
    this.#resolved = true;
    this.#resolve(response);
  }
}

/** An abstraction for Bun's built in HTTP Server that is used to manage
 * HTTP requests in a uniform way. */
export default class Steamer implements Server {
  #controller?: ReadableStreamDefaultController<RequestEvent>;
  #options: Omit<ServeOptions | ServeTlsOptions, "signal">;
  #server?: BunServer;
  #stream?: ReadableStream<RequestEvent>;

  constructor(options: Omit<ServeOptions | ServeTlsOptions, "signal">) {
    this.#options = options;
  }

  close(): void | Promise<void> {
    this.#controller?.close();
    this.#controller = undefined;
    this.#server?.stop();
    this.#server = undefined;
    this.#stream = undefined;
  }

  listen(): Listener | Promise<Listener> {
    if (this.#server) {
      throw new Error("Server already listening.");
    }
    const { onListen, hostname, port } = this.#options;
    const tls = isServeTlsOptions(this.#options)
      ? { key: this.#options.key, cert: this.#options.cert }
      : undefined;
    const { promise, resolve } = createPromiseWithResolvers<Listener>();
    this.#stream = new ReadableStream<RequestEvent>({
      start: (controller) => {
        this.#controller = controller;
        this.#server = Bun.serve({
          fetch(req, server) {
            const request = new RequestEvent(req, server);
            controller.enqueue(request);
            return request.response;
          },
          hostname,
          port,
          tls,
        });
        {
          const { hostname, port } = this.#server;
          if (onListen) {
            onListen({ hostname, port });
          }
          resolve({ addr: { hostname, port, transport: "tcp" } });
        }
      },
    });
    return promise;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<RequestEvent> {
    if (!this.#stream) {
      throw new TypeError("Server hasn't started listening.");
    }
    return this.#stream[Symbol.asyncIterator]();
  }
}
