// Copyright 2022-2024 the oak authors. All rights reserved.

/**
 * The router for acorn, which is the foundational part of the framework.
 *
 * @example
 * ```ts
 * import { Router } from "jsr:@oak/acorn/router";
 *
 * const router = new Router();
 *
 * router.get("/", () => ({ hello: "world" }));
 *
 * const BOOKS = {
 *   "1": { title: "The Hound of the Baskervilles" },
 *   "2": { title: "It" },
 * };
 *
 * router.get("/books/:id", (ctx) => BOOKS[ctx.params.id]);
 *
 * router.listen({ port: 3000 });
 * ```
 *
 * @module
 */

import { Context } from "./context.ts";
import {
  createHttpError,
  isClientErrorStatus,
  isErrorStatus,
  isHttpError,
  isInformationalStatus,
  isRedirectStatus,
  isServerErrorStatus,
  isSuccessfulStatus,
  SecureCookieMap,
  Status,
} from "./deps.ts";
import { NativeHttpServer } from "./http_server_native.ts";
import type {
  Addr,
  Deserializer,
  Destroyable,
  KeyRing,
  Listener,
  RequestEvent,
  Serializer,
  ServerConstructor,
} from "./types.ts";
import {
  assert,
  CONTENT_TYPE_HTML,
  CONTENT_TYPE_JSON,
  CONTENT_TYPE_TEXT,
  isBodyInit,
  isHtmlLike,
  isJsonLike,
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

/**
 * The interface too status handlers, which are registered on the
 * {@linkcode Router} via the `.on()` method and intended for being notified of
 * certain state changes related to routing requests.
 */
export interface StatusHandler<S extends Status> {
  (
    context: Context<unknown, Record<string, string>>,
    status: S,
    response?: Response,
  ):
    | Promise<RouteResponse<unknown> | undefined>
    | RouteResponse<unknown>
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

/** A string that represents a range of HTTP response {@linkcode Status} codes:
 *
 * - `"*"` - matches any status code
 * - `"info"` - matches information status codes (`100`-`199`)
 * - `"success"` - matches successful status codes (`200`-`299`)
 * - `"redirect"` - matches redirection status codes (`300`-`399`)
 * - `"client-error"` - matches client error status codes (`400`-`499`)
 * - `"server-error"` - matches server error status codes (`500`-`599`)
 * - `"error"` - matches any error status code (`400`-`599`)
 */
export type StatusRange =
  | "*"
  | "info"
  | "success"
  | "redirect"
  | "client-error"
  | "server-error"
  | "error";

/** A {@linkcode Status} code or a shorthand {@linkcode StatusRange} string. */
export type StatusAndRanges = Status | StatusRange;

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

interface RouterRequestEventListener {
  (evt: RouterRequestEvent): void | Promise<void>;
}

interface RouterRequestEventListenerObject {
  handleEvent(evt: RouterRequestEvent): void | Promise<void>;
}

type RouterRequestListenerOrEventListenerObject =
  | RouterRequestEventListener
  | RouterRequestEventListenerObject;

interface NotFoundEventInit extends EventInit {
  request: Request;
}

/** A DOM like event that is emitted from the router when any request did not
 * match any routes.
 *
 * Setting the `.response` property will cause the default response to be
 * overridden. */
export class NotFoundEvent extends Event {
  #request: Request;

  /** The original {@linkcode Request} associated with the event. */
  get request(): Request {
    return this.#request;
  }

  /** If the event listener whishes to issue a specific response to the event,
   * then it should set the value here to a {@linkcode Response} and the router
   * will use it to respond. */
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

/** A DOM like event emitted by the router when a request has been handled.
 *
 * This can be used to provide logging and reporting for the router. */
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

/** The init for a {@linkcode RouterRequestEvent}. */
export interface RouterRequestEventInit extends EventInit {
  /** Any secure cookies associated with the request event. */
  cookies: SecureCookieMap;
  /** The {@linkcode Request} associated with the event. */
  request: Request;
  /** A link to the response headers object that should be used when
   * initing a response. */
  responseHeaders: Headers;
}

/** An event that is raised when the router is processing an event. If the
 * event's `response` property is set after the event completes its dispatch,
 * then the value will be used to send the response, otherwise the router will
 * attempt to match a route. */
export class RouterRequestEvent extends Event {
  #cookies: SecureCookieMap;
  #request: Request;
  #responseHeaders: Headers;

  get cookies(): SecureCookieMap {
    return this.#cookies;
  }

  get request(): Request {
    return this.#request;
  }

  response?: Response;

  get responseHeaders(): Headers {
    return this.#responseHeaders;
  }

  constructor(eventInitDict: RouterRequestEventInit) {
    super("request", eventInitDict);
    this.#cookies = eventInitDict.cookies;
    this.#request = eventInitDict.request;
    this.#responseHeaders = eventInitDict.responseHeaders;
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
  server: ServerConstructor;
}

/** Options which can be used when creating a new router. */
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
    addr: Addr,
    headers: Headers,
    secure: boolean,
    keys?: KeyRing,
  ): Promise<Response | undefined> {
    assert(this.#params, "params should have been set in .matches()");
    const cookies = new SecureCookieMap(request, {
      keys,
      response: headers,
      secure,
    });
    const context = new Context<BodyType, Params>(
      {
        cookies,
        addr,
        deserializer: this.#deserializer,
        params: this.#params,
        request,
      },
    );
    const result = await this.#handler(context);
    if (result instanceof Response) {
      return appendHeaders(result, headers);
    }
    if (isBodyInit(result)) {
      if (typeof result === "string") {
        if (isHtmlLike(result)) {
          headers.set("content-type", CONTENT_TYPE_HTML);
        } else if (isJsonLike(result)) {
          headers.set("content-type", CONTENT_TYPE_JSON);
        } else {
          headers.set("content-type", CONTENT_TYPE_TEXT);
        }
      } else {
        headers.set("content-type", CONTENT_TYPE_JSON);
      }
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

class StatusRoute<S extends Status> {
  #destroyHandle: Destroyable;
  #handler: StatusHandler<S>;
  #status: StatusAndRanges[];

  constructor(
    status: StatusAndRanges[],
    handler: StatusHandler<S>,
    destroyHandle: Destroyable,
  ) {
    this.#destroyHandle = destroyHandle;
    this.#handler = handler;
    this.#status = status;
  }

  destroy(): void {
    this.#destroyHandle.destroy();
  }

  async handle(
    status: Status,
    request: Request,
    addr: Addr,
    response: Response | undefined,
    responseHeaders: Headers,
    secure: boolean,
    keys?: KeyRing,
  ): Promise<Response | undefined> {
    const headers = response ? new Headers(response.headers) : responseHeaders;
    const cookies = new SecureCookieMap(request, {
      keys,
      response: headers,
      secure,
    });
    const context = new Context({ cookies, request, addr });
    const result = await this.#handler(context, status as S, response);
    if (result instanceof Response) {
      return appendHeaders(result, headers);
    }
    if (isBodyInit(result)) {
      if (typeof result === "string") {
        if (isHtmlLike(result)) {
          headers.set("content-type", CONTENT_TYPE_HTML);
        } else if (isJsonLike(result)) {
          headers.set("content-type", CONTENT_TYPE_JSON);
        } else {
          headers.set("content-type", CONTENT_TYPE_TEXT);
        }
      } else {
        headers.set("content-type", CONTENT_TYPE_JSON);
      }
      return new Response(result, { status, headers });
    }
    if (result) {
      headers.set("content-type", CONTENT_TYPE_JSON);
      return new Response(JSON.stringify(result), { status, headers });
    }
    return undefined;
  }

  matches(status: Status): boolean {
    for (const item of this.#status) {
      if (typeof item === "number") {
        if (status === item) {
          return true;
        } else {
          continue;
        }
      }
      switch (item) {
        case "*":
          return true;
        case "info":
          if (isInformationalStatus(status)) {
            return true;
          }
          break;
        case "success":
          if (isSuccessfulStatus(status)) {
            return true;
          }
          break;
        case "redirect":
          if (isRedirectStatus(status)) {
            return true;
          }
          break;
        case "client-error":
          if (isClientErrorStatus(status)) {
            return true;
          }
          break;
        case "server-error":
          if (isServerErrorStatus(status)) {
            return true;
          }
          break;
        case "error":
          if (isErrorStatus(status)) {
            return true;
          }
      }
    }
    return false;
  }
}

/** Context to be provided when invoking the `.handle()` method on the
 * router. */
export interface RouterHandleInit {
  addr: Addr;
  /** @default {false} */
  secure?: boolean;
}

/** A router which is specifically geared for handling RESTful type of requests
 * and providing a straight forward API to respond to them.
 *
 * A {@linkcode RouteHandler} is registered with the router, and when a request
 * matches a route the handler will be invoked. The handler will be provided
 * with {@linkcode Context} of the current request. The handler can return a
 * web platform {@linkcode Response} instance, {@linkcode BodyInit} value, or
 * any other object which will be to be serialized to a JSON string as set as
 * the value of the response body.
 *
 * The handler context includes a property named `cookies` which is an instance
 * of {@linkcode Cookies}, which provides an interface for reading request
 * cookies and setting cookies in the response. `Cookies` supports cryptographic
 * signing of keys using a key ring which adheres to the {@linkcode KeyRing}
 * interface, which can be passed as an option when creating the router.
 *
 * The route is specified using the pathname part of the {@linkcode URLPattern}
 * API which supports routes with wildcards (e.g. `/posts/*`) and named groups
 * (e.g. `/books/:id`) which are then provided as `.params` on the context
 * argument to the handler.
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
 * import { Router } from "jsr:@oak/acorn/router";
 *
 * const router = new Router();
 *
 * router.all("/:id", (ctx) => ({ id: ctx.params.id }));
 *
 * router.listen({ port: 8080 });
 * ```
 */
export class Router extends EventTarget {
  #handling: Set<Promise<Response>> = new Set();
  #keys?: KeyRing;
  #preferJson: boolean;
  #routes = new Set<Route>();
  #secure = false;
  #state?: InternalState;
  #statusRoutes = new Set<StatusRoute<Status>>();
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

  async #handleStatus(
    status: Status,
    request: Request,
    addr: Addr,
    responseHeaders: Headers,
    response?: Response,
  ): Promise<Response | undefined> {
    for (const route of this.#statusRoutes) {
      if (route.matches(status)) {
        try {
          const result = await route.handle(
            status,
            request,
            addr,
            response,
            responseHeaders,
            this.#secure,
            this.#keys,
          );
          if (result) {
            response = result;
          }
        } catch (error) {
          return this.#error(request, error, true);
        }
      }
    }
    return response;
  }

  async #handle(requestEvent: RequestEvent, addr: Addr): Promise<void> {
    const uid = this.#uid++;
    performance.mark(`${HANDLE_START} ${uid}`);
    const { promise, resolve } = Promise.withResolvers<Response>();
    this.#handling.add(promise);
    requestEvent.respondWith(promise).catch((error) =>
      this.#error(requestEvent.request, error, false)
    );
    const { request } = requestEvent;
    const responseHeaders = new Headers();
    let cookies: SecureCookieMap;
    try {
      cookies = new SecureCookieMap(request, {
        keys: this.#keys,
        response: responseHeaders,
        secure: this.#secure,
      });
    } catch {
      // deal with a request dropping before the headers can be read which can
      // occur under heavy load
      this.#handling.delete(promise);
      return;
    }
    const routerRequestEvent = new RouterRequestEvent({
      cookies,
      request,
      responseHeaders,
    });
    if (
      this.dispatchEvent(routerRequestEvent) || !routerRequestEvent.response
    ) {
      for (const route of this.#routes) {
        if (route.matches(request)) {
          try {
            const response = await route.handle(
              request,
              addr,
              responseHeaders,
              this.#secure,
              this.#keys,
            );
            if (response) {
              const result = await this.#handleStatus(
                response.status,
                request,
                addr,
                response.headers,
                response,
              );
              resolve(result ?? response);
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
            const status = isHttpError(error)
              ? error.status
              : response?.status ?? Status.InternalServerError;
            response = await this.#handleStatus(
              status,
              request,
              addr,
              responseHeaders,
              response,
            );
            if (!response) {
              response = this.#error(request, error, true);
            }
            resolve(response);
            this.#handling.delete(promise);
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
    } else if (routerRequestEvent.response) {
      const { response } = routerRequestEvent;
      const result = await this.#handleStatus(
        response.status,
        request,
        addr,
        responseHeaders,
        response,
      );
      resolve(result ?? response);
      this.#handling.delete(promise);
      const measure = performance.measure(
        `handle ${uid}`,
        `${HANDLE_START} ${uid}`,
      );
      this.dispatchEvent(new HandledEvent({ request, response, measure }));
      return;
    }
    let response = await this.#handleStatus(
      Status.NotFound,
      request,
      addr,
      responseHeaders,
    );
    if (!response) {
      response = this.#notFound(request);
    }
    resolve(response);
    this.#handling.delete(promise);
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
  all<Params extends RouteParameters<string>, BodyType, ResponseType>(
    route: string,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<string, BodyType, Params, ResponseType>,
    options?: RouteOptions<string, BodyType, Params>,
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
  delete<Params extends RouteParameters<string>, BodyType, ResponseType>(
    route: string,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<string, BodyType, Params, ResponseType>,
    options?: RouteOptions<string, BodyType, Params>,
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
  get<Params extends RouteParameters<string>, BodyType, ResponseType>(
    route: string,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<string, BodyType, Params, ResponseType>,
    options?: RouteOptions<string, BodyType, Params>,
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
  head<Params extends RouteParameters<string>, BodyType, ResponseType>(
    route: string,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<string, BodyType, Params, ResponseType>,
    options?: RouteOptions<string, BodyType, Params>,
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
  options<Params extends RouteParameters<string>, BodyType, ResponseType>(
    route: string,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<string, BodyType, Params, ResponseType>,
    options?: RouteOptions<string, BodyType, Params>,
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
  patch<Params extends RouteParameters<string>, BodyType, ResponseType>(
    route: string,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<string, BodyType, Params, ResponseType>,
    options?: RouteOptions<string, BodyType, Params>,
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
  post<Params extends RouteParameters<string>, BodyType, ResponseType>(
    route: string,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<string, BodyType, Params, ResponseType>,
    options?: RouteOptions<string, BodyType, Params>,
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
  put<Params extends RouteParameters<string>, BodyType, ResponseType>(
    route: string,
    handlerOrOptions:
      | RouteHandler<ResponseType, BodyType, Params>
      | RouteOptionsWithHandler<string, BodyType, Params, ResponseType>,
    options?: RouteOptions<string, BodyType, Params>,
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

  /** Handle an individual request by matching against registered routers.
   *
   * This is intended to be used when the router isn't managing opening the
   * server and listening for requests. */
  handle(request: Request, init: RouterHandleInit): Promise<Response> {
    const { promise, resolve } = Promise.withResolvers<Response>();
    this.#secure = init.secure ?? false;
    this.#handle({
      request,
      respondWith(response: Response | Promise<Response>): Promise<void> {
        resolve(response);
        return Promise.resolve();
      },
    }, init.addr);
    return promise;
  }

  /** Open a server to listen for requests and handle them by matching against
   * registered routes.
   *
   * The promise returned resolves when the server closes. To close the server
   * provide an {@linkcode AbortSignal} in the options and when signaled in
   * flight requests will be processed and the HTTP server closed. */
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
      server: Server,
    };
    this.#secure = secure;
    if (signal) {
      signal.addEventListener("abort", async () => {
        assert(this.#state, "router state should exist");
        this.#state.closing = true;
        await Promise.all(this.#handling);
        await server.close();
        this.#state.closed = true;
      });
    }
    const listener = await server.listen();
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
      for await (const [requestEvent, addr] of server) {
        this.#handle(requestEvent, addr);
      }
      await Promise.all(this.#handling);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      this.dispatchEvent(new RouterErrorEvent({ message, error }));
    }
  }

  /** Allows setting a handler that will be called when a response has been
   * handled, but before any default handling has occurred and before it has
   * been sent back to the client.
   *
   * When the router is ready to form a response and send it to the client,
   * it will match the status of any handlers, and call them in the order they
   * were registered. The `status` can either be a {@linkcode Status}, or a
   * {@linkcode StatusRange} or an array of codes and ranges.
   *
   * The handler will receive the current {@linkcode Context} along with the
   * {@linkcode Status} code and any {@linkcode Response} object that was
   * created previously. If there is no response, none has yet been created.
   *
   * A handler can return a response body, like a route handler can or
   * {@linkcode BodyInit} or a {@linkcode Response} and that will then become
   * that basis for a new response. If the handler returns `undefined` the
   * existing response or the default router response will be used.
   *
   * Handlers can be removed by calling `.destroy()` on the returned handle.
   *
   * If you are performing logging or metrics on the router, it is better to
   * use the event listener interfaces for the `"handled"` event, as the
   * intention of `.on()` is to provide a way to do "post-processing" of
   * response _or_ provide custom responses for things like `404` or `500`
   * status responses. */
  on<S extends Status>(status: S | S[], handler: StatusHandler<S>): Destroyable;
  /** Allows setting a handler that will be called when a response has been
   * handled, but before any default handling has occurred and before it has
   * been sent back to the client.
   *
   * When the router is ready to form a response and send it to the client,
   * it will match the status of any handlers, and call them in the order they
   * were registered. The `status` can either be a {@linkcode Status}, or a
   * {@linkcode StatusRange} or an array of codes and ranges.
   *
   * The handler will receive the current {@linkcode Context} along with the
   * {@linkcode Status} code and any {@linkcode Response} object that was
   * created previously. If there is no response, none has yet been created.
   *
   * A handler can return a response body, like a route handler can or
   * {@linkcode BodyInit} or a {@linkcode Response} and that will then become
   * that basis for a new response. If the handler returns `undefined` the
   * existing response or the default router response will be used.
   *
   * Handlers can be removed by calling `.destroy()` on the returned handle.
   *
   * If you are performing logging or metrics on the router, it is better to
   * use the event listener interfaces for the `"handled"` event, as the
   * intention of `.on()` is to provide a way to do "post-processing" of
   * response _or_ provide custom responses for things like `404` or `500`
   * status responses. */
  on(
    status: StatusRange | StatusRange[],
    handler: StatusHandler<Status>,
  ): Destroyable;
  on(
    status: StatusAndRanges | StatusAndRanges[],
    handler: StatusHandler<Status>,
  ): Destroyable {
    if (!Array.isArray(status)) {
      status = [status];
    }
    const route = new StatusRoute(status, handler, {
      destroy: () => {
        this.#statusRoutes.delete(route);
      },
    });
    this.#statusRoutes.add(route);
    return route;
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
    type: "request",
    listener: RouterRequestListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  [Symbol.for("Deno.customInspect")](
    inspect: (value: unknown) => string,
  ): string {
    return `${this.constructor.name} ${inspect({})}`;
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
      inspect({}, newOptions)
    }`;
  }
}
