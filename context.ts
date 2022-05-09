// Copyright 2022 the oak authors. All rights reserved.

import { type Cookies } from "./deps.ts";
import { type Deserializer } from "./types.d.ts";

interface ContextOptions<BodyType, Params extends Record<string, string>> {
  cookies: Cookies;
  deserializer?: Deserializer<BodyType, Params>;
  params: Params;
  request: Request;
}

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

  get cookies(): Cookies {
    return this.#cookies;
  }

  get params(): Params {
    return this.#params;
  }

  get request(): Request {
    return this.#request;
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
