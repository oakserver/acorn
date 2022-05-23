// Copyright 2022 the oak authors. All rights reserved.

import { Context } from "./context.ts";
import {
  Cookies,
  createHttpError,
  isHttpError,
  type KeyRing,
  Status,
} from "./deps.ts";
import { NativeHttpServer } from "./http_server_native.ts";
import {
  type Deserializer,
  type Destroyable,
  type Listener,
  type RequestEvent,
  type Serializer,
  type ServerConstructor,
} from "./types.d.ts";
import {
  assert,
  CONTENT_TYPE_JSON,
  Deferred,
  isBodyInit,
  responseFromHttpError,
} from "./util.ts";

/** Valid return values from a route handler. */
export type RouteResponse<Type> = Response | BodyInit | Type;

type ParamsDictionary = Record<string, string>;

type RemoveTail<S extends string, Tail extends string> = S extends
  `${infer P}${Tail}` ? P : S;

type GetRouteParameter<S extends string> = RemoveTail<
  RemoveTail<RemoveTail<S, `/${string}`>, `-${string}`>,
  `.${string}`
>;

/** The type alias to help infer what the route parameters are for a route based
 * on the route string. */
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
  : ParamsDictionary;

/** The interface for route handlers, which are provided via a context
 * argument. The route handler is expected to return a
 * {@linkcode RouteResponse} or `undefined` if it cannot handle the request,
 * which will typically result in a 404 being returned to the client. */
export interface RouteHandler<
  ResponseType,
  BodyType = unknown,
  Params extends Record<string, string> = Record<string, string>,
> {
  (
    context: Context<BodyType, Params>,
  ):
    | Promise<RouteResponse<ResponseType> | undefined>
    | RouteResponse<ResponseType>
    | undefined;
}

/** An error handler is tied to a specific route and can implement custom logic
 * to deal with an error that occurred when processing the route. */
interface ErrorHandler {
  (
    request: Request,
    error: unknown,
  ): Response | undefined | Promise<Response | undefined>;
}

/** Options that can be specified when adding a route to the router. */
export interface RouteOptions<
  R extends string,
  BodyType,
  Params extends RouteParameters<R>,
> {
  /** An optional deserializer to use when decoding the body. This can be used
   * to validate the body of the request or hydrate an object. */
  deserializer?: Deserializer<BodyType, Params>;

  /** An error handler which is specific to this route, which will be called
   * when there is an error thrown when trying to process the route. */
  errorHandler?: ErrorHandler;

  /** The serializer is used to serialize a return value of the route handler,
   * when the value is not a {@linkcode Response} or {@linkcode BodyInit}. The
   * optional `.stringify()` method of the serializer is expected to return a
   * JSON string representation of the body returned from the handler, where as
   * the `.toResponse()` method is expected to return a full
   * {@linkcode Response} object. */
  serializer?: Serializer<Params>;
}

/** An interface of route options which also includes the handler, intended to
 * make it easy to provide a single object to register a route. */
export interface RouteOptionsWithHandler<
  R extends string,
  BodyType,
  Params extends RouteParameters<R>,
  ResponseType,
> extends RouteOptions<R, BodyType, Params> {
  handler: RouteHandler<ResponseType, BodyType, Params>;
}

const HTTP_VERBS = [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
] as const;

const HANDLE_START = "handle start";

type HTTPVerbs = typeof HTTP_VERBS[number];

interface NotFoundEventListener {
  (evt: NotFoundEvent): void | Promise<void>;
}

interface NotFoundListenerObject {
  handleEvent(evt: NotFoundEvent): void | Promise<void>;
}

type NotFoundEventListenerOrEventListenerObject =
  | NotFoundEventListener
  | NotFoundListenerObject;

interface HandledEventListener {
  (evt: HandledEvent): void | Promise<void>;
}

interface HandledEventListenerObject {
  handleEvent(evt: HandledEvent): void | Promise<void>;
}

type HandledEventListenerOrEventListenerObject =
  | HandledEventListener
  | HandledEventListenerObject;

interface RouterErrorEventListener {
  (evt: RouterErrorEvent): void | Promise<void>;
}

