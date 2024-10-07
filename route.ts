// Copyright 2018-2024 the oak authors. All rights reserved.

import type { KeyRing } from "@oak/commons/cookie_map";
import { createHttpError } from "@oak/commons/http_errors";
import type { HttpMethod } from "@oak/commons/method";
import { Status, STATUS_TEXT } from "@oak/commons/status";
import { type Key, pathToRegexp } from "path-to-regexp";
import type { InferOutput } from "@valibot/valibot";

import { NOT_ALLOWED } from "./constants.ts";
import { Context } from "./context.ts";
import { getLogger, type Logger } from "./logger.ts";
import {
  type BodySchema,
  type QueryStringSchema,
  Schema,
  type SchemaDescriptor,
} from "./schema.ts";
import type {
  NotAllowed,
  ParamsDictionary,
  RequestEvent,
  Route,
  RouteParameters,
} from "./types.ts";
import { appendHeaders, decodeComponent } from "./utils.ts";

/**
 * A function that handles a route. The handler is provided a
 * {@linkcode Context} object which provides information about the request
 * being handled as well as other methods for interacting with the request.
 * A handler can return a {@linkcode Response} object, a value that can be
 * serialized to JSON, or `undefined`. If a value is returned, it will be
 * validated against the response schema of the route. If `undefined` is
 * returned, the response will be handled as a `204 No Content` response.
 *
 * The handler can also return a promise that resolves to any of the above
 * values.
 */
export interface RouteHandler<
  Env extends Record<string, string> = Record<string, string>,
  Params extends ParamsDictionary | undefined = ParamsDictionary | undefined,
  QSSchema extends QueryStringSchema = QueryStringSchema,
  QueryParams extends InferOutput<QSSchema> = InferOutput<QSSchema>,
  BSchema extends BodySchema = BodySchema,
  RequestBody extends InferOutput<BSchema> = InferOutput<BSchema>,
  ResSchema extends BodySchema = BodySchema,
  ResponseBody extends InferOutput<ResSchema> = InferOutput<ResSchema>,
> {
  (
    context: Context<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema
    >,
  ):
    | Promise<Response | ResponseBody | undefined>
    | Response
    | ResponseBody
    | undefined;
}

/**
 * Options which can be set with on a route, related to how matching against a
 * path pattern works.
 */
export interface RouteOptions {
  /**
   * Allows the path delimiter (`/`) to be repeated arbitrarily.
   *
   * @default true
   */
  loose?: boolean;
  /**
   * When matching route paths, enforce cases sensitive matches.
   *
   * @default false
   */
  sensitive?: boolean;
  /**
   * When matching route paths, ensure that optional trailing slashes are not
   * matched.
   *
   * @default true
   */
  trailing?: boolean;
}

/**
 * Encapsulation of logic for a registered router handler.
 */
export class PathRoute<
  Path extends string = string,
  Params extends RouteParameters<Path> = RouteParameters<Path>,
  Env extends Record<string, string> = Record<string, string>,
  QSSchema extends QueryStringSchema = QueryStringSchema,
  QueryParams extends InferOutput<QSSchema> = InferOutput<QSSchema>,
  BSchema extends BodySchema = BodySchema,
  RequestBody extends InferOutput<BSchema> | undefined =
    | InferOutput<BSchema>
    | undefined,
  ResSchema extends BodySchema = BodySchema,
  ResponseBody extends InferOutput<ResSchema> = InferOutput<ResSchema>,
