export type Deserializer<Type, Params> = {
  parse(value: string, params: Params, request: Request): Promise<Type> | Type;
};

export type Serializer = {
  stringify(value: unknown): string;
};

export interface RequestEvent {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): Promise<void>;
}

export interface Listener {
  addr: { hostname: string; port: number };
}

export interface Server extends AsyncIterable<RequestEvent> {
  close(): void;
  listen(): Listener;
  [Symbol.asyncIterator](): AsyncIterableIterator<RequestEvent>;
}

export interface ServerConstructor {
  new (
    errorTarget: EventTarget,
    options: Deno.ListenOptions | Deno.ListenTlsOptions,
  ): Server;
  prototype: Server;
}

export interface Destroyable {
  destroy(): void;
}

export interface HttpConn extends AsyncIterable<RequestEvent> {
  readonly rid: number;
  nextRequest(): Promise<RequestEvent | null>;
  close(): void;
}
