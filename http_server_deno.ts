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
  UpgradeWebSocketOptions,
} from "./types_internal.ts";
import { createPromiseWithResolvers } from "./util.ts";

// `Deno.serve()` API

interface ServeHandlerInfo {
  remoteAddr: Deno.NetAddr;
}

type ServeHandler = (
  request: Request,
  info: ServeHandlerInfo,
) => Response | Promise<Response>;

interface HttpServer extends AsyncDisposable {
  finished: Promise<void>;
  ref(): void;
  unref(): void;
  shutdown(): Promise<void>;
}

interface ServeInit {
  handler: ServeHandler;
}

const serve:
  | ((
    options: ServeInit & (ServeOptions | ServeTlsOptions),
  ) => HttpServer)
  | undefined = "Deno" in globalThis && "serve" in globalThis.Deno
    ? globalThis.Deno.serve.bind(globalThis.Deno)
    : undefined;

class RequestEvent implements _RequestEvent {
  #addr: Addr;
  //deno-lint-ignore no-explicit-any
  #reject: (reason?: any) => void;
  #request: Request;
  #resolve: (value: Response) => void;
  #resolved = false;
  #response: Promise<Response>;

  get addr(): Addr {
    return this.#addr;
  }

  get request(): Request {
    return this.#request;
  }

  get response(): Promise<Response> {
    return this.#response;
  }

  constructor(request: Request, { remoteAddr }: ServeHandlerInfo) {
    this.#addr = remoteAddr;
    this.#request = request;
    const { resolve, reject, promise } = createPromiseWithResolvers<Response>();
    this.#resolve = resolve;
    this.#reject = reject;
    this.#response = promise;
  }

  //deno-lint-ignore no-explicit-any
  error(reason?: any): void {
    if (this.#resolved) {
      throw new Error("Request already responded to.");
    }
    this.#resolved = true;
    this.#reject(reason);
  }

  respond(response: Response): void {
    if (this.#resolved) {
      throw new Error("Request already responded to.");
    }
    this.#resolved = true;
    this.#resolve(response);
  }

  upgrade(options?: UpgradeWebSocketOptions | undefined): WebSocket {
    if (this.#resolved) {
      throw new Error("Request already responded to.");
    }
    const { response, socket } = Deno.upgradeWebSocket(this.#request, options);
    this.respond(response);
    return socket;
  }
}

/** An abstraction for Deno's built in HTTP Server that is used to manage
 * HTTP requests in a uniform way. */
export default class DenoServer implements Server {
  #closed = false;
  #controller?: ReadableStreamDefaultController<RequestEvent>;
  #httpServer?: HttpServer;
  #options: Omit<ServeOptions | ServeTlsOptions, "signal">;
  #stream?: ReadableStream<RequestEvent>;

  get closed(): boolean {
    return this.#closed;
  }

  constructor(options: Omit<ServeOptions | ServeTlsOptions, "signal">) {
    this.#options = options;
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    if (this.#httpServer) {
      this.#httpServer.unref();
      await this.#httpServer.shutdown();
      this.#httpServer = undefined;
    }
    this.#controller?.close();
    this.#closed = true;
  }

  listen(): Promise<Listener> {
    if (this.#httpServer) {
      throw new Error("Server already listening.");
    }
    const { onListen, ...options } = this.#options;
    const { promise, resolve } = createPromiseWithResolvers<Listener>();
    this.#stream = new ReadableStream<RequestEvent>({
      start: (controller) => {
        this.#controller = controller;
        this.#httpServer = serve?.({
          handler: (req, info) => {
            const requestEvent = new RequestEvent(req, info);
            controller.enqueue(requestEvent);
            return requestEvent.response;
          },
          onListen({ hostname, port }) {
            if (onListen) {
              onListen({ hostname, port });
            }
            resolve({ addr: { transport: "tcp", hostname, port } });
          },
          ...options,
        });
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
