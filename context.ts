// Copyright 2022 the oak authors. All rights reserved.

/**
 * Contains the class {@linkcode Context} which provides context for the request
 * and response to the request handler.
 *
 * @module
 */

import { type Cookies } from "./deps.ts";
import { type Deserializer } from "./types.d.ts";

interface ContextOptions<BodyType, Params extends Record<string, string>> {
  cookies: Cookies;
  deserializer?: Deserializer<BodyType, Params>;
  params: Params;
  request: Request;
}

/** An object that provides context for the associated request and response.
 * This is passed as the first argument to every route handler. */
export class Context<
  BodyType = unknown,
  Params extends Record<string, string> = Record<string, string>,
> {
  #body?: BodyType;
  #bodySet = false;
  #cookies: Cookies;
  #deserializer?: Deserializer<BodyType, Params>;
  #params: Params;
  #request: Request;
  #requestUrl?: URL;

  /** The instance of {@linkcode Cookies} that allows reading and setting of
   * cookies on the request and response. */
  get cookies(): Cookies {
    return this.#cookies;
  }

  /** Any {@linkcode Params} that have been parsed out of the URL requested
   * based on the URL pattern string provided to the `Route`. */
  get params(): Params {
    return this.#params;
  }

  /** The original {@linkcode Request} associated with this request. */
  get request(): Request {
    return this.#request;
  }

  /** Any search parameters associated with the request. */
  get searchParams(): Record<string, string> {
    if (!this.#requestUrl) {
      this.#requestUrl = new URL(this.#request.url);
    }
    return Object.fromEntries(this.#requestUrl.searchParams.entries());
  }

  constructor(
    { request, params, deserializer, cookies }: ContextOptions<
      BodyType,
      Params
    >,
  ) {
    this.#request = request;
    this.#params = params;
    this.#deserializer = deserializer;
    this.#cookies = cookies;
  }

  async body(): Promise<BodyType | undefined> {
    if (this.#bodySet) {
      return this.#body;
    }
    this.#bodySet = true;
    if (!this.#request.bodyUsed) {
      if (this.#deserializer) {
        const bodyString = await this.#request.text();
        this.#body = await this.#deserializer.parse(
          bodyString,
          this.#params,
          this.#request,
        );
      } else {
        this.#body = await this.#request.json();
      }
    }
    return this.#body;
  }
}
