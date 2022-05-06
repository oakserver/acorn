import { type Deserializer } from "./types.d.ts";

export class Context<
  BodyType = unknown,
  Params extends Record<string, string> = Record<string, string>,
> {
  #body?: BodyType;
  #bodySet = false;
  #deserializer?: Deserializer<BodyType, Params>;
  #params: Params;
  #request: Request;

  get params(): Params {
    return this.#params;
  }

  get request(): Request {
    return this.#request;
  }

  constructor(
    request: Request,
    params: Params,
    deserializer?: Deserializer<BodyType, Params>,
  ) {
    this.#request = request;
    this.#params = params;
    this.#deserializer = deserializer;
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