interface RouterErrorEventListenerObject {
  handleEvent(evt: RouterErrorEvent): void | Promise<void>;
}

type RouterErrorEventListenerOrEventListenerObject =
  | RouterErrorEventListener
  | RouterErrorEventListenerObject;

interface RouterListenEventListener {
  (evt: RouterListenEvent): void | Promise<void>;
}

interface RouterListenEventListenerObject {
  handleEvent(evt: RouterListenEvent): void | Promise<void>;
}

type RouterListenEventListenerOrEventListenerObject =
  | RouterListenEventListener
  | RouterListenEventListenerObject;

interface NotFoundEventInit extends EventInit {
  request: Request;
}

export class NotFoundEvent extends Event {
  #request: Request;

  get request(): Request {
    return this.#request;
  }

  response?: Response;

  constructor(eventInitDict: NotFoundEventInit) {
    super("notfound", eventInitDict);
    this.#request = eventInitDict.request;
  }
}

interface HandledEventInit extends EventInit {
  measure: PerformanceMeasure;
  request: Request;
  response: Response;
  route?: Route;
}

export class HandledEvent extends Event {
  #measure: PerformanceMeasure;
  #request: Request;
  #response: Response;
  #route?: Route;

  /** The performance measure from the start of handling the route until it
   * finished, which can provide timing information about the processing. */
  get measure(): PerformanceMeasure {
    return this.#measure;
  }

  /** The {@linkcode Request} that was handled. */
  get request(): Request {
    return this.#request;
  }

  /** The {@linkcode Response} that was handled. */
  get response(): Response {
    return this.#response;
  }

  /** The {@linkcode Route} that was matched. */
  get route(): Route | undefined {
    return this.#route;
  }

  constructor(eventInitDict: HandledEventInit) {
    super("handled", eventInitDict);
    this.#request = eventInitDict.request;
    this.#response = eventInitDict.response;
    this.#route = eventInitDict.route;
    this.#measure = eventInitDict.measure;
  }
}

interface RouterErrorEventInit extends ErrorEventInit {
  request?: Request;
  respondable?: boolean;
  route?: Route;
}

/** Error events from the router will be of this type, which provides additional
 * context about the error and provides a way to override the default behaviors
 * of the router. */
export class RouterErrorEvent extends ErrorEvent {
  #request?: Request;
  #respondable: boolean;
  #route?: Route;

  /** The original {@linkcode Request} object. */
  get request(): Request | undefined {
    return this.#request;
  }

  /** To provide a custom response to an error event set a {@linkcode Response}
   * to this property and it will be used instead of the built in default.
   *
   * The `.respondable` property will indicate if a response to the client is
   * possible or not.
   */
  response?: Response;

  /** Indicates if the error can be responded to. `true` indicates that a
   * `Response` has not been sent to the client yet, while `false` indicates
   * that a response cannot be sent. */
  get respondable(): boolean {
    return this.#respondable;
  }

  /** If the error occurred while processing a route, the {@linkcode Route} will
   * be available on this property. */
  get route(): Route | undefined {
    return this.#route;
  }

  constructor(eventInitDict: RouterErrorEventInit) {
    super("error", eventInitDict);
    this.#request = eventInitDict.request;
    this.#respondable = eventInitDict.respondable ?? false;
    this.#route = eventInitDict.route;
  }
}

interface RouterListenEventInit extends EventInit {
  hostname: string;
  listener: Listener;
  port: number;
  secure: boolean;
}

/** The event class that is emitted when the router starts listening. */
export class RouterListenEvent extends Event {
  #hostname: string;
  #listener: Listener;
  #port: number;
  #secure: boolean;

  /** The hostname that is being listened on. */
  get hostname(): string {
    return this.#hostname;
  }

  /** A reference to the {@linkcode Listener} being listened to. */
  get listener(): Listener {
    return this.#listener;
  }

  /** The port that is being listened on. */
  get port(): number {
    return this.#port;
  }

  /** A flag to indicate if the router believes it is running in a secure
   * context (e.g. TLS/HTTPS). */
  get secure(): boolean {
    return this.#secure;
  }

