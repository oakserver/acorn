// Copyright 2018-2024 the oak authors. All rights reserved.

import { createHttpError } from "@oak/commons/http_errors";
import { Status } from "@oak/commons/status";
import {
  type BaseIssue,
  type BaseSchema,
  type BaseSchemaAsync,
  type Config,
  type ErrorMessage,
  type InferIssue,
  type InferOutput,
  type ObjectEntries,
  type ObjectEntriesAsync,
  type ObjectIssue,
  type ObjectSchema,
  type ObjectSchemaAsync,
  parseAsync,
  safeParseAsync,
} from "@valibot/valibot";
import { parse } from "qs";

import { BODYLESS_METHODS } from "./constants.ts";
import { getLogger } from "./logger.ts";
import type { RequestEvent } from "./types.ts";

/**
 * A base type of the schema that can be applied to the body of a request or
 * response.
 */
export type BodySchema =
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>;

/**
 * A base type of the schema that can be applied to the querystring of a
 * request.
 */
export type QueryStringSchema =
  | ObjectSchema<
    ObjectEntries,
    ErrorMessage<ObjectIssue> | undefined
  >
  | ObjectSchemaAsync<
    ObjectEntriesAsync,
    ErrorMessage<ObjectIssue> | undefined
  >;

/**
 * A function that can be called when a schema is invalid.
 *
 * `part` is a string that indicates which part of the schema is invalid.
 * `"querystring"` indicates that the querystring schema is invalid. `"body"`
 * indicates that the body schema is invalid. `"response"` indicates that the
 * response schema is invalid.
 *
 * `issues` is an array of issues that were found when validating the schema.
 *
 * The handler is expected to return a response which will be sent to the
 * client. If the handler throws an error, a `InternalServerError` HTTP error
 * will be thrown with the error as the `cause`.
 */
export interface InvalidHandler<
  QSSchema extends QueryStringSchema,
  BSchema extends BodySchema,
  ResSchema extends BodySchema,
> {
  (
    part: "querystring",
    issues: [InferIssue<QSSchema>, ...InferIssue<QSSchema>[]],
  ): Promise<Response> | Response;
  (
    part: "body",
    issues: [InferIssue<BSchema>, ...InferIssue<BSchema>[]],
  ): Promise<Response> | Response;
  (
    part: "response",
    issues: [InferIssue<ResSchema>, ...InferIssue<ResSchema>[]],
  ): Promise<Response> | Response;
}

type ValidationOptions<
  Schema extends BodySchema,
> = Omit<Config<InferIssue<Schema>>, "skipPipe">;

type MaybeValid<T> = { output: T; invalidResponse?: undefined } | {
  output?: undefined;
  invalidResponse: Response;
};

/**
 * A descriptor for a schema that can be applied to a request and response.
 *
 * @template QSSchema the schema that can be applied to the querystring of a
 * request.
 * @template BSchema the schema that can be applied to the body of a request.
 * @template ResSchema the schema that can be applied to the body of a response.
 */
export interface SchemaDescriptor<
  QSSchema extends QueryStringSchema,
  BSchema extends BodySchema,
  ResSchema extends BodySchema,
> {
  /**
   * A schema that can be applied to the querystring of a request.
   */
  querystring?: QSSchema;
  /**
   * A schema that can be applied to the body of a request.
   */
  body?: BSchema;
  /**
   * A schema that can be applied to the body of a response.
   */
  response?: ResSchema;
  /**
   * Options that can be applied to the validation of the schema.
   */
  options?: ValidationOptions<QSSchema | BSchema | ResSchema>;
  /**
   * A handler that can be called when the schema is invalid.
   *
   * The handler is expected to return a response which will be sent to the
   * client. If the handler throws an error, a `InternalServerError` HTTP error
   * will be thrown with the error as the `cause`.
   */
  invalidHandler?: InvalidHandler<QSSchema, BSchema, ResSchema>;
}

/**
 * A class that can apply validation schemas to the querystring and request and
 * response bodies.
 */
export class Schema<
  QSSchema extends QueryStringSchema,
  BSchema extends BodySchema,
  ResSchema extends BodySchema,
