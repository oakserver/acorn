// Copyright 2022-2024 the oak authors. All rights reserved.

/**
 * Contains the class {@linkcode Context} which provides context for the request
 * and response to the request handler.
 *
 * @module
 */

import { createHttpError, SecureCookieMap, Status, UserAgent } from "./deps.ts";
import type { Deserializer, KeyRing } from "./types.ts";
import type {
  Addr,
  RequestEvent,
  UpgradeWebSocketOptions,
} from "./types_internal.ts";

interface ContextOptions<BodyType, Params extends Record<string, string>> {
  deserializer?: Deserializer<BodyType, Params>;
  headers: Headers;
  keys?: KeyRing;
  params?: Params;
  secure?: boolean;
  requestEvent: RequestEvent;
}

/** An object that provides context for the associated request and response.
 * This is passed as the first argument to every route handler. */
export class Context<
  BodyType = unknown,
  Params extends Record<string, string> = Record<string, string>,
> {
  #body?: BodyType;
  #bodySet = false;
  #cookies: SecureCookieMap;
  #deserializer?: Deserializer<BodyType, Params>;
  #params: Params;
  #requestEvent: RequestEvent;
  #responded = false;
  #searchParams?: Record<string, string>;
  #url?: URL;
  #userAgent: UserAgent;

  /** The instance of {@linkcode Cookies} that allows reading and setting of
   * cookies on the request and response. */
  get cookies(): SecureCookieMap {
    return this.#cookies;
  }

  /** Any {@linkcode Params} that have been parsed out of the URL requested
   * based on the URL pattern string provided to the `Route`. */
  get params(): Params {
    return this.#params;
  }

  /** The original {@linkcode Request} associated with this request. */
  get request(): Request {
    return this.#requestEvent.request;
  }

  /**
   * Indicates if the response has already been responded to, like when
   * upgrading to a websocket.
   */
  get responded(): boolean {
    return this.#responded;
  }

  /** The address this request. */
  get addr(): Addr {
    return this.#requestEvent.addr;
  }

  /** Any search parameters associated with the request. */
  get searchParams(): Record<string, string> {
    if (!this.#searchParams) {
      this.#searchParams = Object.fromEntries(
        this.url().searchParams.entries(),
      );
    }
    return this.#searchParams;
  }

  /**
   * Information about the parsed user agent string associated with the
   * {@linkcode Request} if available.
   *
   * See:
   * [std/http/user_agent#UserAgent](https://deno.land/std/http/user_agent.ts?s=UserAgent)
   * for more information.
   */
  get userAgent(): UserAgent {
    return this.#userAgent;
  }

  constructor(
    { requestEvent, keys, headers, secure, params, deserializer }:
      ContextOptions<
        BodyType,
        Params
      >,
  ) {
    this.#requestEvent = requestEvent;
    this.#params = params ?? {} as Params;
    this.#deserializer = deserializer;
    this.#cookies = new SecureCookieMap(requestEvent.request, {
      keys,
      response: headers,
      secure,
    });
    this.#userAgent = new UserAgent(
      requestEvent.request.headers.get("user-agent"),
    );
  }

  /** A convenience method to deal with decoding a JSON string body. It can be
   * used with an optional {@linkcode Deserializer} which can do advanced
   * decoding of the body, or it will attempted to be decoded from the JSON
   * string. */
  async body(): Promise<BodyType | undefined> {
    if (this.#bodySet) {
      return this.#body;
    }
    this.#bodySet = true;
    if (!this.#requestEvent.request.bodyUsed) {
      if (this.#deserializer) {
        const bodyString = await this.#requestEvent.request.text();
        this.#body = await this.#deserializer.parse(
          bodyString,
          this.#params,
          this.#requestEvent.request,
        );
      } else {
        try {
          this.#body = await this.#requestEvent.request.json();
        } catch {
          this.#body = undefined;
        }
      }
    }
    return this.#body;
  }

  /** Attempt to upgrade the request to a web socket, returning the socket and
   * the response to be returned.
   *
   * ## Example
   *
   * ```ts
   * import { Router } from "https://deno.land/x/acorn/mod.ts";
   *
   * const router = new Router();
   *
   * router.get("/ws", (ctx) => {
   *   const { socket, response } = ctx.upgrade();
   *   // Perform actions with the socket.
   *   return response;
   * });
   *
   * router.listen({ port: 8000 });
   * ```
   *
   * @param options
   * @returns
   */
  upgrade(options?: UpgradeWebSocketOptions): WebSocket {
    if (!this.#requestEvent.upgrade) {
      throw createHttpError(
        Status.ServiceUnavailable,
        "Web sockets not supported.",
      );
    }
    this.#responded = true;
    return this.#requestEvent.upgrade(options);
  }

  /** Returns the request URL as a parsed {@linkcode URL} object. */
  url(): URL {
    if (!this.#url) {
      this.#url = new URL(this.#requestEvent.request.url);
    }
    return this.#url;
  }
}
