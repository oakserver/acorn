// Copyright 2018-2024 the oak authors. All rights reserved.

/**
 * The main module of acorn that contains the core {@linkcode Router} which
 * is focused on creating servers for handling RESTful type services.
 *
 * @module
 */

import type { KeyRing } from "@oak/commons/cookie_map";
import { createHttpError, isHttpError } from "@oak/commons/http_errors";
import type { HttpMethod } from "@oak/commons/method";
import { Status } from "@oak/commons/status";
import { assert } from "@std/assert/assert";
import type { InferOutput } from "@valibot/valibot";

import {
  configure,
  getLogger,
  type Logger,
  type LoggerOptions,
} from "./logger.ts";
import type { CloudflareWorkerRequestEvent } from "./request_event_cfw.ts";
import { PathRoute, type RouteHandler, type RouteOptions } from "./route.ts";
import {
  type StatusHandler,
  type StatusRange,
  StatusRoute,
  type StatusRouteDescriptor,
  type StatusRouteInit,
} from "./status_route.ts";
import type {
  Addr,
  CloudflareExecutionContext,
  CloudflareFetchHandler,
  ParamsDictionary,
  QueryParamsDictionary,
  Removeable,
  RequestEvent,
  RequestServerConstructor,
  Route,
  RouteParameters,
  TlsOptions,
} from "./types.ts";
import { isBun, isNode } from "./utils.ts";
import type {
  BodySchema,
  QueryStringSchema,
  SchemaDescriptor,
} from "./schema.ts";

export interface RouteDescriptor<
  Path extends string,
  Env extends Record<string, string> = Record<string, string>,
  Params extends ParamsDictionary | undefined = ParamsDictionary,
  QSSchema extends QueryStringSchema = QueryStringSchema,
  QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
  BSchema extends BodySchema = BodySchema,
  RequestBody = InferOutput<BSchema>,
  ResSchema extends BodySchema = BodySchema,
  ResponseBody = InferOutput<ResSchema>,
> extends
  RouteInitWithHandler<
    Env,
    Params,
    QSSchema,
    QueryParams,
    BSchema,
    RequestBody,
    ResSchema,
    ResponseBody
  > {
  path: Path;
}

export interface RouteDescriptorWithMethod<
  Path extends string,
  Env extends Record<string, string> = Record<string, string>,
  Params extends ParamsDictionary | undefined = ParamsDictionary,
  QSSchema extends QueryStringSchema = QueryStringSchema,
  QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
  BSchema extends BodySchema = BodySchema,
  RequestBody = InferOutput<BSchema>,
  ResSchema extends BodySchema = BodySchema,
  ResponseBody = InferOutput<ResSchema>,
> extends
  RouteDescriptor<
    Path,
    Env,
    Params,
    QSSchema,
    QueryParams,
    BSchema,
    RequestBody,
    ResSchema,
    ResponseBody
  > {
  method: HttpMethod[] | HttpMethod;
}

/**
 * Options which can be provided when creating a route.
 */
export interface RouteInit<
  QSSchema extends QueryStringSchema,
  BSchema extends BodySchema,
  ResSchema extends BodySchema,
> {
  /**
   * The schema to be used for validating the query string, the request body,
   * and the response body.
   */
  schema?: SchemaDescriptor<QSSchema, BSchema, ResSchema> | undefined;
}

/**
 * Options which can be provided when creating a route that also include the
 * handler.
 */
export interface RouteInitWithHandler<
  Env extends Record<string, string> = Record<string, string>,
  Params extends ParamsDictionary | undefined = ParamsDictionary,
  QSSchema extends QueryStringSchema = QueryStringSchema,
  QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
  BSchema extends BodySchema = BodySchema,
  RequestBody = InferOutput<BSchema>,
  ResSchema extends BodySchema = BodySchema,
  ResponseBody = InferOutput<ResSchema>,
> extends RouteInit<QSSchema, BSchema, ResSchema> {
  /**
   * The handler function which will be called when the route is matched.
   */
  handler: RouteHandler<
    Env,
    Params,
    QSSchema,
    QueryParams,
    BSchema,
    RequestBody,
    ResSchema,
    ResponseBody
  >;
}