  constructor(eventInitDict: RouterListenEventInit) {
    super("listen", eventInitDict);
    this.#hostname = eventInitDict.hostname;
    this.#listener = eventInitDict.listener;
    this.#port = eventInitDict.port;
    this.#secure = eventInitDict.secure;
  }
}

interface ListenOptionsBase {
  hostname?: string;
  port?: number;
  secure?: boolean;
  server?: ServerConstructor;
  signal?: AbortSignal;
}

interface ListenOptionsSecure extends ListenOptionsBase {
  /** Server private key in PEM format */
  key?: string;
  /** Cert chain in PEM format */
  cert?: string;
  /** Application-Layer Protocol Negotiation (ALPN) protocols to announce to
   * the client. If not specified, no ALPN extension will be included in the
   * TLS handshake. */
  alpnProtocols?: string[];
  secure: true;
}

type ListenOptions = ListenOptionsBase | ListenOptionsSecure;

interface InternalState {
  closed: boolean;
  closing: boolean;
  handling: Set<Promise<void>>;
  server: ServerConstructor;
}

export interface RouterOptions {
  /** A key ring which will be used for signing and validating cookies. */
  keys?: KeyRing;
  /** When providing internal responses, like on unhandled errors, prefer JSON
   * responses to HTML responses. When set to `false` HTML will be preferred
   * when responding, but content type negotiation will still be respected.
   *  Defaults to `true`. */
  preferJson?: boolean;
}

function appendHeaders(response: Response, headers: Headers): Response {
  for (const [key, value] of headers) {
    response.headers.append(key, value);
  }
  return response;
}

class Route<
  R extends string = string,
  BodyType = unknown,
  Params extends RouteParameters<R> = RouteParameters<R>,
  ResponseType = unknown,
