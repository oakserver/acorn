// Copyright 2018-2024 the oak authors. All rights reserved.

import hyperid from "hyperid";

import type {
  Addr,
  CloudflareExecutionContext,
  RequestEvent,
} from "./types.ts";
import { createPromiseWithResolvers } from "./utils.ts";

const instance = hyperid({ urlSafe: true });

export class CloudflareWorkerRequestEvent<
  Env extends Record<string, string> = Record<string, string>,
> implements RequestEvent<Env> {
  #addr?: Addr;
  #env: Env;
  #id = instance();
  //deno-lint-ignore no-explicit-any
  #reject: (reason?: any) => void;
  #request: Request;
  #resolve: (value: Response | PromiseLike<Response>) => void;
  #responded = false;
  #response: Promise<Response>;
  #url: URL;

  get addr(): Addr {
    if (!this.#addr) {
      const hostname = this.#request.headers.get("CF-Connecting-IP") ??
        "localhost";
      this.#addr = { hostname, port: 80, transport: "tcp" };
    }
    return this.#addr;
  }

  get env(): Env {
    return this.#env;
  }

  get id(): string {
    return this.#id;
  }

  get request(): Request {
    return this.#request;
  }

  get responded(): boolean {
    return this.#responded;
  }

  get response(): Promise<Response> {
    return this.#response;
  }

  get url(): URL {
    return this.#url;
  }

  constructor(request: Request, env: Env, _ctx: CloudflareExecutionContext) {
    this.#request = request;
    this.#env = env;
    const { resolve, reject, promise } = createPromiseWithResolvers<Response>();
    this.#resolve = resolve;
    this.#reject = reject;
    this.#response = promise;
    this.#url = URL.parse(request.url, "http://localhost/") ??
      new URL("http://localhost/");
  }

  //deno-lint-ignore no-explicit-any
  error(reason?: any): void {
    if (this.#responded) {
      throw new Error("Request already responded to.");
    }
    this.#responded = true;
    this.#reject(reason);
  }

  respond(response: Response): void {
    if (this.#responded) {
      throw new Error("Request already responded to.");
    }
    this.#responded = true;
    this.#resolve(response);
  }

  [Symbol.for("Deno.customInspect")](
    inspect: (value: unknown) => string,
  ): string {
    return `${this.constructor.name} ${
      inspect({
        addr: this.#addr,
        env: this.#env,
        id: this.#id,
        request: this.#request,
        responded: this.#responded,
        response: this.#response,
        url: this.#url,
      })
    }`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](
    depth: number,
    // deno-lint-ignore no-explicit-any
    options: any,
    inspect: (value: unknown, options?: unknown) => string,
    // deno-lint-ignore no-explicit-any
  ): any {
    if (depth < 0) {
      return options.stylize(`[${this.constructor.name}]`, "special");
    }

    const newOptions = Object.assign({}, options, {
      depth: options.depth === null ? null : options.depth - 1,
    });
    return `${options.stylize(this.constructor.name, "special")} ${
      inspect({
        addr: this.#addr,
        env: this.#env,
        id: this.#id,
        request: this.#request,
        responded: this.#responded,
        response: this.#response,
        url: this.#url,
      }, newOptions)
    }`;
  }
}
