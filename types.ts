// Copyright 2022-2024 the oak authors. All rights reserved.

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
