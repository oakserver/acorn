// Copyright 2018-2024 the oak authors. All rights reserved.

import type { HttpMethod } from "@oak/commons/method";

export interface CloudflareFetchHandler<
  Env extends Record<string, string> = Record<string, string>,
> {
  /** A method that is compatible with the Cloudflare Worker
   * [Fetch Handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/)
   * and can be exported to handle Cloudflare Worker fetch requests.
   *
   * # Example
   *
   * ```ts
   * import { Application } from "@oak/oak";
   *
   * const app = new Application();
   * app.use((ctx) => {
   *   ctx.response.body = "hello world!";
   * });
   *
   * export default { fetch: app.fetch };
   * ```
   */
  (
    request: Request,
    env: Env,
    ctx: CloudflareExecutionContext,
  ): Promise<Response>;
}

export interface Removeable {
  remove(): void;
}

export interface ParamsDictionary {
  [key: string]: string;
}

export interface QueryParamsDictionary {
  [key: string]:
    | undefined
    | string
    | string[]
    | QueryParamsDictionary
    | QueryParamsDictionary[];
}

export interface Addr {
  transport: "tcp" | "udp";
  hostname: string;
  port: number;
}

export interface UpgradeWebSocketOptions {
  /** Sets the `.protocol` property on the client side web socket to the
   * value provided here, which should be one of the strings specified in the
   * `protocols` parameter when requesting the web socket. This is intended
   * for clients and servers to specify sub-protocols to use to communicate to
   * each other. */
  protocol?: string;
  /** If the client does not respond to this frame with a
   * `pong` within the timeout specified, the connection is deemed
   * unhealthy and is closed. The `close` and `error` event will be emitted.
   *
   * The default is 120 seconds. Set to `0` to disable timeouts. */
  idleTimeout?: number;
}

/**
 * The abstract interface the defines the server abstraction that acorn relies
 * upon. Any sever implementation needs to adhere to this interface.
 */
export interface RequestServer<
  Env extends Record<string, string> = Record<string, string>,
> {
  /**
   * Determines if the server is currently listening for requests.
   */
  readonly closed: boolean;
  /**
   * Start listening for requests.
   */
  listen(): Promise<Addr> | Addr;
  /**
   * Yields up {@linkcode RequestEvent}s as they are received by the server.
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<RequestEvent<Env>>;
}

export interface TlsOptions {
  key: string;
  cert: string;
  ca?: string | TypedArray | File | Array<string | TypedArray | File>;
  passphrase?: string;
  dhParamsFile?: string;
  alpnProtocols?: string[];
}

/**
 * Options that will be passed to a {@linkcode RequestServer} from acorn on
 * construction of the server.
 */
export interface RequestServerOptions {
  hostname?: string;
  port?: number;
  signal: AbortSignal;
  tls?: TlsOptions;
}

/**
 * The abstract interface that defines what a {@linkcode RequestServer}
 * constructor needs to adhere to. */
export interface RequestServerConstructor {
  new <Env extends Record<string, string> = Record<string, string>>(
    options: RequestServerOptions,
  ): RequestServer<Env>;
  prototype: RequestServer;
}

/**
 * The abstract interface that defines what needs to be implemented for a
 * request event.
 */
export interface RequestEvent<
  Env extends Record<string, string> = Record<string, string>,
> {
  /**
   * The address representation of the originator of the request.
   */
  readonly addr: Addr;
  /**
   * A unique identifier for the request event.
   */
  readonly id: string;
  /**
   * Provides access to environment variable keys and values.
   */
  readonly env: Env | undefined;
  /**
   * The Fetch API standard {@linkcode Request} which should be processed.
   */
  readonly request: Request;
  /**
   * A promise which should resolve with the supplied {@linkcode Response}.
   */
  readonly response: Promise<Response>;
  /**
   * An indicator of if the response method has been invoked yet.
   */
  readonly responded: boolean;
  readonly url: URL;
  // deno-lint-ignore no-explicit-any
  error(reason?: any): void;
  respond(response: Response): void | Promise<void>;
  upgrade?(options?: UpgradeWebSocketOptions): WebSocket;
}

export interface CloudflareExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export type TypedArray =
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

type RemoveTail<S extends string, Tail extends string> = S extends
  `${infer P}${Tail}` ? P : S;

type GetRouteParameter<S extends string> = RemoveTail<
  RemoveTail<RemoveTail<S, `/${string}`>, `-${string}`>,
  `.${string}`
>;

/**
 * A type which supports inferring parameters that will be parsed from the
 * route.
 *
 * @template Route the string literal used to infer the route parameters
 */
export type RouteParameters<Route extends string> = string extends Route
  ? ParamsDictionary
  : Route extends `${string}(${string}` ? ParamsDictionary
  : Route extends `${string}:${infer Rest}` ?
      & (
        GetRouteParameter<Rest> extends never ? ParamsDictionary
          : GetRouteParameter<Rest> extends `${infer ParamName}?`
            ? { [P in ParamName]?: string }
          : { [P in GetRouteParameter<Rest>]: string }
      )
      & (Rest extends `${GetRouteParameter<Rest>}${infer Next}`
        ? RouteParameters<Next>
        : unknown)
  // deno-lint-ignore ban-types
  : {};

export interface Route<
  Env extends Record<string, string> = Record<string, string>,
> {
  readonly methods: HttpMethod[];
  readonly path: string;

  handle(
    requestEvent: RequestEvent<Env>,
    responseHeaders: Headers,
    secure: boolean,
  ): Promise<Response | undefined>;
  matches(pathname: string, method: HttpMethod): boolean;
}