/**
 * Details provided an `onError` hook.
 */
export interface ErrorDetails<
  Env extends Record<string, string> = Record<string, string>,
> {
  /**
   * The error message which was generated.
   */
  message: string;
  /**
   * The cause of the error. This is typically an `Error` instance, but can be
   * any value.
   */
  cause: unknown;
  /**
   * The request event which was being processed when the error occurred.
   *
   * If the error occurs outside of handling a request, this will be
   * `undefined`.
   */
  requestEvent?: RequestEvent<Env>;
  /**
   * If the error occurred before a response was returned to the client, this
   * will be `true`. This indicates that the error hook can return a response
   * which will be sent to the client instead of the default response.
   */
  respondable?: boolean;
  /**
   * If a route was matched, this will be the route that was matched.
   */
  route?: Route;
}

/**
 * Details provided to an `onHandled` hook.
 */
export interface HandledDetails<
  Env extends Record<string, string> = Record<string, string>,
> {
  /**
   * The duration in milliseconds that it took to handle the request.
   *
   * acorn attempts to use high precision timing to determine the duration, but
   * this is runtime dependent. If it is high precision timing, the number will
   * be a float.
   */
  duration: number;
  /**
   * The request event which was processed.
   */
  requestEvent: RequestEvent<Env>;
  /**
   * The response which is being returned to the client.
   */
  response: Response;
  /**
   * If a route was matched, this will be the route that was matched.
   */
  route?: Route;
}

/**
 * Options which can be specified when listening for requests.
 */
export interface ListenOptions {
  /**
   * The server constructor to use when listening for requests. This is not
   * commonly used, but can be used to provide a custom server implementation.
   *
   * When not provided, the default server constructor for the detected
   * runtime will be used.
   */
  server?: RequestServerConstructor;
  /**
   * The port to listen on.
   */
  port?: number;
  /**
   * The hostname to listen on.
   */
  hostname?: string;
  /**
   * Determines if the server should be considered to be listening securely,
   * irrespective of the TLS configuration.
   *
   * Typically if there is a TLS configuration, the server is considered to be
   * listening securely. However, in some cases, like when using Deno Deploy
   * you don't specify any TLS configuration, but the server is still listening
   * securely.
   */
  secure?: boolean;
  /**
   * The signal to use to stop listening for requests. When this signal is
   * aborted, the server will stop listening for requests and finish processing
   * any requests that are currently being handled.
   */
  signal?: AbortSignal;
  /**
   * The TLS configuration to use when listening for requests.
   */
  tls?: TlsOptions;
  /**
   * A callback which is invoked when the server starts listening for requests.
   *
   * The address that the server is listening on is provided.
   */
  onListen?(addr: Addr): void;
}

/**
 * Details provided to an `onNotFound` hook.
 */
export interface NotFoundDetails<
  Env extends Record<string, string> = Record<string, string>,
> {
  /**
   * The request event which is being processed.
   */
  requestEvent: RequestEvent<Env>;
  /**
   * The response which is being potentially being returned to the client.
   * If present this will have a status of `404 Not Found` which was returned
   * by the handler.
   */
  response?: Response;
  /**
   * If a route was matched, this will be the route that was matched. The
   * not found hook is called when a route is matched and the router handler
   * returns a response with `404 Not Found` status.
   */
  route?: Route;
}

/**
 * Options which can be specified when creating an instance of
 * {@linkcode Router}.
 *
 * @template Env a type which allows strongly typing the environment variables
 * that are made available on the context used within handlers.
 */
export interface RouterOptions<
  Env extends Record<string, string> = Record<string, string>,
