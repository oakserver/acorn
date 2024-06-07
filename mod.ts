// Copyright 2022-2024 the oak authors. All rights reserved.

/**
 * Provides a router which specifically tailored for providing RESTful
 * endpoints.
 *
 * acorn works across [Deno runtime](https://deno.com/),
 * [Deno Deploy](https://deno.com/deploy), [Node.js](https://nodejs.org/),
 * [Bun](https://bun.sh/),
 * and [Cloudflare Workers](https://workers.cloudflare.com/).
 *
 * ## Installing
 *
 * @example Installing with Deno
 *
 * Add acorn to your project:
 *
 * ```
 * deno add @oak/acorn
 * ```
 *
 * @example Installing with Node.js or Cloudflare Workers
 *
 * Add acorn to your project with your preferred project manager.
 *
 * With npm:
 *
 * ```
 * npx jsr add @oak/acorn
 * ```
 *
 * With Yarn:
 *
 * ```
 * yarn dlx jsr add @oak/acorn
 * ```
 *
 * With pnpm:
 *
 * ```
 * pnpm dlx jsr add @oak/acorn
 * ```
 *
 * @example Install with Bun
 *
 * Add acorn to your project:
 *
 * ```
 * bunx jsr add @oak/acorn
 * ```
 *
 * ## Usage
 *
 * The main way of using acorn is to import the {@linkcode Router} into your
 * code and configure the router.
 *
 * If you are using Deno, Bun, or Node.js, after the router is configured,
 * invoke `.listen()` to start listening to requests.
 *
 * If you are using Cloudflare Workers, export the router as the default export
 * of the main module.
 *
 * @example Using with Deno, Bun and Node.js
 *
 * ```ts
 * import { Router } from "@oak/acorn";
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
 * @example Using with Cloudflare Workers
 *
 * ```ts
 * import { Router } from "@oak/acorn/router";
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
 * export default router;
 * ```
 *
 * @module
 */

export { type Context } from "./context.ts";
export { type SigningData, type SigningKey } from "./deps.ts";
export { auth, immutable } from "./handlers.ts";
export { default as DenoServer } from "./http_server_deno.ts";
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
  RouterRequestEvent,
  type RouterRequestEventInit,
} from "./router.ts";
export { type Deserializer, type KeyRing, type Serializer } from "./types.ts";
