export interface RequestEvent {
  readonly addr: Addr;
  readonly request: Request;
  // deno-lint-ignore no-explicit-any
  error(reason?: any): void;
  respond(response: Response | PromiseLike<Response>): void;
  upgrade?(options?: UpgradeWebSocketOptions): WebSocket;
}

export interface Addr {
  transport: "tcp" | "udp";
  hostname: string;
  port: number;
}

export interface Listener {
  addr: Addr;
}

export interface Server extends AsyncIterable<RequestEvent> {
  close(): Promise<void> | void;
  listen(): Promise<Listener> | Listener;
  [Symbol.asyncIterator](): AsyncIterableIterator<RequestEvent>;
}

export interface ServeOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  reusePort?: boolean;
  onError?: (error: unknown) => Response | Promise<Response>;
  onListen?: (params: { hostname: string; port: number }) => void;
}

export interface ServeTlsOptions extends ServeOptions {
  cert: string;
  key: string;
}

export interface ServerConstructor {
  new (options: Omit<ServeOptions | ServeTlsOptions, "signal">): Server;
  prototype: Server;
}

export interface Destroyable {
  destroy(): void;
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
