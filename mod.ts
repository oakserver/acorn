// Copyright 2018-2024 the oak authors. All rights reserved.

/**
 * acorn is a focused framework for creating RESTful JSON services across
 * various JavaScript and TypeScript runtime environments including Deno
 * runtime, Deno Deploy, Node.js, Bun and Cloudflare Workers.
 *
 * It focuses on providing a router which handles inbound requests and makes it
 * trivial to respond to those requests with JSON. It also provides several
 * other features which make creating API servers with acorn production ready.
 *
 * ## Basic usage
 *
 * acorn is designed to work on many different JavaScript and TypeScript
 * runtimes, including Deno, Node.js, Bun, and Cloudflare Workers. Basic usage
 * requires installing acorn to your project and then creating a router to
 * handle requests.
 *
 * ### Installing for Deno
 *
 * To install acorn for Deno, you can install it via the Deno runtime CLI:
 *
 * ```
 * deno add @oak/acorn
 * ```
 *
 * ### Installing for Node.js or Cloudflare Workers
 *
 * To install acorn for Node.js or Cloudflare Workers, you can install it via
 * your preferred package manager.
 *
 * #### npm
 *
 * ```
 * npx jsr add @oak/acorn
 * ```
 *
 * #### yarn
 *
 * ```
 * yarn dlx jsr add @oak/acorn
 * ```
 *
 * #### pnpm
 *
 * ```
 * pnpm dlx jsr add @oak/acorn
 * ```
 *
 * ### Installing for Bun
 *
 * To install acorn for Bun, you can install it via the Bun runtime CLI:
 *
 * ```
 * bunx jsr add @oak/acorn
 * ```
 *
 * ### Usage with Deno, Node.js, and Bun
 *
 * Basic usage of acorn for Deno, Node.js, and Bun is the same. You import the
 * {@linkcode Router}, create an instance of it, register routes on the router,
 * and then called the `.listen()` method on the router to start listening for
 * requests:
 *
 * ```ts
 * import { Router } from "@oak/acorn";
 *
 * const router = new Router();
 * router.get("/", () => ({ hello: "world" }));
 * router.listen({ port: 3000 });
 * ```
 *
 * ### Usage with Cloudflare Workers
 *
 * Basic usage for Cloudflare Workers requires exporting a fetch handler which
 * is integrated into the router, and therefore you export the router as the
 * default export of the module:
 *
 * ```ts
 * import { Router } from "@oak/acorn";
 *
 * const router = new Router();
 * router.get("/", () => ({ hello: "world" }));
 * export default router;
 * ```
 *
 * ## Router
 *
 * The {@linkcode Router} is the core of acorn and is responsible for handling
 * inbound requests and routing them to the appropriate handler. The router
 * provides methods for registering routes for different HTTP methods and
 * handling requests for those routes.
 *
 * ## Context
 *
 * The {@linkcode Context} is the object passed to route handlers and provides
 * information about the request and runtime environment. The context object
 * provides access to the {@linkcode Request} object as well as other useful
 * properties and methods for handling requests.
 *
 * ### `addr`
 *
 * The network address of the originator of the request as presented to the
 * runtime environment.
 *
 * ### `cookies`
 *
 * The cookies object which can be used to get and set cookies for the request.
 * If encryptions keys are provided to the router, the cookies will be
 * cryptographically verified and signed to ensure their integrity.
 *
 * ### `env`
 *
 * The environment variables available to the runtime environment. This assists
 * in providing access to the environment variables for the runtime environment
 * without having to code specifically for each runtime environment.
 *
 * ### `id`
 *
 * A unique identifier for the request event. This can be useful for logging
 * and tracking requests.
 *
 * ### `params`
 *
 * The parameters extracted from the URL path by the router.
 *
 * ### `request`
 *
 * The Fetch API standard {@linkcode Request} object which should be handled.
 *
 * ### `responseHeaders`
 *
 * The headers that will be sent with the response. This will be merged with
 * other headers to finalize the reponse.
 *
 * ### `url`
 *
 * The URL object representing the URL of the request.
 *
 * ### `userAgent`
 *
 * A parsed version of the `User-Agent` header from the request. This can be
 * used to determine the type of client making the request.
 *
 * ### `body()`
 *
 * A method which returns a promise that resolves with the body of the request
 * assumed to be JSON. If the body is not JSON, an error will be thrown. If a
 * body schema is provided to the route, the body will be validated against that
 * schema before being returned.
 *
 * ### `conflict()`
 *
 * A method which throws a `409 Conflict` error and takes an optional message
 * and optional cause.
 *
 * ### `created()`
 *
 * A method which returns a {@linkcode Response} with a `201 Created` status
 * code. The method takes the body of the response and an optional object with
 * options for the response. If a `location` property is provided in the
 * options, the response will include a `Location` header with the value of the
 * location.
 *
 * If `locationParams` is provided in the options, the location will be
 * interpolated with the parameters provided.
 *
 * ### `notFound()`
 *
 * A method which throws a `404 Not Found` error and takes an optional message
 * and optional cause.
 *
 * ### `queryParams()`
 *
 * A method which returns a promise that resolves with the query parameters of
 * the request. If a query parameter schema is provided to the route, the query
 * parameters will be validated against that schema before being returned.
 *
 * ### `redirect()`
 *
 * A method which sends a redirect response to the client. The method takes a
 * location and an optional init object with options for the response. If the
 * location is a path with parameters, the `params` object can be provided to
 * interpolate the parameters into the URL.
 *
 * ### `throw()`
 *
 * A method which can be used to throw an HTTP error which will be caught by the
 * router and handled appropriately. The method takes a status code and an
 * optional message which will be sent to the client.
 *
 * ### `created()`
 *
 * A method which returns a {@linkcode Response} with a `201 Created` status
 * code. The method takes the body of the response and an optional object with
 * options for the response.
 *
 * This is an appropriate response when a `POST` request is made to a resource
 * collection and the resource is created successfully. The options should be
 * included with a `location` property set to the URL of the created resource.
 * The `params` property can be used to provide parameters to the URL.
 * For example if `location` is `/books/:id` and `params` is `{ id: 1 }`
 * the URL will be `/books/1`.
 *
 * ### `conflict()`
 *
 * A method which throws a `409 Conflict` error and takes an optional message
 * and optional cause.
 *
 * This is an appropriate response when a `PUT` request is made to a resource
 * that cannot be updated because it is in a state that conflicts with the
 * request.
 *
 * ### `sendEvents()`
 *
 * A method which starts sending server-sent events to the client. This method
 * returns a {@linkcode ServerSentEventTarget} which can be used to dispatch
 * events to the client.
 *
 * ### `upgrade()`
 *
 * A method which can be used to upgrade the request to a {@linkcode WebSocket}
 * connection. When the request is upgraded, the request will be handled as a
 * web socket connection and the method will return a {@linkcode WebSocket}
 * which can be used to communicate with the client.
 *
 * **Note:** This method is only available in the Deno runtime and Deno Deploy
 * currently. If you call this method in a different runtime, an error will be
 * thrown.
 *
 * ## Router Handlers
 *
 * The {@linkcode RouteHandler} is the function which is called when a route is
 * matched by the router. The handler is passed the {@linkcode Context} object
 * and is expected to return a response. The response can be a plain object
 * which will be serialized to JSON, a {@linkcode Response} object. The handler
 * can also return `undefined` if the handler wishes to return a no content
 * response. The handler can also return a promise which resolves with any of
 * the above.
 *
 * ### Registering Routes
 *
 * Routes can be registered on the router using the various methods provided by
 * the router. The most common methods are `get()`, `post()`, `put()`,
 * `patch()`, and `delete()`. In addition `options()` and `head()` are provided.
 *
 * The methods take a path pattern and a handler function, and optionally an
 * object with options for the route ({@linkcode RouteInit}). The path pattern
 * is a string which can include parameters and pattern matching syntax. The
 * handler function is called when the route is matched and is passed the
 * context object.
 *
 * For example, to register a route which responds to a `GET` request:
 *
 * ```ts
 * router.get("/", () => ({ hello: "world" }));
 * ```
 *
 * The methods also accept a {@linkcode RouteDescriptor} object, or a path along
 * with a set of options ({@linkcode RouteInitWithHandler}) which includes the
 * handler function.
 *
 * For example, to register a route which responds to a `POST` request:
 *
 * ```ts
 * router.post("/", {
 *   handler: () => ({ hello: "world" }),
 * });
 * ```
 *
 * And for a route which responds to a `PUT` request with the full descriptor:
 *
 * ```ts
 * router.put({
 *   path: "/",
 *   handler: () => ({ hello: "world" }),
 * });
 * ```
 *
 * ### Hooks
 *
 * The router provides hooks which can be used to get information about the
 * routing process and to potentially modify the response. The hooks are
 * provided when creating the router and are called at various points in the
 * routing process.
 *
 * #### `onRequest()`
 *
 * The `onRequest` hook is called when a request is received by the router. The
 * {@linkcode RequestEvent} object is provided to the hook and can be used to
 * inspect the request.
 *
 * The `onRequest` could invoke the `.respond()` method on the `RequestEvent`
 * but this should be avoided.
 *
 * #### `onNotFound()`
 *
 * As a request is being handled by the router, if no route is matched or the
 * route handler returns a `404 Not Found` response the `onNotFound` hook is
 * called. There is a details object which provides the {@linkcode RequestEvent}
 * being handled, any {@linkcode Response} that has been provided (but not yet
 * sent to the client) and the {@linkcode Route} that was matched, if any.
 *
 * The `onNotFound` hook can return a response to be sent to the client. If the
 * hook returns `undefined`, the router will continue processing the request.
 *
 * #### `onHandled()`
 *
 * After a request has been processed by the router and a response has been
 * sent to the client, the `onHandled` hook is called. The hook is provided with
 * a set of details which include the {@linkcode RequestEvent}, the
 * {@linkcode Response}, the {@linkcode Route} that was matched, and the time in
 * milliseconds that the request took to process.
 *
 * #### `onError()`
 *
 * If an unhandled error occurs in a handler, the `onError` hook is called. The
 * hook is provided with a set of details which include the
 * {@linkcode RequestEvent}, the {@linkcode Response} that was provided, the
 * error that occurred, and the {@linkcode Route} that was matched, if any.
 *
 * ## Route Parameters
 *
 * The router can extract parameters from the URL path and provide them to the
 * route handler. The parameters are extracted from the URL path based on the
 * pattern matching syntax provided by the
 * [`path-to-regexp`](https://github.com/pillarjs/path-to-regexp) library. The
 * parameters are provided to the handler as an object with the parameter names
 * as the keys and the values as the values.
 *
 * For example, to register a route which extracts a parameter from the URL
 * path:
 *
 * ```ts
 * router.get("/:name", (ctx) => {
 *   return { hello: ctx.params.name };
 * });
 * ```
 *
 * ## Status Handlers
 *
 * acorn provides a mechanism for observing or modifying the response to a
 * request based on the status of the response. This is done using status
 * handlers which are registered on the router. The status handlers are called
 * when a response is being sent to the client and the status of the response
 * matches the status or status range provided to the handler.
 *
 * This is intended to be able to provide consistent and customized responses to
 * status codes across all routes in the router. For example, you could provide
 * a status handler to handle all `404 Not Found` responses and provide a
 * consistent response to the client:
 *
 * ```ts
 * import { Router } from "@oak/acorn";
 * import { Status, STATUS_TEXT } from "@oak/commons/status";
 *
 * const router = new Router();
 *
 * router.on(Status.NotFound, () => {
 *   return Response.json(
 *     { error: "Not Found" },
 *     { status: Status.NotFound, statusText: STATUS_TEXT[Status.NotFound],
 *   });
 * });
 * ```
 *
 * ## Schema Validation
 *
 * acorn integrates the [Valibot](https://valibot.dev/) library to provide
 * schema validation for query strings, request bodies, and responses. This
 * allows you to define the shape of the data you expect to receive and send
 * and have it validated automatically.
 *
 * You can provide a schema to the route when registering it on the router. The
 * schema is an object which describes the shape of the data you expect to
 * receive or send. The schema is defined using the Valibot schema definition
 * language.
 *
 * For example, to define a schema for a request body:
 *
 * ```ts
 * import { Router, v } from "@oak/acorn";
 *
 * const router = new Router();
 *
 * router.post("/", () => ({ hello: "world" }), {
 *  schema: {
 *    body: v.object({
 *      name: v.string(),
 *    }),
 *   },
 * });
 * ```
 *
 * This ensures that the request body is an object with a `name` property which
 * is a string. If the request body does not match this schema, an error will be
 * thrown and the request will not be processed and a `Bad Request` response
 * will be sent to the client.
 *
 * You can provide an optional invalid handler to the schema which will be
 * called when the schema validation fails. This allows you to provide a custom
 * response to the client when the request does not match the schema.
 *
 * ## RESTful JSON Services
 *
 * acorn is designed to make it easy to create RESTful JSON services. The router
 * provides a simple and expressive way to define routes and has several
 * features which make it easy to create production ready services.
 *
 * ### HTTP Errors
 *
 * acorn provides a mechanism for throwing HTTP errors from route handlers. The
 * `throw()` method on the context object can be used to throw an HTTP error.
 * HTTP errors are caught by the router and handled appropriately. The router
 * will send a response to the client with the status code and message provided
 * to the `throw()` method with the body of the response respecting the content
 * negotiation headers provided by the client.
 *
 * ### No Content Responses
 *
 * If a handler returns `undefined`, the router will send a `204 No Content`
 * response to the client. This is useful when a request is successful but there
 * is no content to return to the client.
 *
 * No content responses are appropriate for `PUT` or `PATCH` requests that are
 * successful but you do not want to return the updated resource to the client.
 *
 * ### Created Responses
 *
 * The `created()` method on the context object can be used to send a `201
 * Created` response to the client. This is appropriate when a `POST` request is
 * made to a resource collection and the resource is created successfully. The
 * method takes the body of the response and an optional object with options for
 * the response.
 *
 * The options should be included with a `location` property set to the URL of
 * the created resource. The `params` property can be used to provide parameters
 * to the URL. For example if `location` is `/books/:id` and `params` is
 * `{ id: 1 }` the URL will be `/books/1`.
 *
 * ### Conflict Responses
 *
 * The `conflict()` method on the context object can be used to throw a `409
 * Conflict` error. This is appropriate when a `PUT` request is made to a
 * resource that cannot be updated because it is in a state that conflicts with
 * the request.
 *
 * ### Redirect Responses
 *
 * If you need to redirect the client to a different URL, you can use the
 * `redirect()` method on the context object. This method takes a URL and an
 * optional status code and will send a redirect response to the client.
 *
 * In addition, if the `location` is a path with parameters, you can provide the
 * `params` object to the `redirect()` method which will be used to populate the
 * parameters in the URL.
 *
 * ## Logging
 *
 * acorn integrates the [LogTape](https://jsr.io/@logtape/logtape) library to
 * provide logging capabilities for the router and routes.
 *
 * To enable logging, you can provide a {@linkcode LoggerOptions} object on the
 * property `logger` to the router when creating it:
 *
 * ```ts
 * const router = new Router({
 *   logger: {
 *     console: { level: "debug" },
 *   },
 * });
 * ```
 *
 * Alternatively, you can simply set the `logger` property to `true` to log
 * events at the `"WARN"` level to the console:
 *
 * ```ts
 * const router = new Router({
 *   logger: true,
 * });
 * ```
 *
 * @module
 */

/**
 * The re-export of the [valibot](https://valibot.dev/guides/introduction/)
 * library which is used for schema validation in acorn.
 */
export * as v from "@valibot/valibot";
export type { ServerSentEventTarget } from "@oak/commons/server_sent_event";
export {
  type ClientErrorStatus,
  type ErrorStatus,
  type InformationalStatus,
  type RedirectStatus,
  type ServerErrorStatus,
  Status,
  type SuccessfulStatus,
} from "@oak/commons/status";

export type { Context } from "./context.ts";
export type { LoggerOptions } from "./logger.ts";
export type { PathRoute, RouteHandler, RouteOptions } from "./route.ts";
export {
  type ErrorDetails,
  type HandledDetails,
  type NotFoundDetails,
  type RouteDescriptor,
  type RouteDescriptorWithMethod,
  type RouteInit,
  type RouteInitWithHandler,
  Router,
  type RouterOptions,
} from "./router.ts";
export type {
  StatusHandler,
  StatusRange,
  StatusRoute,
  StatusRouteDescriptor,
} from "./status_route.ts";
export type {
  CloudflareExecutionContext,
  CloudflareFetchHandler,
  RequestEvent,
  Route,
  RouteParameters,
} from "./types.ts";
