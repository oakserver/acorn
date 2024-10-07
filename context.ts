// Copyright 2018-2024 the oak authors. All rights reserved.

/**
 * The module which contains the {@linkcode Context} class which provides an
 * interface for working with requests.
 *
 * As the router handles requests, it will create a context populated with
 * information about the request.
 *
 * @module
 */

import { type KeyRing, SecureCookieMap } from "@oak/commons/cookie_map";
import {
  createHttpError,
  type HttpErrorOptions,
} from "@oak/commons/http_errors";
import {
  ServerSentEventStreamTarget,
  type ServerSentEventTarget,
  type ServerSentEventTargetOptions,
} from "@oak/commons/server_sent_event";
import {
  type ErrorStatus,
  type RedirectStatus,
  Status,
  STATUS_TEXT,
} from "@oak/commons/status";
import { UserAgent } from "@std/http/user-agent";
import type { InferOutput } from "@valibot/valibot";

import { getLogger, type Logger } from "./logger.ts";
import type { BodySchema, QueryStringSchema, Schema } from "./schema.ts";
import type {
  Addr,
  ParamsDictionary,
  RequestEvent,
  RouteParameters,
  UpgradeWebSocketOptions,
} from "./types.ts";
import { appendHeaders } from "./utils.ts";
import { compile } from "path-to-regexp";

export interface RedirectInit<LocationParams extends ParamsDictionary> {
  /**
   * The parameters to interpolate into the `location` path.
   */
  params?: LocationParams;
  /**
   * The status to use for the redirect. Defaults to `302 Found`.
   */
  status?: RedirectStatus;
}

/**
 * Initiation options when responding to a request with a `201 Created` status.
 */
export interface RespondInit<
  Location extends string,
  LocationParams extends ParamsDictionary,
> {
  /**
   * Additional headers to include in the response.
   */
  headers?: HeadersInit;
  /**
   * The location to include in the `Location` header of the response.
   *
   * If the path includes parameters, the `params` should be provided to
   * interpolate the values into the path.
   */
  location?: Location;
  /**
   * The parameters to interpolate into the `location` path.
   */
  params?: LocationParams;
}

/**
 * Provides an API for understanding information about the request being
 * processed by the router.
 *
 * @template Env a type which allows strongly typing the environment variables
 * that are made available on the context used within handlers.
 * @template Params a type which is typically inferred from the route path
 * selector which represents the shape of route parameters that are parsed
 * from the route
 * @template QueryParams a type which represents the shape of query parameters
 * that are parsed from the search parameters of the request
 * @template Schema the validation schema which is used to infer the shape of
 * the request's parsed and validated body
 * @template RequestBody the shape of the parsed (and potentially validated)
 * body
 */
export class Context<
  Env extends Record<string, string>,
  Params extends ParamsDictionary | undefined,
  QSSchema extends QueryStringSchema,
  QueryParams extends InferOutput<QSSchema>,
  BSchema extends BodySchema,
  RequestBody extends InferOutput<BSchema> | undefined,
  ResSchema extends BodySchema,