> {
  #handler: RouteHandler<unknown, BodyType, Params>;
  #deserializer?: Deserializer<BodyType, Params>;
  #destroyHandle: Destroyable;
  #errorHandler?: ErrorHandler;
  #params?: Params;
  #route: R;
  #serializer?: Serializer<Params>;
  #urlPattern: URLPattern;
  #verbs: HTTPVerbs[];

  get route(): R {
    return this.#route;
  }

  constructor(
    verbs: HTTPVerbs[],
    route: R,
    handler: RouteHandler<ResponseType, BodyType, Params>,
    destroyHandle: Destroyable,
    { deserializer, errorHandler, serializer }: RouteOptions<
      R,
      BodyType,
      Params
    >,
  ) {
    this.#verbs = verbs;
    this.#route = route;
    this.#urlPattern = new URLPattern({ pathname: route });
    this.#handler = handler;
    this.#deserializer = deserializer;
    this.#errorHandler = errorHandler;
    this.#serializer = serializer;
    this.#destroyHandle = destroyHandle;
  }

  destroy(): void {
    this.#destroyHandle.destroy();
  }

  error(
    request: Request,
    error: unknown,
  ): Response | undefined | Promise<Response | undefined> {
    if (this.#errorHandler) {
      return this.#errorHandler(request, error);
    }
  }

  async handle(
    request: Request,
    secure: boolean,
    keys?: KeyRing,
  ): Promise<Response | undefined> {
    assert(this.#params, "params should have been set in .matches()");
    const headers = new Headers();
    const cookies = new Cookies(request.headers, headers, {
      keys,
      secure,
    });
    const context = new Context<BodyType, Params>(
      {
        cookies,
        deserializer: this.#deserializer,
        params: this.#params,
        request,
      },
    );
    const result = (await this.#handler(context)) as RouteResponse<
      ResponseType
    >;
    if (result instanceof Response) {
      return appendHeaders(result, headers);
    }
    if (isBodyInit(result)) {
      headers.set("content-type", CONTENT_TYPE_JSON);
      return new Response(result, { headers });
    }
    if (result) {
      if (this.#serializer?.toResponse) {
        return appendHeaders(
          await this.#serializer.toResponse(result, this.#params, request),
          headers,
        );
      } else {
        headers.set("content-type", CONTENT_TYPE_JSON);
        return new Response(
          this.#serializer?.stringify
            ? await this.#serializer.stringify(result)
            : JSON.stringify(result),
          { headers },
        );
      }
    }
    return undefined;
  }

  matches(request: Request): boolean {
    if (this.#verbs.includes(request.method as HTTPVerbs)) {
      const result = this.#urlPattern.exec(request.url);
      if (result) {
        this.#params = result.pathname.groups as Params;
      }
      return !!result;
    }
    return false;
  }
}

/** A router which is specifically geared for handling RESTful type of requests
 * and providing a straight forward API to respond to them.
 *
 * A {@linkcode RouteHandler} is registered with the router, and when a request
 * matches a route the handler will be invoked. The handler will be provided
 * with {@linkcode Context} of the current request. The handler can return a
 * web platform
 * [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response)
 * instance, {@linkcode BodyInit} value, or any other object which will be to be
 * serialized to a JSON string as set as the value of the response body.
 *
 * The handler context includes a property named `cookies` which is an instance
 * of {@linkcode Cookies}, which provides an interface for reading request
 * cookies and setting cookies in the response. `Cookies` supports cryptographic
 * signing of keys using a key ring which adheres to the {@linkcode KeyRing}
 * interface, which can be passed as an option when creating the router.
 * [KeyStack](https://doc.deno.land/https://deno.land/x/oak_commons/key_stack.ts/~/KeyStack)
 * is a key ring that implements this interface.
 *
 * The route is specified using the pathname part of the
 * [`URLPattern` API](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API),
 * which supports routes with wildcards (e.g. `/posts/*`) and named groups (e.g.
 * `/books/:id`) which are then provided as `.params` on the context argument to
 * the handler.
 *
 * When registering a route handler, a {@linkcode Deserializer},
 * {@linkcode Serializer}, and {@linkcode ErrorHandler} can all be specified.
 * When a deserializer is specified and a request has a body, the deserializer
 * will be used to parse the body. This is designed to make it possible to
 * validate a body or hydrate an object from a request. When a serializer is
 * specified and the handler returns something other than a `Response` or
 * `BodyInit`, the serializer will be used to serialize the response from the
 * route handler, if present, otherwise
 * [JSON.stringify()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
 * will be used to convert the body used in the response.
 *
 * Observability of the router is designed using DOM events, where there are
 * several events which can be listened for:
 *
 * - `"error"` - produces a {@linkcode RouterErrorEvent} when an error occurs
 *   when within the router. This can be used to provide a customized response
 *   for errors.
 * - `"listen"` - produces a {@linkcode RouterListenEvent} when the router has
 *   successfully started listening to requests.
 * - `"handled"` - produces a {@linkcode HandledEvent} when the router has
 *   completed handling of a request and has sent the response.
 * - `"notfound"` - produces a {@linkcode NotFoundEvent} when the router was
 *   unable to provide a response for a given request. This can be used to
 *   provide a customized response for not found events.
 *
 * ## Example
 *
 * ```ts
 * import { Router } from "https://deno.land/x/acorn/mod.ts";
 *
 * const router = new Router();
 *
 * router.all("/:id", (ctx) => ({ id: ctx.params.id }));
 *
 * router.listen({ port: 8080 });
 * ```
 */
export class Router extends EventTarget {
  #keys?: KeyRing;
  #preferJson: boolean;
  #routes = new Set<Route>();
  #secure = false;
  #state!: InternalState;
  #uid = 0;

  #add<
    R extends string,
    BodyType,
    Params extends RouteParameters<R>,
    ResponseType,
  >(
    verbs: HTTPVerbs[],
    route: R,
    handler: RouteHandler<ResponseType, BodyType, Params>,
    options: RouteOptions<R, BodyType, Params> = {},
  ): Route<R, BodyType, Params, ResponseType> {
    const r = new Route(verbs, route, handler, {
      destroy: () => {
        this.#routes.delete(r as unknown as Route);
      },
    }, options);
    this.#routes.add(r as unknown as Route);
    return r;
  }

  #error(request: Request, error: unknown, respondable: boolean): Response {
    const message = error instanceof Error ? error.message : "Internal error";
    const event = new RouterErrorEvent({
      request,
      error,
      message,
      respondable,
    });
    this.dispatchEvent(event);
    let response = event.response;
    if (!response) {
      if (isHttpError(error)) {
        response = responseFromHttpError(request, error, this.#preferJson);
      } else {
        const message = error instanceof Error
          ? error.message
          : "Internal error";
        response = responseFromHttpError(
          request,
          createHttpError(Status.InternalServerError, message),
          this.#preferJson,
        );
      }
    }
    return response;
  }

  async #handle(requestEvent: RequestEvent): Promise<void> {
    const uid = this.#uid++;
    performance.mark(`${HANDLE_START} ${uid}`);
    const deferred = new Deferred<Response>();
    requestEvent.respondWith(deferred.promise).catch((error) =>
      this.#error(requestEvent.request, error, false)
    );
    const { request } = requestEvent;
    for (const route of this.#routes) {
      if (route.matches(request)) {
        try {
          const response = await route.handle(
            request,
            this.#secure,
            this.#keys,
          );
          if (response) {
            deferred.resolve(response);
            const measure = performance.measure(
              `handle ${uid}`,
              `${HANDLE_START} ${uid}`,
            );
            this.dispatchEvent(
              new HandledEvent({ request, route, response, measure }),
            );
            return;
          }
        } catch (error) {
          let response = await route.error(request, error);
          if (!response) {
            response = this.#error(request, error, true);
          }
          deferred.resolve(response);
          const measure = performance.measure(
            `handle ${uid}`,
            `${HANDLE_START} ${uid}`,
          );
          this.dispatchEvent(
            new HandledEvent({ request, route, response, measure }),
          );
          return;
        }
      }
    }
    const response = this.#notFound(requestEvent.request);
    deferred.resolve(response);
    const measure = performance.measure(
      `handle ${uid}`,
      `${HANDLE_START} ${uid}`,
    );
    this.dispatchEvent(new HandledEvent({ request, response, measure }));
  }

  #notFound(request: Request): Response {
    const event = new NotFoundEvent({ request });
    this.dispatchEvent(event);
    let response = event.response;
    if (!response) {
      const message = request.url;
      response = responseFromHttpError(
        request,
        createHttpError(Status.NotFound, message),
        this.#preferJson,
      );
    }
    return response;
  }

  constructor(options: RouterOptions = {}) {
    super();
    const { keys, preferJson = true } = options;
    this.#keys = keys;
    this.#preferJson = preferJson;
  }

  all<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    options: RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
  ): Destroyable;
  all<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handler: RouteHandler<ResponseType, BodyType, Params>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable;
  all<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable {
    let handler;
    if (typeof handlerOrOptions === "object") {
      const { handler: h, ...o } = handlerOrOptions;
      handler = h;
      options = o;
    } else {
      handler = handlerOrOptions;
    }
    return this.#add(["DELETE", "GET", "POST", "PUT"], route, handler, options);
  }

  delete<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    options: RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
  ): Destroyable;
  delete<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handler: RouteHandler<ResponseType, BodyType, Params>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable;
  delete<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable {
    let handler;
    if (typeof handlerOrOptions === "object") {
      const { handler: h, ...o } = handlerOrOptions;
      handler = h;
      options = o;
    } else {
      handler = handlerOrOptions;
    }
    return this.#add(["DELETE"], route, handler, options);
  }

  get<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    options: RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
  ): Destroyable;
  get<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handler: RouteHandler<ResponseType, BodyType, Params>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable;
  get<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable {
    let handler;
    if (typeof handlerOrOptions === "object") {
      const { handler: h, ...o } = handlerOrOptions;
      handler = h;
      options = o;
    } else {
      handler = handlerOrOptions;
    }
    return this.#add(["GET"], route, handler, options);
  }

  head<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    options: RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
  ): Destroyable;
  head<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handler: RouteHandler<ResponseType, BodyType, Params>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable;
  head<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable {
    let handler;
    if (typeof handlerOrOptions === "object") {
      const { handler: h, ...o } = handlerOrOptions;
      handler = h;
      options = o;
    } else {
      handler = handlerOrOptions;
    }
    return this.#add(["HEAD"], route, handler, options);
  }

  options<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    options: RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
  ): Destroyable;
  options<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handler: RouteHandler<ResponseType, BodyType, Params>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable;
  options<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable {
    let handler;
    if (typeof handlerOrOptions === "object") {
      const { handler: h, ...o } = handlerOrOptions;
      handler = h;
      options = o;
    } else {
      handler = handlerOrOptions;
    }
    return this.#add(["OPTIONS"], route, handler, options);
  }

  patch<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    options: RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
  ): Destroyable;
  patch<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handler: RouteHandler<ResponseType, BodyType, Params>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable;
  patch<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable {
    let handler;
    if (typeof handlerOrOptions === "object") {
      const { handler: h, ...o } = handlerOrOptions;
      handler = h;
      options = o;
    } else {
      handler = handlerOrOptions;
    }
    return this.#add(["PATCH"], route, handler, options);
  }

  post<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    options: RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
  ): Destroyable;
  post<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handler: RouteHandler<ResponseType, BodyType, Params>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable;
  post<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable {
    let handler;
    if (typeof handlerOrOptions === "object") {
      const { handler: h, ...o } = handlerOrOptions;
      handler = h;
      options = o;
    } else {
      handler = handlerOrOptions;
    }
    return this.#add(["POST"], route, handler, options);
  }

  put<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    options: RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
  ): Destroyable;
  put<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handler: RouteHandler<ResponseType, BodyType, Params>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable;
  put<
    R extends string,
    Params extends RouteParameters<R>,
    BodyType,
    ResponseType,
  >(
    route: R,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<R, BodyType, Params, ResponseType>,
    options?: RouteOptions<R, BodyType, Params>,
  ): Destroyable {
    let handler;
    if (typeof handlerOrOptions === "object") {
      const { handler: h, ...o } = handlerOrOptions;
      handler = h;
      options = o;
    } else {
      handler = handlerOrOptions;
    }
    return this.#add(["PUT"], route, handler, options);
  }

  handle(request: Request, secure = false): Promise<Response> {
    const deferred = new Deferred<Response>();
    this.#secure = secure;
    this.#handle({
      request,
      respondWith(response: Response | Promise<Response>): Promise<void> {
        deferred.resolve(response);
        return Promise.resolve();
      },
    });
    return deferred.promise;
  }

  async listen(options: ListenOptions = { port: 0 }): Promise<void> {
    const {
      secure = false,
      server: Server = NativeHttpServer,
      signal,
      ...listenOptions
    } = options;
    if (!("port" in listenOptions)) {
      listenOptions.port = 0;
    }
    const server = new Server(this, listenOptions as Deno.ListenOptions);
    this.#state = {
      closed: false,
      closing: false,
      handling: new Set<Promise<void>>(),
      server: Server,
    };
    this.#secure = secure;
    if (signal) {
      signal.addEventListener("abort", () => {
        if (!this.#state.handling.size) {
          server.close();
          this.#state.closed = true;
        }
      });
    }
    const listener = server.listen();
    const { hostname, port } = listener.addr;
    this.dispatchEvent(
      new RouterListenEvent({
        hostname,
        listener,
        port,
        secure,
      }),
    );
    try {
      for await (const requestEvent of server) {
        this.#handle(requestEvent);
      }
      await Promise.all(this.#state.handling);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      this.dispatchEvent(new RouterErrorEvent({ message, error }));
    }
  }

  addEventListener(
    type: "error",
    listener: RouterErrorEventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: "handled",
    listener: HandledEventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: "listen",
    listener: RouterListenEventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: "notfound",
    listener: NotFoundEventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  [Symbol.for("Deno.customInspect")](inspect: (value: unknown) => string) {
    return `${this.constructor.name} ${inspect({})}`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](
    depth: number,
    // deno-lint-ignore no-explicit-any
    options: any,
    inspect: (value: unknown, options?: unknown) => string,
  ) {
    if (depth < 0) {
      return options.stylize(`[${this.constructor.name}]`, "special");
    }

    const newOptions = Object.assign({}, options, {
      depth: options.depth === null ? null : options.depth - 1,
    });
    return `${options.stylize(this.constructor.name, "special")} ${
      inspect({}, newOptions)
    }`;
  }
}