> implements Route<Env> {
  #expose: boolean;
  #handler: RouteHandler<
    Env,
    Params,
    QSSchema,
    QueryParams,
    BSchema,
    RequestBody,
    ResSchema,
    ResponseBody
  >;
  #keys?: KeyRing;
  #logger: Logger;
  #methods: HttpMethod[];
  #params?: Params;
  #paramKeys: Key[];
  #path: Path;
  #regexp: RegExp;
  #schema: Schema<QSSchema, BSchema, ResSchema>;

  /**
   * The methods that this route is registered to handle.
   */
  get methods(): HttpMethod[] {
    return [...this.#methods];
  }

  /**
   * Set when a route is matched, contains the values that are parsed out of
   * the matched route.
   */
  get params(): Params | undefined {
    return this.#params;
  }

  /**
   * The path that this route is registered on, following the pattern matching
   * and parameter parsing syntax of
   * [path-to-regexp](https://github.com/pillarjs/path-to-regexp).
   */
  get path(): Path {
    return this.#path;
  }

  /**
   * The path pattern that has been converted into {@linkcode RegExp}.
   */
  get regex(): RegExp {
    return this.#regexp;
  }

  /**
   * If provided, the validation schema which is used to validate the body of
   * the request.
   */
  get schema(): Schema<QSSchema, BSchema, ResSchema> {
    return this.#schema;
  }

  constructor(
    path: Path,
    methods: HttpMethod[],
    schemaDescriptor: SchemaDescriptor<QSSchema, BSchema, ResSchema>,
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
    keys: KeyRing | undefined,
    expose: boolean,
    options?: RouteOptions,
  ) {
    this.#path = path;
    this.#methods = methods;
    this.#schema = new Schema(schemaDescriptor, expose);
    this.#handler = handler;
    this.#keys = keys;
    this.#expose = expose;
    const { regexp, keys: paramKeys } = pathToRegexp(path, { ...options });
    this.#regexp = regexp;
    this.#paramKeys = paramKeys;
    this.#logger = getLogger("acorn.route");
    this.#logger
      .debug(`created route with path: ${path} and methods: ${methods}`);
  }

  /**
   * Invokes the associated handler with the route and returns any response
   * from the handler.
   */
  async handle(
    requestEvent: RequestEvent<Env>,
    responseHeaders: Headers,
    secure: boolean,
  ): Promise<Response | undefined> {
    this.#logger.debug(`[${this.#path}] ${requestEvent.id} route.handle()`);
    if (!this.#params) {
      throw createHttpError(
        Status.InternalServerError,
        "Route parameters missing.",
      );
    }
    const context = new Context<
      Env,
      Params,
      QSSchema,
      QueryParams,
      BSchema,
      RequestBody,
      ResSchema
    >(
      requestEvent,
      responseHeaders,
      secure,
      this.#params,
      this.#schema,
      this.#keys,
      this.#expose,
    );
    this.#logger.debug(`[${this.#path}] ${requestEvent.id} calling handler`);
    const result = await this.#handler(context);
    this.#logger
      .debug(`${requestEvent.id} handler returned with value: ${!!result}`);
    if (result instanceof Response) {
      this.#logger
        .debug(
          `[${this.#path}] ${requestEvent.id} handler returned a Response object`,
        );
      return appendHeaders(result, responseHeaders);
    }
    if (result) {
      this.#logger
        .debug(
          `${requestEvent.id} handler returned a value, validating response`,
        );
      const maybeValid = await this.#schema.validateResponse(result);
      if (maybeValid.output) {
        this.#logger
          .debug(`[${this.#path}] ${requestEvent.id} response is valid`);
        return Response.json(maybeValid.output, { headers: responseHeaders });
      } else {
        this.#logger
          .error(`[${this.#path}] ${requestEvent.id} response is invalid`);
        return maybeValid.invalidResponse;
      }
    }
    this.#logger
      .debug(`[${this.#path}] ${requestEvent.id} handler returned no value`);
    return new Response(null, {
      status: Status.NoContent,
      statusText: STATUS_TEXT[Status.NoContent],
    });
  }

  /**
   * Determines if the request should be handled by the route.
   */
  matches(method: HttpMethod, pathname: string): boolean | NotAllowed {
    const match = pathname.match(this.#regexp);
    if (match) {
      if (!this.#methods.includes(method)) {
        return NOT_ALLOWED;
      }
      this.#logger
        .debug(`[${this.#path}] route matched: ${method} ${pathname}`);
      const params = {} as Params;
      const captures = match.slice(1);
      for (let i = 0; i < captures.length; i++) {
        if (this.#paramKeys[i]) {
          const capture = captures[i];
          (params as Record<string, string>)[this.#paramKeys[i].name] =
            decodeComponent(capture);
        }
      }
      this.#params = params;
      return true;
    }
    return false;
  }

  [Symbol.for("Deno.customInspect")](
    inspect: (value: unknown) => string,
  ): string {
    return `${this.constructor.name} ${
      inspect({
        params: this.#params,
        path: this.#path,
        regex: this.#regexp,
        schema: this.#schema,
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
        params: this.#params,
        path: this.#path,
        regex: this.#regexp,
        schema: this.#schema,
      }, newOptions)
    }`;
  }
}