> extends RouteOptions {
  /**
   * An optional key ring which is used for signing and verifying cookies, which
   * helps ensure that the cookie values are resistent to client side tampering.
   *
   * When supplied, only verified cookies are made available in the context.
   */
  keys?: KeyRing;
  /**
   * An optional logger configuration which can be used to configure the
   * integrated logger. There are three ways to output logs:
   *
   * - output logs to the console
   * - output logs to a file
   * - output logs to a {@linkcode WritableStream}
   *
   * If the value of the option is `true`, logs will be output to the console at
   * the `"warning"` level. If you provide an object, you can choose the level
   * and other configuration options for each log sink of `console`, `file`, and
   * `stream`.
   *
   * @default false
   *
   * @example Output logs to the console
   *
   * ```ts
   * import { Router } from "@oak/acorn";
   *
   * const router = new Router({ logger: true });
   * ```
   *
   * @example Output debug logs to the console
   *
   * ```ts
   * import { Router } from "@oak/acorn";
   *
   * const router = new Router({
   *   logger: {
   *     console: { level: "debug" },
   *   },
   * });
   * ```
   *
   * @example Output logs to a file
   *
   * ```ts
   * import { Router } from "@oak/acorn";
   *
   * const router = new Router({
   *   logger: {
   *     file: { path: "/path/to/logfile.log" },
   *   },
   * });
   * ```
   */
  logger?: boolean | LoggerOptions;
  /**
   * An optional handler when an error is encountered by the router.
   *
   * If a response has not yet been returned to the client, the handler can
   * return a {@linkcode Response} which will be sent to the client.
   *
   * If there is no handler or if the handler does not return a response, a
   * default response will be returned to the client.
   */
  onError?(
    details: ErrorDetails<Env>,
  ): Promise<Response | undefined | void> | Response | undefined | void;
  /**
   * A callback which is invoked each time the router completes handling a
   * request and starts returning a response to the client.
   *
   * Details around the request and response are provided. In certain situations
   * where the response is not finalized, like when upgrading to web sockets or
   * sending server sent events, the response will not be included in the
   * details.
   */
  onHandled?(details: HandledDetails<Env>): Promise<void> | void;
  /**
   * A handler which is invoked each time a router has matched any handlers and
   * there is no match or the status of a response is currently a _404 Not
   * Found_. The handler can return a response. If a response is returned, this
   * will override the default response.
   *
   * This handler will be processed before any of the status handlers that
   * maybe registered with the router.
   */
  onNotFound?(
    details: NotFoundDetails<Env>,
  ): Promise<Response | undefined | void> | Response | undefined | void;
  /**
   * A callback that is each time a request is presented to the router.
   */
  onRequest?(requestEvent: RequestEvent<Env>): Promise<void> | void;
  /**
   * When there is an uncaught exception thrown during the handling of a
   * request, the router will pass a request through to an origin server
   * allowing the service behind the router to handle any unexpected error cases
   * that arise.
   *
   * **Note:** This option is only available when running on Cloudflare Workers.
   */
  passThroughOnException?: boolean;
  /**
   * When providing default responses like internal server errors or not found
   * requests, the router uses content negotiation to determine the appropriate
   * response. This option determines if JSON or HTML will be preferred for
   * these responses.
   *
   * @default true
   */
  preferJson?: boolean;
}

let CFWRequestEventCtor: typeof CloudflareWorkerRequestEvent | undefined;

/**
 * The main class of acorn, which provides the functionality of receiving
 * requests and routing them to specific handlers.
 *
 * @example Simplistic router on Deno/Node.js/Bun
 *
 * ```ts
 * import { Router } from "@oak/acorn";
 *
 * const router = new Router();
 *
 * router.get(() => ({ hello: "world" }));
 *
 * router.listen({ port: 8080 });
 * ```
 *
 * @example Simplistic router on Cloudflare Workers
 *
 * ```ts
 * import { Router } from "@oak/acorn";
 *
 * const router = new Router();
 *
 * router.get(() => ({ hello: "world" }));
 *
 * export default router;
 * ```
 *
 * @template Env a type which allows strongly typing the environment variables
 * that are made available on the context used within handlers.
 */
export class Router<
  Env extends Record<string, string> = Record<string, string>,
