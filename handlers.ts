// Copyright 2022-2024 the oak authors. All rights reserved.

/** Contains handler factory functions which simplify some common use cases.
 *
 * @module
 */

import { type Context } from "./context.ts";
import { createHttpError, Status, STATUS_TEXT } from "./deps.ts";
import {
  type RouteHandler,
  type RouteOptions,
  type RouteOptionsWithHandler,
  type RouteParameters,
} from "./router.ts";
import {
  CONTENT_TYPE_HTML,
  CONTENT_TYPE_JSON,
  CONTENT_TYPE_TEXT,
  isBodyInit,
  isHtmlLike,
  isJsonLike,
} from "./util.ts";

export interface AuthOptions<
  R extends string,
  BodyType,
  Params extends RouteParameters<R>,
> extends RouteOptions<R, BodyType, Params> {
  authorize(
    ctx: Context<BodyType, Params>,
  ):
    | Promise<boolean | BodyInit | Response | undefined>
    | boolean
    | BodyInit
    | Response
    | undefined;
}

/** A handler which allows easy implementation of authorization for a route.
 *
 * The {@linkcode auth} handler takes the content handler plus options which
 * includes an authorization handler.
 *
 * @example
 * ```ts
 * import { Router, immutable } from "jsr:@oak/acorn/";
 *
 * const router = new Router();
 *
 * router.all("/", auth(() => ({ hello: "acorn"}), {
 *   authorize(ctx) {
 *    if (
 *      ctx.request.headers.get("authorization")?.toLowerCase() ===
 *        "bearer 123456789"
 *    ) {
 *      return true;
 *    }
 *  },
 * }));
 *
 * router.listen({ port: 8080 });
 * ```
 */
export function auth<
  R extends string,
  BodyType,
  Params extends RouteParameters<R>,
  ResponseType,
>(
  handler: RouteHandler<ResponseType, BodyType, Params>,
  options: AuthOptions<R, BodyType, Params>,
): RouteOptionsWithHandler<R, BodyType, Params, ResponseType> {
  const { authorize, ...routeOptions } = options;
  return {
    async handler(ctx) {
      const result = await authorize(ctx);
      if (result === true) {
        return handler(ctx);
      }
      if (result instanceof Response) {
        return result;
      }
      if (isBodyInit(result)) {
        return new Response(result, {
          status: Status.Unauthorized,
          statusText: STATUS_TEXT[Status.Unauthorized],
        });
      }
      throw createHttpError(
        Status.Unauthorized,
        STATUS_TEXT[Status.Unauthorized],
      );
    },
    ...routeOptions,
  };
}

/** Intended to provide an immutable response handler for a route.
 *
 * The response value is used as the body of the response and cache control
 * headers are set to indicate that the value is immutable.
 *
 * ## Example
 *
 * ```ts
 * import { Router, immutable } from "jsr:@oak/acorn/";
 *
 * const router = new Router();
 *
 * router.all("/", immutable({ hello: "world" }));
 *
 * router.listen({ port: 8080 });
 * ```
 *
 * @param response the value which will be returned to the client as "immutable"
 * @param options Additional options which are used in conjunction with the
 *                route.
 * @returns a handler with options passed through
 */
export function immutable<
  R extends string,
  BodyType,
  Params extends RouteParameters<R>,
  ResponseType,
>(
  response: ResponseType,
  options?: RouteOptions<R, BodyType, Params>,
): RouteOptionsWithHandler<R, BodyType, Params, ResponseType> {
  const r: RouteOptionsWithHandler<R, BodyType, Params, ResponseType> = {
    async handler(ctx) {
      let finalResponse: Response;
      if (response instanceof Response) {
        finalResponse = response;
      } else if (options?.serializer?.toResponse) {
        finalResponse = await options.serializer.toResponse(
          response,
          ctx.params,
          ctx.request,
        );
      } else if (isBodyInit(response)) {
        const headers = new Headers();
        if (typeof response === "string") {
          if (isHtmlLike(response)) {
            headers.set("content-type", CONTENT_TYPE_HTML);
          } else if (isJsonLike(response)) {
            headers.set("content-type", CONTENT_TYPE_JSON);
          } else {
            headers.set("content-type", CONTENT_TYPE_TEXT);
          }
        } else {
          headers.set("content-type", CONTENT_TYPE_JSON);
        }
        finalResponse = new Response(response, { headers });
      } else {
        const bodyInit = options?.serializer?.stringify
          ? await options.serializer.stringify(response)
          : JSON.stringify(response);
        finalResponse = new Response(bodyInit, {
          headers: { "content-type": CONTENT_TYPE_JSON },
        });
      }
      finalResponse.headers.set(
        "cache-control",
        "public, max-age=604800, immutable",
      );
      return finalResponse;
    },
  };
  if (options?.deserializer) {
    r.deserializer = options.deserializer;
  }
  if (options?.errorHandler) {
    r.errorHandler = options.errorHandler.bind(options);
  }
  return r;
}
