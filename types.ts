// Copyright 2022-2023 the oak authors. All rights reserved.

import type { SigningData } from "./deps.ts";

/** An abstract interface for cryptographic key rings that can be used to sign
 * cookies.
 *
 * The Deno std library
 * [KeyStack](https://deno.land/std/crypto/keystack.ts?s=KeyStack) is an example
 * of an implementation. */
export interface KeyRing {
  sign(data: SigningData): Promise<string>;
  verify(data: SigningData, digest: string): Promise<boolean>;
  indexOf(data: SigningData, digest: string): Promise<number>;
}

/** The interface to allow handling of request bodies in a structured way. */
export interface Deserializer<Type, Params extends Record<string, string>> {
  /** Given the request body as a string along with any parameters parsed when
   * matching the route and the original {@linkcode Request} return a value to
   * represent the body which will be provided to the route handler.
   *
   * This is intended to allow validation and hydration of objects to be
   * provided to route handlers.
   *
   * @param value the value of the request body as a string.
   * @param params any parameters that were parsed from the route when the route
   *               was matched.
   * @param request the original request that was matched to the route.
   */
  parse(value: string, params: Params, request: Request): Promise<Type> | Type;
}

/** An interface for handling the responses from a route handler in a structured
 * way. */
export interface Serializer<Params extends Record<string, string>> {
  /** Convert a value returned from a route handler into a JSON string, either
   * synchronously or asynchronously.
   *
   * If the route handler returns a {@linkcode Response} or {@linkcode BodyInit}
   * this method will not be called.
   *
   * If a `.toResponse()` is provided, this method will not be called.
   *
   * @param value This is the value returned from the route handler. */
  stringify?(value: unknown): string | Promise<string>;

  /** A method that takes a value returned from a response handler, along with
   * any parameters parsed when matching the route and the original request,
   * returning a full {@linkcode Response} which will be used to respond to the
   * request.
   *
   * If the route handler returns a `Response` or {@linkcode BodyInit} this
   * method will not be called.
   *
   * If this method is provided, the `.stringify()` method will not be called,
   * even if it exists.
   *
   * @param value This is the value returned from the route handler.
   * @param params Any parameters that were parsed from the route when the route
   *               was matched.
   * @param request The original request that triggered the route to be matched.
   */
  toResponse?(
    value: unknown,
    params: Params,
    request: Request,
  ): Response | Promise<Response>;
}

export interface RequestEvent {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): Promise<void>;
}

export interface Addr {
  transport: "tcp" | "udp";
  hostname: string;
  port: number;
}

export interface Listener {
  addr: Addr;
}

export interface Server extends AsyncIterable<[RequestEvent, Addr]> {
  close(): Promise<void> | void;
  listen(): Promise<Listener> | Listener;
  [Symbol.asyncIterator](): AsyncIterableIterator<[RequestEvent, Addr]>;
}

export interface ListenOptions {
  port: number;
  hostname?: string;
}

export interface ListenTlsOptions extends ListenOptions {
  key?: string;
  cert?: string;
}

export interface ServerConstructor {
  new (
    errorTarget: EventTarget,
    options: ListenOptions | ListenTlsOptions,
  ): Server;
  prototype: Server;
}

export type ServeHandler = (
  request: Request,
) => Response | Promise<Response> | void | Promise<void>;

export interface ServeInit {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onError?: (error: unknown) => Response | Promise<Response>;
  onListen?: (params: { hostname: string; port: number }) => void;
}

export interface ServeTlsInit extends ServeInit {
  cert: string;
  key: string;
}

export interface Destroyable {
  destroy(): void;
}

export interface HttpConn extends AsyncIterable<RequestEvent> {
  readonly rid: number;
  nextRequest(): Promise<RequestEvent | null>;
  close(): void;
}

export interface UpgradeWebSocketOptions {
  /** Sets the `.protocol` property on the client side web socket to the
   * value provided here, which should be one of the strings specified in the
   * `protocols` parameter when requesting the web socket. This is intended
   * for clients and servers to specify sub-protocols to use to communicate to
   * each other. */
  protocol?: string;
  /** If the client does not respond to this frame with a
   * `pong` within the timeout specified, the connection is deemed
   * unhealthy and is closed. The `close` and `error` event will be emitted.
   *
   * The default is 120 seconds. Set to `0` to disable timeouts. */
  idleTimeout?: number;
}

export interface WebSocketUpgrade {
  /** The response object that represents the HTTP response to the client,
   * which should be used to the {@linkcode RequestEvent} `.respondWith()` for
   * the upgrade to be successful. */
  response: Response;
  /** The {@linkcode WebSocket} interface to communicate to the client via a
   * web socket. */
  socket: WebSocket;
}
