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
import { createHttpError } from "@oak/commons/http_errors";
import {
  ServerSentEventStreamTarget,
  type ServerSentEventTarget,
  type ServerSentEventTargetOptions,
} from "@oak/commons/server_sent_event";
import { Status } from "@oak/commons/status";
import { UserAgent } from "@std/http/user-agent";
import type { InferOutput } from "@valibot/valibot";

import { getLogger, type Logger } from "./logger.ts";
import type { BodySchema, QueryStringSchema, Schema } from "./schema.ts";
import type {
  Addr,
  ParamsDictionary,
  RequestEvent,
  UpgradeWebSocketOptions,
} from "./types.ts";
import { appendHeaders } from "./utils.ts";

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
      );
    }
    if (this.#requestEvent.responded) {
      throw new Error("Cannot upgrade, already responded.");
    }
    this.#logger.debug(`${this.#requestEvent.id} upgrading to web socket`);
    return this.#requestEvent.upgrade(options);
  }

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
        userAgent: this.userAgent,
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
        addr: this.#requestEvent.addr,
        env: this.env,
        id: this.#requestEvent.id,
        params: this.#params,
        cookies: this.#cookies,
        request: this.#requestEvent.request,
        userAgent: this.userAgent,
        url: this.#url,
      }, newOptions)
    }`;
  }
}
