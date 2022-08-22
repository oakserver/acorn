// Copyright 2022 the oak authors. All rights reserved.

/**
 * Provides a router which specifically tailored for providing RESTful
 * endpoints.
 *
 * ## Example
 *
 * ```ts
 * import { Router } from "https://deno.land/x/acorn/mod.ts";
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

export { type Context } from "./context.ts";
export { type KeyRing, type SigningData, type SigningKey } from "./deps.ts";
export { auth, immutable } from "./handlers.ts";
export { NativeHttpServer } from "./http_server_native.ts";
export { FlashHttpServer, hasFlash } from "./http_server_flash.ts";
export {
  HandledEvent,
  NotFoundEvent,
  type RouteHandler,
  type RouteOptions,
  type RouteOptionsWithHandler,
  type RouteParameters,
  Router,
  RouterErrorEvent,
  type RouteResponse,
  RouterListenEvent,
  type RouterOptions,
} from "./router.ts";
export { type Deserializer, type Serializer } from "./types.d.ts";
