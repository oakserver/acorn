// Copyright 2018-2024 the oak authors. All rights reserved.

import type { KeyRing } from "@oak/commons/cookie_map";
import {
  isClientErrorStatus,
  isErrorStatus,
  isInformationalStatus,
  isRedirectStatus,
  isServerErrorStatus,
  isSuccessfulStatus,
  type Status,
} from "@oak/commons/status";
import type { InferOutput } from "@valibot/valibot";

import { Context } from "./context.ts";
import {
  type BodySchema,
  type QueryStringSchema,
  Schema,
  type SchemaDescriptor,
} from "./schema.ts";
import type { RequestEvent } from "./types.ts";
import { appendHeaders } from "./utils.ts";

/**
 * A string that represents a range of HTTP response {@linkcode Status} codes:
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

/**
 * A function that handles a status route. The handler is provided a
 * {@linkcode Context} object which provides information about the request
 * being handled as well as other methods for interacting with the request.
 * The status is also provided to the handler, along with the current response.
 *
 * The status handler can return a {@linkcode Response} object or `undefined`.
 * If a value is returned, it will be used as the response instead of the
 * provided on. If `undefined` is returned, the original response will be sent
 * to the client. The handler can also return a promise that resolves to any of
 * the above values.
 */
export interface StatusHandler<
  S extends Status,
  Env extends Record<string, string> = Record<string, string>,
  QSSchema extends QueryStringSchema = QueryStringSchema,
  QueryParams extends InferOutput<QSSchema> = InferOutput<QSSchema>,
> {
  (
    context: Context<
      Env,
      undefined,
      QSSchema,
      QueryParams,
      BodySchema,
      undefined,
      BodySchema
    >,
    status: S,
    response: Response,
  ):
    | Promise<Response | undefined>
    | Response
    | undefined;
}

/** The descriptor for defining a status route. */
export interface StatusRouteDescriptor<
  S extends Status = Status,
  Env extends Record<string, string> = Record<string, string>,
  QSSchema extends QueryStringSchema = QueryStringSchema,
  QueryParams extends InferOutput<QSSchema> = InferOutput<QSSchema>,
> {
  /** The statuses or status ranges that the handler should apply to. */
  status: S | StatusRange | S[] | StatusRange[];
  /**
   * The handler to be called when there is a match in the response to one of
   * the specified status or status ranges.
   */
  handler: StatusHandler<S, Env, QSSchema, QueryParams>;
  schema?: SchemaDescriptor<QSSchema, BodySchema, BodySchema>;
}

/** Initialization options when setting a status route. */
export interface StatusRouteInit<
  QSSchema extends QueryStringSchema = QueryStringSchema,
> {
  /**
   * The schema to be used for validating the query string, on the request
   * when provided in the context to the handler.
   */
  schema?: SchemaDescriptor<QSSchema, BodySchema, BodySchema>;
}

/**
 * Encapsulation of logic for a registered status handler.
 */
export class StatusRoute<
  Env extends Record<string, string>,
  QSSchema extends QueryStringSchema = QueryStringSchema,
  QueryParams extends InferOutput<QSSchema> = InferOutput<QSSchema>,
> {
  #handler: StatusHandler<Status, Env, QSSchema, QueryParams>;
  #keys?: KeyRing;
  #schema: Schema<QSSchema, BodySchema, BodySchema>;
  #status: (Status | StatusRange)[];

  /**
   * The statuses or status ranges that are handled by this status route.
   */
  get status(): (Status | StatusRange)[] {
    return this.#status;
  }

  constructor(
    status: (Status | StatusRange)[],
    handler: StatusHandler<Status, Env, QSSchema, QueryParams>,
    schemaDescriptor: SchemaDescriptor<QSSchema, BodySchema, BodySchema>,
    keys?: KeyRing,
  ) {
    this.#status = status;
    this.#handler = handler;
    this.#keys = keys;
    this.#schema = new Schema(schemaDescriptor);
  }

  /**
   * Invokes the associated handler with the route and returns any response
   * from the handler.
   */
  async handle(
    requestEvent: RequestEvent<Env>,
    responseHeaders: Headers,
    secure: boolean,
    response: Response,
  ): Promise<Response> {
    const context = new Context<
      Env,
      undefined,
      QSSchema,
      QueryParams,
      BodySchema,
      undefined,
      BodySchema
    >(
      requestEvent,
      responseHeaders,
      secure,
      undefined,
      this.#schema,
      this.#keys,
    );
    const result = await this.#handler(context, response.status, response);
    if (result instanceof Response) {
      return appendHeaders(result, responseHeaders);
    }
    return response;
  }

  /**
   * Determines if the handler should be applied to the request and pending
   * response.
   */
  matches(response: Response): boolean {
    const { status } = response;
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

  [Symbol.for("Deno.customInspect")](
    inspect: (value: unknown) => string,
  ): string {
    return `${this.constructor.name} ${inspect({ status: this.#status })}`;
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
      inspect({ status: this.#status }, newOptions)
    }`;
  }
}
