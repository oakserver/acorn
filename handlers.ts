// Copyright 2022 the oak authors. All rights reserved.

/** Contains handler factory functions which simplify some common use cases.
 *
 * @module
 */

import {
  type RouteOptions,
  type RouteOptionsWithHandler,
  type RouteParameters,
} from "./router.ts";
import { CONTENT_TYPE_JSON, isBodyInit } from "./util.ts";

/** Intended to provide an immutable response handler for a route.
 *
 * The response value is used as the body of the response and cache control
 * headers are set to indicate that the value is immutable.
 *
 * ## Example
 *
 * ```ts
 * import { Router, immutable } from "https://deno.land/x/acorn/mod.ts";
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
        finalResponse = new Response(response, {
          headers: { "content-type": CONTENT_TYPE_JSON },
        });
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
