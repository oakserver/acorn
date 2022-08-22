/** The interface to allow handling of request bodies in a structured way. */
export interface Deserializer<Type, Params extends Record<string, string>> {
  /** Given the request body as a string along with any parameters parsed when
   * matching the route and the original {@linkcode Request} return a value to
   * represent the body which will be provided to the route handler.
   *
   * This is intended to allow validation and hydration of objects to be
   * provided to route handlers.
   *
   * @param value the value of the request body as a string.
   * @param params any parameters that were parsed from the route when the route
   *               was matched.
   * @param request the original request that was matched to the route.
   */
  parse(value: string, params: Params, request: Request): Promise<Type> | Type;
}

/** An interface for handling the responses from a route handler in a structured
 * way. */
export interface Serializer<Params extends Record<string, string>> {
  /** Convert a value returned from a route handler into a JSON string, either
   * synchronously or asynchronously.
   *
   * If the route handler returns a {@linkcode Response} or {@linkcode BodyInit}
   * this method will not be called.
   *
   * If a `.toResponse()` is provided, this method will not be called.
   *
   * @param value This is the value returned from the route handler. */
  stringify?(value: unknown): string | Promise<string>;

  /** A method that takes a value returned from a response handler, along with
   * any parameters parsed when matching the route and the original request,
   * returning a full {@linkcode Response} which will be used to respond to the
   * request.
   *
   * If the route handler returns a `Response` or {@linkcode BodyInit} this
   * method will not be called.
   *
   * If this method is provided, the `.stringify()` method will not be called,
   * even if it exists.
   *
   * @param value This is the value returned from the route handler.
   * @param params Any parameters that were parsed from the route when the route
   *               was matched.
   * @param request The original request that triggered the route to be matched.
   */
  toResponse?(
    value: unknown,
    params: Params,
    request: Request,
  ): Response | Promise<Response>;
}

export interface RequestEvent {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): Promise<void>;
}

export interface Listener {
  addr: { hostname: string; port: number };
}

export interface Server extends AsyncIterable<RequestEvent> {
  close(): Promise<void> | void;
  listen(): Promise<Listener> | Listener;
  [Symbol.asyncIterator](): AsyncIterableIterator<RequestEvent>;
}

export interface ListenOptions {
  port: number;
  hostname?: string;
}

export interface ListenTlsOptions extends ListenOptions {
  key?: string;
  cert?: string;
}

export interface ServerConstructor {
  new (
    errorTarget: EventTarget,
    options: ListenOptions | ListenTlsOptions,
  ): Server;
  prototype: Server;
}

export type ServeHandler = (
  request: Request,
) => Response | Promise<Response> | void | Promise<void>;

export interface ServeInit {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onError?: (error: unknown) => Response | Promise<Response>;
  onListen?: (params: { hostname: string; port: number }) => void;
}

export interface ServeTlsInit extends ServeInit {
  cert: string;
  key: string;
}

export interface Destroyable {
  destroy(): void;
}

export interface HttpConn extends AsyncIterable<RequestEvent> {
  readonly rid: number;
  nextRequest(): Promise<RequestEvent | null>;
  close(): void;
}