> {
  #body?: BSchema;
  #invalidHandler?: InvalidHandler<QSSchema, BSchema, ResSchema>;
  #logger = getLogger("acorn.schema");
  #options?: ValidationOptions<QSSchema | BSchema | ResSchema>;
  #querystring?: QSSchema;
  #response?: ResSchema;

  constructor(descriptor: SchemaDescriptor<QSSchema, BSchema, ResSchema> = {}) {
    this.#querystring = descriptor.querystring;
    this.#body = descriptor.body;
    this.#response = descriptor.response;
    this.#options = descriptor.options;
    this.#invalidHandler = descriptor.invalidHandler;
  }

  /**
   * Given a {@linkcode RequestEvent}, this method will attempt to parse the
   * `search` part of the URL and validate it against the schema provided. If
   * no schema was provided, the parsed search will be returned. If the schema
   * is provided and the parsed search is invalid, the invalid handler will be
   * called if provided, otherwise a `BadRequest` HTTP error will be thrown.
   */
  async validateQueryString(
    requestEvent: RequestEvent,
  ): Promise<MaybeValid<unknown>> {
    const id = requestEvent.id;
    this.#logger.debug(`${id} schema.validateQueryString()`);
    const input = parse(requestEvent.url.search.slice(1));
    if (!this.#querystring) {
      this.#logger.debug(`${id} no querystring schema provided.`);
      return { output: input };
    }
    if (this.#invalidHandler) {
      this.#logger.debug(`${id} validating querystring.`);
      const result = await safeParseAsync(
        this.#querystring,
        input,
        this.#options,
      );
      if (result.success) {
        this.#logger.debug(`${id} querystring is valid.`);
        return { output: result.output };
      } else {
        try {
          this.#logger
            .info(`${id} querystring is invalid, calling invalid handler.`);
          return {
            invalidResponse: await this.#invalidHandler(
              "querystring",
              result.issues,
            ),
          };
        } catch (cause) {
          this.#logger.error(`${id} invalid handler failed.`);
          throw createHttpError(
            Status.InternalServerError,
            "Invalid handler failed",
            { cause },
          );
        }
      }
    } else {
      try {
        this.#logger.debug(`${id} validating querystring.`);
        return {
          output: await parseAsync(this.#querystring, input, this.#options),
        };
      } catch (cause) {
        this.#logger.info(`${id} querystring is invalid.`);
        throw createHttpError(Status.BadRequest, "Invalid querystring", {
          cause,
        });
      }
    }
  }

  /**
   * Given a {@linkcode RequestEvent}, this method will attempt to parse the
   * body of a request as JSON validate it against the schema provided. If no
   * schema was provided, the parsed search will be returned. If the schema is
   * provided and the parsed search is invalid, the invalid handler will be
   * called if provided, otherwise a `BadRequest` HTTP error will be thrown.
   *
   * If the request method is `GET` or `HEAD`, the body will always be
   * `undefined`.
   */
  async validateBody(requestEvent: RequestEvent): Promise<MaybeValid<unknown>> {
    this.#logger.debug(`${requestEvent.id} schema.validateQueryString()`);
    if (BODYLESS_METHODS.includes(requestEvent.request.method)) {
      this.#logger.debug(`${requestEvent.id} method cannot have a body.`);
      return { output: undefined };
    }
    const input = await requestEvent.request.json();
    if (!this.#body) {
      this.#logger.debug(`${requestEvent.id} no body schema provided.`);
      return { output: input };
    }
    if (this.#invalidHandler) {
      const result = await safeParseAsync(
        this.#body,
        input,
        this.#options,
      );
      if (result.success) {
        this.#logger.debug(`${requestEvent.id} body is valid.`);
        return { output: result.output };
      } else {
        try {
          this.#logger
            .info(
              `${requestEvent.id} body is invalid, calling invalid handler.`,
            );
          return {
            invalidResponse: await this.#invalidHandler(
              "body",
              result.issues,
            ),
          };
        } catch (cause) {
          this.#logger.error(`${requestEvent.id} invalid handler failed.`);
          throw createHttpError(
            Status.InternalServerError,
            "Invalid handler failed",
            { cause },
          );
        }
      }
    } else {
      try {
        this.#logger.debug(`${requestEvent.id} validating body.`);
        return {
          output: await parseAsync(this.#body, input, this.#options),
        };
      } catch (cause) {
        this.#logger.info(`${requestEvent.id} body is invalid.`);
        throw createHttpError(Status.BadRequest, "Invalid body", { cause });
      }
    }
  }

  /**
   * Given a response body, this method will attempt to validate it against the
   * schema provided. If no schema was provided, the response body will be
   * passed through. If the schema is provided and the response body is invalid,
   * the invalid handler will be called if provided, otherwise a `BadRequest`
   * HTTP error will be thrown.
   */
  async validateResponse(
    input: unknown,
  ): Promise<MaybeValid<InferOutput<ResSchema>>> {
    if (!this.#response) {
      return { output: input };
    }
    if (this.#invalidHandler) {
      const result = await safeParseAsync(
        this.#response,
        input,
        this.#options,
      );
      if (result.success) {
        return { output: result.output };
      } else {
        try {
          return {
            invalidResponse: await this.#invalidHandler(
              "response",
              result.issues,
            ),
          };
        } catch (cause) {
          throw createHttpError(
            Status.InternalServerError,
            "Invalid handler failed",
            { cause },
          );
        }
      }
    } else {
      try {
        return {
          output: await parseAsync(this.#response, input, this.#options),
        };
      } catch (cause) {
        throw createHttpError(
          Status.InternalServerError,
          "Response body was invalid.",
          { cause },
        );
      }
    }
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