> {
  #abortController = new AbortController();
  #handling = new Set<Promise<Response>>();
  #logger: Logger;
  #keys?: KeyRing;
  #onError?: (
    details: ErrorDetails<Env>,
  ) => Promise<Response | undefined | void> | Response | undefined | void;
  #onHandled?: (details: HandledDetails<Env>) => Promise<void> | void;
  #onNotFound?: (
    details: NotFoundDetails<Env>,
  ) => Promise<Response | undefined | void> | Response | undefined | void;
  #onRequest?: (requestEvent: RequestEvent<Env>) => Promise<void> | void;
  #passThroughOnException?: boolean;
  #preferJson: boolean;
  #routeOptions: { sensitive?: boolean; strict?: boolean };
  #routes = new Set<Route>();
  #statusRoutes = new Set<StatusRoute<Env>>();

  #addRoute<
    Path extends string,
    Params extends RouteParameters<Path>,
    QSSchema extends QueryStringSchema,
    QueryParams extends InferOutput<QSSchema>,
    BSchema extends BodySchema = BodySchema,
    RequestBody = unknown,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = unknown,
  >(
    methods: HttpMethod[],
    pathOrDescriptor:
      | Path
      | RouteDescriptor<
        Path,
        Env,
        Params,
        QSSchema,
        QueryParams,
        BSchema,
        RequestBody,
        ResSchema,
        ResponseBody
      >,
    handlerOrInit?:
      | RouteHandler<
        Env,
        Params,
        QSSchema,
        QueryParams,
        BSchema,
        RequestBody,
        ResSchema,
        ResponseBody
      >
      | RouteInitWithHandler<
        Env,
        Params,
        QSSchema,
        QueryParams,
        BSchema,
        RequestBody,
        ResSchema,
        ResponseBody
      >
      | undefined,
    init?: RouteInit<QSSchema, BSchema, ResSchema>,
  ): Removeable {
    let path: Path;
    let handler: RouteHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >;
    let schemaDescriptor: SchemaDescriptor<QSSchema, BSchema, ResSchema> = {};
    if (typeof pathOrDescriptor === "string") {
      path = pathOrDescriptor;
      assert(handlerOrInit);
      if (typeof handlerOrInit === "function") {
        handler = handlerOrInit;
      } else {
        assert(!init, "Invalid arguments");
        const { handler: h, ...i } = handlerOrInit;
        handler = h;
        init = i;
      }
    } else {
      assert(!handlerOrInit && !init, "Invalid arguments.");
      const { path: p, handler: h, ...i } = pathOrDescriptor;
      path = p;
      handler = h;
      init = i;
    }
    if (init && init.schema) {
      schemaDescriptor = init.schema;
    }
    const route = new PathRoute<
      Path,
      Params,
      Env,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >(
      path,
      methods,
      schemaDescriptor,
      handler,
      this.#keys,
      this.#routeOptions,
    );
    this.#logger.debug(`adding route for ${methods.join(", ")} ${path}`);
    this.#routes.add(route);

    return {
      remove: () => {
        this.#logger.debug(`removing route for ${methods.join(", ")} ${path}`);
        this.#routes.delete(route);
      },
    };
  }

  async #error(
    message: string,
    cause: unknown,
    requestEvent?: RequestEvent<Env>,
    route?: Route,
  ) {
    this.#logger.error(
      `${requestEvent?.id} error handling request: ${message}`,
    );
    if (this.#onError) {
      this.#logger.debug(`${requestEvent?.id} calling onError for request`);
      const maybeResponse = await this.#onError({
        message,
        cause,
        requestEvent,
        respondable: requestEvent && !requestEvent.responded,
        route,
      });
      if (requestEvent && !requestEvent?.responded && maybeResponse) {
        this.#logger
          .debug(
            `${requestEvent?.id} responding with onError response for request`,
          );
        return requestEvent.respond(maybeResponse);
      }
    }
    if (requestEvent && !requestEvent?.responded) {
      this.#logger
        .debug(
          `${requestEvent?.id} responding with default response for request`,
        );
      if (isHttpError(cause)) {
        return requestEvent.respond(
          cause.asResponse({
            request: requestEvent.request,
            prefer: this.#preferJson ? "json" : "html",
            headers: {
              "x-request-id": requestEvent.id,
            },
          }),
        );
      } else {
        return requestEvent.respond(
          createHttpError(
            Status.InternalServerError,
            message,
            { cause },
          ).asResponse({
            request: requestEvent.request,
            prefer: this.#preferJson ? "json" : "html",
            headers: { "x-request-id": requestEvent.id },
          }),
        );
      }
    }
  }

  async #handle(
    requestEvent: RequestEvent<Env>,
    secure: boolean,
  ): Promise<void> {
    const id = requestEvent.id;
    this.#logger.info(`${id} handling request: ${requestEvent.url.toString()}`);
    const start = performance.now();
    let response: Response | undefined | void;
    let route: Route | undefined;
    this.#handling.add(requestEvent.response);
    requestEvent.response.then(() =>
      this.#handling.delete(requestEvent.response)
    ).catch((cause) => {
      this.#logger.error(`${id} error deleting handling handle for request`);
      this.#error("Error deleting handling handle.", cause, requestEvent);
    });
    this.#onRequest?.(requestEvent);
    const responseHeaders = new Headers();
    if (!requestEvent.responded) {
      for (route of this.#routes) {
        if (
          route.matches(
            requestEvent.url.pathname,
            requestEvent.request.method as HttpMethod,
          )
        ) {
          this.#logger.info(`${id} request matched`);
          try {
            response = await route.handle(
              requestEvent,
              responseHeaders,
              secure,
            );
            if (response && !requestEvent.responded) {
              response = await this.#handleStatus(
                requestEvent,
                responseHeaders,
                response,
                secure,
                route,
              );
              if (!requestEvent.responded) {
                await requestEvent.respond(response);
              }
            }
            if (requestEvent.responded) {
              break;
            }
          } catch (cause) {
            this.#logger.error(`${id} error during handling request`);
            await this.#error(
              "Error during handling.",
              cause,
              requestEvent,
              route,
            );
            if (requestEvent.responded) {
              break;
            }
          }
        } else {
          route = undefined;
        }
      }
    }
    if (!requestEvent.responded) {
      this.#logger.debug(`${id} not found`);
      response = response ??
        createHttpError(Status.NotFound, "Not Found").asResponse({
          prefer: this.#preferJson ? "json" : "html",
          headers: { "x-request-id": id },
        }),
        response = await this.#handleStatus(
          requestEvent,
          responseHeaders,
          response,
          secure,
        );
      requestEvent.respond(response);
    }
    const duration = performance.now() - start;
    if (response) {
      this.#logger.info(
        `${id} handled in ${parseFloat(duration.toFixed(2))}ms`,
      );
      this.#onHandled?.({ duration, requestEvent, response, route });
    } else {
      this.#logger
        .debug(
          `${id} responded to outside handle loop in ${
            parseFloat(duration.toFixed(2))
          }ms`,
        );
    }
  }

  async #handleStatus(
    requestEvent: RequestEvent<Env>,
    responseHeaders: Headers,
    response: Response,
    secure: boolean,
    route?: Route,
  ): Promise<Response> {
    if (response.status === Status.NotFound && this.#onNotFound) {
      this.#logger.debug(`${requestEvent.id} calling onNotFound`);
      response = await this.#onNotFound?.({ requestEvent, response, route }) ??
        response;
    }
    let result: Response | Promise<Response> = response;
    for (const route of this.#statusRoutes) {
      if (route.matches(response)) {
        this.#logger
          .debug(`${requestEvent.id} matched status route ${route.status}`);
        result = route.handle(
          requestEvent,
          responseHeaders,
          secure,
          response,
        );
      }
    }
    return result;
  }

  constructor(options: RouterOptions<Env> = {}) {
    const {
      keys,
      onError,
      onHandled,
      onNotFound,
      onRequest,
      passThroughOnException,
      preferJson = true,
      logger,
      ...routerOptions
    } = options;
    this.#keys = keys;
    this.#onError = onError;
    this.#onHandled = onHandled;
    this.#onNotFound = onNotFound;
    this.#onRequest = onRequest;
    this.#passThroughOnException = passThroughOnException;
    this.#preferJson = preferJson;
    this.#routeOptions = routerOptions;
    if (logger) {
      configure(typeof logger === "object" ? logger : undefined);
    }
    this.#logger = getLogger("acorn.router");
  }

  /**
   * Define a route based on the provided descriptor.
   */
  route<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    descriptor: RouteDescriptorWithMethod<
      Path,
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable {
    const { method, ...routeDescriptor } = descriptor;
    return this.#addRoute(
      Array.isArray(method) ? method : [method],
      // deno-lint-ignore no-explicit-any
      routeDescriptor as any,
    );
  }

  /**
   * Register a handler provided in the descriptor that will be invoked on when
   * the specified `.path` is matched along with the common HTTP methods of
   * `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`, `PATCH`, and `DELETE`.
   */
  all<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    descriptor: RouteDescriptor<
      Path,
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  all<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    init: RouteInitWithHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  all<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    handler: RouteHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
    init?: RouteInit<QSSchema, BSchema, ResSchema>,
  ): Removeable;
  all<Path extends string>(
    pathOrDescriptor:
      | Path
      | RouteDescriptor<Path>,
    handlerOrInit?:
      | RouteHandler<Env>
      | RouteInitWithHandler<Env>
      | undefined,
    init?: RouteInit<QueryStringSchema, BodySchema, BodySchema>,
  ): Removeable {
    return this.#addRoute(
      ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
      pathOrDescriptor,
      handlerOrInit,
      init,
    );
  }

  get<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    descriptor: RouteDescriptor<
      Path,
      Env,
      Params,
      QSSchema,
      QueryParams,
      BodySchema,
      undefined,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  get<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    init: RouteInitWithHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BodySchema,
      undefined,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  get<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    handler: RouteHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BodySchema,
      undefined,
      ResSchema,
      ResponseBody
    >,
    init?: RouteInit<QSSchema, BodySchema, ResSchema>,
  ): Removeable;
  get<Path extends string>(
    pathOrDescriptor:
      | Path
      | RouteDescriptor<Path>,
    handlerOrInit?:
      | RouteHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        undefined
      >
      | RouteInitWithHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        undefined
      >
      | undefined,
    init?: RouteInit<QueryStringSchema, BodySchema, BodySchema>,
  ): Removeable {
    return this.#addRoute(["GET"], pathOrDescriptor, handlerOrInit, init);
  }

  head<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    descriptor: RouteDescriptor<
      Path,
      Env,
      Params,
      QSSchema,
      QueryParams,
      BodySchema,
      undefined,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  head<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    init: RouteInitWithHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BodySchema,
      undefined,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  head<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    handler: RouteHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BodySchema,
      undefined,
      ResSchema,
      ResponseBody
    >,
    init?: RouteInit<QSSchema, BodySchema, ResSchema>,
  ): Removeable;
  head<Path extends string>(
    pathOrDescriptor:
      | Path
      | RouteDescriptor<Path>,
    handlerOrInit?:
      | RouteHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        undefined
      >
      | RouteInitWithHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        undefined
      >
      | undefined,
    init?: RouteInit<QueryStringSchema, BodySchema, BodySchema>,
  ): Removeable {
    return this.#addRoute(["HEAD"], pathOrDescriptor, handlerOrInit, init);
  }

  options<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    descriptor: RouteDescriptor<
      Path,
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  options<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    init: RouteInitWithHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  options<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    handler: RouteHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
    init?: RouteInit<QSSchema, BodySchema, ResSchema>,
  ): Removeable;
  options<Path extends string>(
    pathOrDescriptor:
      | Path
      | RouteDescriptor<Path>,
    handlerOrInit?:
      | RouteHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        unknown
      >
      | RouteInitWithHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        unknown
      >
      | undefined,
    init?: RouteInit<QueryStringSchema, BodySchema, BodySchema>,
  ): Removeable {
    return this.#addRoute(["PATCH"], pathOrDescriptor, handlerOrInit, init);
  }

  post<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    descriptor: RouteDescriptor<
      Path,
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  post<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    init: RouteInitWithHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  post<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    handler: RouteHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
    init?: RouteInit<QSSchema, BodySchema, ResSchema>,
  ): Removeable;
  post<Path extends string>(
    pathOrDescriptor:
      | Path
      | RouteDescriptor<Path>,
    handlerOrInit?:
      | RouteHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        unknown
      >
      | RouteInitWithHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        unknown
      >
      | undefined,
    init?: RouteInit<QueryStringSchema, BodySchema, BodySchema>,
  ): Removeable {
    return this.#addRoute(["POST"], pathOrDescriptor, handlerOrInit, init);
  }

  put<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    descriptor: RouteDescriptor<
      Path,
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  put<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    init: RouteInitWithHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  put<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    handler: RouteHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
    init?: RouteInit<QSSchema, BodySchema, ResSchema>,
  ): Removeable;
  put<Path extends string>(
    pathOrDescriptor:
      | Path
      | RouteDescriptor<Path>,
    handlerOrInit?:
      | RouteHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        unknown
      >
      | RouteInitWithHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        unknown
      >
      | undefined,
    init?: RouteInit<QueryStringSchema, BodySchema, BodySchema>,
  ): Removeable {
    return this.#addRoute(["PUT"], pathOrDescriptor, handlerOrInit, init);
  }

  patch<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    descriptor: RouteDescriptor<
      Path,
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  patch<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    init: RouteInitWithHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  patch<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    handler: RouteHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
    init?: RouteInit<QSSchema, BodySchema, ResSchema>,
  ): Removeable;
  patch<Path extends string>(
    pathOrDescriptor:
      | Path
      | RouteDescriptor<Path>,
    handlerOrInit?:
      | RouteHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        unknown
      >
      | RouteInitWithHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        unknown
      >
      | undefined,
    init?: RouteInit<QueryStringSchema, BodySchema, BodySchema>,
  ): Removeable {
    return this.#addRoute(["PATCH"], pathOrDescriptor, handlerOrInit, init);
  }

  delete<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    descriptor: RouteDescriptor<
      Path,
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  delete<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    init: RouteInitWithHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
  ): Removeable;
  delete<
    Path extends string,
    Params extends ParamsDictionary | undefined = RouteParameters<Path>,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = QueryParamsDictionary,
    BSchema extends BodySchema = BodySchema,
    RequestBody = InferOutput<BSchema>,
    ResSchema extends BodySchema = BodySchema,
    ResponseBody = InferOutput<ResSchema>,
  >(
    path: Path,
    handler: RouteHandler<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema,
      ResponseBody
    >,
    init?: RouteInit<QSSchema, BodySchema, ResSchema>,
  ): Removeable;
  delete<Path extends string>(
    pathOrDescriptor:
      | Path
      | RouteDescriptor<Path>,
    handlerOrInit?:
      | RouteHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        unknown
      >
      | RouteInitWithHandler<
        Env,
        RouteParameters<Path>,
        QueryStringSchema,
        QueryParamsDictionary,
        BodySchema,
        unknown
      >
      | undefined,
    init?: RouteInit<QueryStringSchema, BodySchema, BodySchema>,
  ): Removeable {
    return this.#addRoute(["PATCH"], pathOrDescriptor, handlerOrInit, init);
  }

  on<
    S extends Status = Status,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = InferOutput<QSSchema>,
  >(
    descriptor: StatusRouteDescriptor<S, Env, QSSchema, QueryParams>,
  ): Removeable;
  on<
    S extends Status,
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = InferOutput<QSSchema>,
  >(
    status: S | S[],
    handler: StatusHandler<S, Env, QueryStringSchema, QueryParams>,
    init?: StatusRouteInit<QSSchema>,
  ): Removeable;
  on<
    QSSchema extends QueryStringSchema = QueryStringSchema,
    QueryParams extends InferOutput<QSSchema> = InferOutput<QSSchema>,
  >(
    statusRange: StatusRange | StatusRange[],
    handler: StatusHandler<Status, Env, QSSchema, QueryParams>,
    init?: StatusRouteInit<QSSchema>,
  ): Removeable;
  on(
    statusOrStatusRangeOrDescriptor:
      | Status
      | StatusRange
      | Status[]
      | StatusRange[]
      | StatusRouteDescriptor<Status, Env>,
    handler?: StatusHandler<Status, Env>,
    init?: StatusRouteInit<QueryStringSchema>,
  ): Removeable {
    let status: (Status | StatusRange)[];
    let schemaDescriptor: SchemaDescriptor<
      QueryStringSchema,
      BodySchema,
      BodySchema
    > = {};
    if (!Array.isArray(statusOrStatusRangeOrDescriptor)) {
      if (typeof statusOrStatusRangeOrDescriptor === "object") {
        const { status: s, handler: h, schema: sd } =
          statusOrStatusRangeOrDescriptor;
        status = Array.isArray(s) ? s : [s];
        handler = h;
        schemaDescriptor = sd ?? {};
      } else {
        status = [statusOrStatusRangeOrDescriptor];
      }
    } else {
      status = statusOrStatusRangeOrDescriptor;
    }
    if (!handler) {
      throw new TypeError("Handler not provided");
    }
    if (init) {
      schemaDescriptor = init.schema ?? {};
    }
    const route = new StatusRoute(
      status,
      handler,
      schemaDescriptor,
      this.#keys,
    );
    this.#logger.debug(`adding status route for ${status.join(", ")}`);
    this.#statusRoutes.add(route);
    return {
      remove: () => {
        this.#logger.debug(`removing status route for ${status.join(", ")}`);
        this.#statusRoutes.delete(route);
      },
    };
  }

  /**
   * Given a path (the pathname part of a {@linkcode URL}), and a method (the
   * HTTP method) that a request is being made with, this method will return the
   * first route that matches the path and method.
   *
   * This is intended to be used for testing purposes.
   */
  match(method: HttpMethod, path: string): Route | undefined {
    for (const route of this.#routes) {
      if (route.matches(path, method)) {
        return route;
      }
    }
  }

  /**
   * Start listening for requests on the provided port and hostname.
   */
  async listen(options: ListenOptions = {}): Promise<void> {
    const {
      server: Server = isBun()
        ? (await import("./request_server_bun.ts")).default
        : isNode()
        ? (await import("./request_server_node.ts")).default
        : (await import("./request_server_deno.ts")).default,
      port = 0,
      hostname,
      tls,
      signal,
      secure,
      onListen,
    } = options;
    this.#logger.debug(`listen options: ${options}`);
    signal?.addEventListener("abort", async () => {
      this.#logger.debug(`closing server`);
      await Promise.all(this.#handling);
      this.#handling.clear();
      this.#abortController.abort();
    });
    const server = new Server<Env>({
      port,
      hostname,
      tls,
      signal: this.#abortController.signal,
    });
    const addr = await server.listen();
    this.#logger.info(`listening on: ${addr}`);
    onListen?.(addr);
    try {
      for await (const requestEvent of server) {
        this.#handle(requestEvent, secure ?? !!tls);
      }
      await Promise.all(this.#handling);
    } catch (cause) {
      this.#error(
        cause instanceof Error ? cause.message : "Internal error",
        cause,
      );
    }
  }

  /**
   * A method that is compatible with the Cloudflare Workers and will handle
   * fetch requests by the worker.
   *
   * The `passThroughOnException` option when creating the router will ensure
   * that the `ctx.passThroughOnException()` method is called when handling
   * requests. This will allow the worker to continue to handle requests even if
   * an exception is thrown during the handling of a request.
   *
   * @example Cloudflare Worker fetch handler
   *
   * Export the router as a default export which will provide the fetch handler
   * to Cloudflare:
   *
   * ```ts
   * import { Router } from "@oak/acorn";
   *
   * const router = new Router();
   * router.get("/", () => ({ hello: "world" }));
   *
   * export default router;
   * ```
   */
  fetch: CloudflareFetchHandler<Env> = async (
    request: Request,
    env: Env,
    ctx: CloudflareExecutionContext,
  ): Promise<Response> => {
    if (this.#passThroughOnException) {
      ctx.passThroughOnException();
    }
    if (!CFWRequestEventCtor) {
      CFWRequestEventCtor =
        (await import("./request_event_cfw.ts")).CloudflareWorkerRequestEvent;
    }
    const requestEvent = new CFWRequestEventCtor(request, env, ctx);
    try {
      this.#handle(requestEvent, true);
    } catch (cause) {
      this.#logger.error(`${requestEvent.id} internal error when handling.`);
      if (this.#passThroughOnException) {
        throw cause;
      }
      if (!requestEvent.responded) {
        requestEvent.respond(
          createHttpError(
            Status.InternalServerError,
            "Error thrown while handling.",
            { cause },
          ).asResponse({
            request: requestEvent.request,
            prefer: this.#preferJson ? "json" : "html",
            headers: {
              "x-request-id": requestEvent.id,
            },
          }),
        );
      }
    }
    return requestEvent.response;
  };

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
