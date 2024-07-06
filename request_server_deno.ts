// Copyright 2018-2024 the oak authors. All rights reserved.

import { createHttpError } from "@oak/commons/http_errors";
import { Status } from "@oak/commons/status";
import hyperid from "hyperid";

import type {
  Addr,
  RequestEvent,
  RequestServer,
  RequestServerOptions,
  UpgradeWebSocketOptions,
} from "./types.ts";
import { createPromiseWithResolvers } from "./utils.ts";

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

interface ServeOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  reusePort?: boolean;
  onError?: (error: unknown) => Response | Promise<Response>;
  onListen?: (params: { hostname: string; port: number }) => void;
}

interface ServeTlsOptions extends ServeOptions {
  cert: string;
  key: string;
}

const serve:
  | ((options: ServeInit & (ServeOptions | ServeTlsOptions)) => HttpServer)
  | undefined = "Deno" in globalThis && "serve" in globalThis.Deno
    ? globalThis.Deno.serve.bind(globalThis.Deno)
    : undefined;

const instance = hyperid({ urlSafe: true });

/**
 * The implementation of the {@linkcode RequestEvent} interface for Deno.
 */
class DenoRequestEvent<
  Env extends Record<string, string> = Record<string, string>,
> implements RequestEvent<Env> {
  #addr: Addr;
  #env: Env;
  #id = instance();
  #promise: Promise<Response>;
  //deno-lint-ignore no-explicit-any
  #reject: (reason?: any) => void;
  #request: Request;
  #resolve: (value: Response | PromiseLike<Response>) => void;
  #responded = false;
  #url: URL;

  get addr(): Addr {
    return this.#addr;
  }

  get env(): Env {
    return this.#env;
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

  constructor(request: Request, { remoteAddr }: ServeHandlerInfo, env: Env) {
    this.#addr = remoteAddr;
    this.#request = request;
    this.#env = env;
    const { promise, reject, resolve } = createPromiseWithResolvers<Response>();
    this.#promise = promise;
    this.#reject = reject;
    this.#resolve = resolve;
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

  upgrade(options?: UpgradeWebSocketOptions | undefined): WebSocket {
    if (this.#responded) {
      throw createHttpError(
        Status.InternalServerError,
        "Request already responded to.",
      );
    }
    const { response, socket } = Deno.upgradeWebSocket(this.#request, options);
    this.#responded = true;
    this.#resolve(response);
    return socket;
  }

  [Symbol.for("Deno.customInspect")](
    inspect: (value: unknown) => string,
  ): string {
    return `${this.constructor.name} ${
      inspect({
        addr: this.#addr,
        env: this.#env,
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
        addr: this.#addr,
        env: this.#env,
        id: this.#id,
        request: this.#request,
        responded: this.#responded,
        response: this.#promise,
        url: this.#url,
      }, newOptions)
    }`;
  }
}

/**
 * The implementation of the server API for Deno runtime and Deno Deploy.
 */
export default class DenoServer<
  Env extends Record<string, string> = Record<string, string>,
> implements RequestServer<Env> {
  #closed = true;
  #controller?: ReadableStreamDefaultController<RequestEvent>;
  #env: Env;
  #options: RequestServerOptions;
  #server?: HttpServer;
  #stream?: ReadableStream<DenoRequestEvent<Env>>;

  get closed(): boolean {
    return this.#closed;
  }

  constructor(options: RequestServerOptions) {
    this.#options = options;
    this.#options.signal.addEventListener("abort", async () => {
      if (this.#closed) {
        return;
      }

      this.#closed = true;
      if (this.#server) {
        this.#server.unref();
        await this.#server.shutdown();
        this.#server = undefined;
      }
      try {
        this.#controller?.close();
      } catch {
        // just ignore here
      }
      this.#stream = undefined;
      this.#controller = undefined;
      this.#server = undefined;
    });
    this.#env = Object.freeze(Deno.env.toObject()) as Env;
  }

  listen(): Promise<Addr> {
    if (!this.#closed) {
      throw new Error("Server already listening.");
    }
    const { promise, resolve } = createPromiseWithResolvers<Addr>();
    this.#stream = new ReadableStream<DenoRequestEvent<Env>>({
      start: (controller) => {
        if (!serve) {
          return controller.error(
            createHttpError(
              Status.InternalServerError,
              "Unable to start server, cannot find Deno.serve().",
            ),
          );
        }
        this.#controller = controller;
        const {
          port,
          hostname,
          signal,
          tls: { key, cert } = {},
        } = this.#options;
        if (!((!key && !cert) || (key && cert))) {
          throw createHttpError(
            Status.InternalServerError,
            "Invalid configuration of TLS.",
          );
        }
        this.#server = serve({
          handler: (request, info) => {
            const requestEvent = new DenoRequestEvent(request, info, this.#env);
            controller.enqueue(requestEvent);
            return requestEvent.response;
          },
          onListen: ({ hostname, port }) => {
            this.#closed = false;
            resolve({ hostname, port, transport: "tcp" });
          },
          port,
          hostname,
          signal,
          key,
          cert,
        });
      },
    });
    return promise;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<DenoRequestEvent<Env>> {
    if (!this.#stream) {
      throw createHttpError(
        Status.InternalServerError,
        "Server hasn't started listening.",
      );
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