> {
  #body?: RequestBody;
  #bodySet = false;
  #cookies: SecureCookieMap;
  #expose: boolean;
  #logger: Logger;
  #params: Params;
  #queryParams?: QueryParams;
  #requestEvent: RequestEvent<Env>;
  #responseHeaders: Headers;
  #schema: Schema<QSSchema, BSchema, ResSchema>;
  #url: URL;
  #userAgent?: UserAgent;

  /**
   * The address information of the remote connection making the request as
   * presented to the server.
   */
  get addr(): Addr {
    return this.#requestEvent.addr;
  }

  /**
   * Provides a unified API to get and set cookies related to a request and
   * response. If the `keys` property has been set when the router was created,
   * these cookies will be cryptographically signed and verified to prevent
   * tampering with their value.
   */
  get cookies(): SecureCookieMap {
    return this.#cookies;
  }

  /**
   * Access to the environment variables in a runtime independent way.
   *
   * In some runtimes, like Cloudflare Workers, the environment variables are
   * supplied on each request, where in some cases they are available from the
   * runtime environment via specific APIs. This always conforms the variables
   * into a `Record<string, string>` which can be strongly typed when creating
   * the router instance if desired.
   */
  get env(): Env {
    return this.#requestEvent.env ?? Object.create(null);
  }

  /**
   * A globally unique identifier for the request event.
   *
   * This can be used for logging and debugging purposes.
   *
   * For automatically generated error responses, this identifier will be added
   * to the response as the `X-Request-ID` header.
   */
  get id(): string {
    return this.#requestEvent.id;
  }

  /**
   * The parameters that have been parsed from the path following the syntax
   * of [path-to-regexp](https://github.com/pillarjs/path-to-regexp).
   *
   * @example
   *
   * Given the following route path pattern:
   *
   * ```
   * /:foo/:bar
   * ```
   *
   * And the following request path:
   *
   * ```
   * /item/123
   * ```
   *
   * The value of `.params` would be set to:
   *
   * ```ts
   * {
   *   foo: "item",
   *   bar: "123",
   * }
   * ```
   */
  get params(): Params {
    return this.#params;
  }

  /**
   * The {@linkcode Request} object associated with the request.
   */
  get request(): Request {
    return this.#requestEvent.request;
  }

  /**
   * The {@linkcode Headers} object which will be used to set headers on the
   * response.
   */
  get responseHeaders(): Headers {
    return this.#responseHeaders;
  }

  /**
   * The parsed form of the {@linkcode Request}'s URL.
   */
  get url(): URL {
    return this.#url;
  }

  /**
   * A representation of the parsed value of the
   * [`User-Agent`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/User-Agent)
   * header if associated with the request. This can provide information about
   * the browser and device making the request.
   */
  get userAgent(): UserAgent {
    if (!this.#userAgent) {
      this.#userAgent = new UserAgent(
        this.#requestEvent.request.headers.get("user-agent"),
      );
    }
    return this.#userAgent;
  }

  constructor(
    requestEvent: RequestEvent<Env>,
    responseHeaders: Headers,
    secure: boolean,
    params: Params,
    schema: Schema<QSSchema, BSchema, ResSchema>,
    keys: KeyRing | undefined,
    expose: boolean,
  ) {
    this.#requestEvent = requestEvent;
    this.#responseHeaders = responseHeaders;
    this.#params = params;
    this.#schema = schema;
    this.#url = new URL(this.#requestEvent.request.url);
    this.#cookies = new SecureCookieMap(requestEvent.request, {
      keys,
      response: responseHeaders,
      secure,
    });
    this.#logger = getLogger("acorn.context");
    this.#expose = expose;
  }

  /**
   * Attempts to read the body as JSON. If a schema was associated with the
   * route, the schema will be used to validate the body. If the body is invalid
   * and a invalid handler was specified, that will be called. If the body is
   * invalid and no invalid handler was specified, the method will throw as a
   * `BadRequest` HTTP error, with the validation error as the `cause`.
   *
   * If the body is valid, it will be resolved. If there was no body, or the
   * body was already consumed, `undefined` will be resolved. Requests which
   * have a method of `GET` or `HEAD` will always resolved with `undefined`.
   *
   * If more direct control of the body is required, use the methods directly
   * on the {@linkcode Request} on the `.request` property of the context.
   */
  async body(): Promise<RequestBody | undefined> {
    if (!this.#bodySet) {
      this.#bodySet = true;
      this.#logger.debug(`${this.#requestEvent.id} validating body`);
      const result = await this.#schema.validateBody(this.#requestEvent);
      if (result.invalidResponse) {
        this.#requestEvent.respond(result.invalidResponse);
        return undefined;
      }
      this.#body = result.output as RequestBody;
    }
    return this.#body;
  }

  /**
   * Will throw an HTTP error with the status of `409 Conflict` and the message
   * provided. If a `cause` is provided, it will be included in the error as the
   * `cause` property.
   *
   * This is an appropriate response when a `PUT` request is made to a resource
   * that cannot be updated because it is in a state that conflicts with the
   * request.
   */
  conflict(message = "Resource conflict", cause?: unknown): never {
    throw createHttpError(Status.Conflict, message, {
      cause,
      expose: this.#expose,
    });
  }

  /**
   * Returns a {@linkcode Response} with the status of `201 Created` and the
   * body provided. If a `location` is provided in the respond init, the
   * response will include a `Location` header with the value of the `location`.
   *
   * If `locationParams` is provided, the `location` will be compiled with the
   * `params` and the resulting value will be used as the value of the
   * `Location` header. For example, if the `location` is `/book/:id` and the
   * `params` is `{ id: "123" }`, the `Location` header will be set to
   * `/book/123`.
   *
   * This is an appropriate response when a `POST` request is made to create a
   * new resource.
   */
  created<
    Location extends string,
    LocationParams extends ParamsDictionary = RouteParameters<Location>,
  >(
    body: InferOutput<ResSchema>,
    init: RespondInit<Location, LocationParams> = {},
  ): Response {
    const { headers, location, params } = init;
    const response = Response.json(body, {
      status: Status.Created,
      statusText: STATUS_TEXT[Status.Created],
      headers,
    });
    if (location) {
      if (params) {
        const toPath = compile(location);
        response.headers.set("location", toPath(params));
      } else {
        response.headers.set("location", location);
      }
    }
    return response;
  }

  /**
   * Will throw an HTTP error with the status of `404 Not Found` and the message
   * provided. If a `cause` is provided, it will be included in the error as the
   * `cause` property.
   *
   * This is an appropriate response when a resource is requested that does not
   * exist.
   */
  notFound(message = "Resource not found", cause?: unknown): never {
    throw createHttpError(Status.NotFound, message, {
      cause,
      expose: this.#expose,
    });
  }

  /**
   * In addition to the value of `.url.searchParams`, acorn can parse and
   * validate the search part of the requesting URL with the
   * [qs](https://github.com/ljharb/qs) library and any supplied query string
   * schema, which provides a more advanced way of parsing the search part of a
   * URL.
   */
  async queryParams(): Promise<QueryParams | undefined> {
    if (!this.#queryParams) {
      this.#logger.debug(
        `${this.#requestEvent.id} validating query parameters`,
      );
      const result = await this.#schema.validateQueryString(this.#requestEvent);
      if (result.invalidResponse) {
        this.#requestEvent.respond(result.invalidResponse);
        return undefined;
      }
      this.#queryParams = result.output as QueryParams;
    }
    return this.#queryParams;
  }

  /**
   * Redirect the client to a new location. The `location` can be a relative
   * path or an absolute URL. If the `location` string includes parameters, the
   * `params` should be provided in the init to interpolate the values into the
   * path.
   *
   * For example if the `location` is `/book/:id` and the `params` is `{ id:
   * "123" }`, the resulting URL will be `/book/123`.
   *
   * The status defaults to `302 Found`, but can be set to any of the redirect
   * statuses via passing it in the `init`.
   */
  redirect<
    Location extends string,
    LocationParams extends ParamsDictionary = RouteParameters<Location>,
  >(
    location: Location,
    init: RedirectInit<LocationParams> = {},
    // status: RedirectStatus = Status.Found,
    // params?: LocationParams,
  ): Response {
    const { status, params } = init;
    if (params) {
      const toPath = compile(location);
      location = toPath(params) as Location;
    }
    return Response.redirect(location, status);
  }

  /**
   * Initiate server sent events, returning a {@linkcode ServerSentEventTarget}
   * which can be used to dispatch events to the client.
   *
   * This will immediately finalize the response and send it to the client,
   * which means that any value returned from the handler will be ignored. Any
   * additional information to initialize the response should be passed as
   * options to the method.
   */
  sendEvents(
    options?: ServerSentEventTargetOptions & ResponseInit,
  ): ServerSentEventTarget {
    if (this.#requestEvent.responded) {
      throw new Error("Cannot send the correct response, already responded.");
    }
    this.#logger.debug(`${this.#requestEvent.id} starting server sent events`);
    const sse = new ServerSentEventStreamTarget(options);
    const response = sse.asResponse(options);
    this.#requestEvent.respond(appendHeaders(response, this.#responseHeaders));
    return sse;
  }

  /**
   * Throw an HTTP error with the specified status and message, along with any
   * options. If the status is not provided, it will default to `500 Internal
   * Server Error`.
   */
  throw(
    status?: ErrorStatus,
    message?: string,
    options?: HttpErrorOptions,
  ): never {
    throw createHttpError(status, message, options);
  }

  /**
   * Upgrade the current connection to a web socket and return the
   * {@linkcode WebSocket} object to be able to communicate with the remote
   * client.
   *
   * This is not supported in all runtimes and will throw if not supported.
   *
   * This will immediately respond to the client to initiate the web socket
   * connection meaning any value returned from the handler will be ignored.
   */
  upgrade(options?: UpgradeWebSocketOptions): WebSocket {
    if (!this.#requestEvent.upgrade) {
      throw createHttpError(
        Status.ServiceUnavailable,
        "Web sockets not currently supported.",
        { expose: this.#expose },
      );
    }
    if (this.#requestEvent.responded) {
      throw new Error("Cannot upgrade, already responded.");
    }
    this.#logger.debug(`${this.#requestEvent.id} upgrading to web socket`);
    return this.#requestEvent.upgrade(options);
  }

  /** Custom inspect method under Deno. */
  [Symbol.for("Deno.customInspect")](
    inspect: (value: unknown) => string,
  ): string {
    return `${this.constructor.name} ${
      inspect({
        addr: this.#requestEvent.addr,
        env: this.env,
        id: this.#requestEvent.id,
        params: this.#params,
        cookies: this.#cookies,
        request: this.#requestEvent.request,
        responseHeaders: this.#responseHeaders,
        userAgent: this.userAgent,
        url: this.#url,
      })
    }`;
  }

  /** Custom inspect method under Node.js. */
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
        addr: this.#requestEvent.addr,
        env: this.env,
        id: this.#requestEvent.id,
        params: this.#params,
        cookies: this.#cookies,
        request: this.#requestEvent.request,
        responseHeaders: this.#responseHeaders,
        userAgent: this.userAgent,
        url: this.#url,
      }, newOptions)
    }`;
  }
}
