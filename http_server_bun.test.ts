// Copyright 2018-2024 the oak authors. All rights reserved. MIT license.

// deno-lint-ignore-file no-explicit-any

import { assert, assertEquals } from "./deps_test.ts";

import Server from "./http_server_bun.ts";

interface SocketAddress {
  address: string;
  port: number;
  family: "IPv4" | "IPv6";
}

let currentServer: MockBunServer | undefined;
let requests: Request[] = [];

class MockBunServer {
  stoppedCount = 0;
  fetch: (
    req: Request,
    server: this,
  ) => Response | Promise<Response>;
  responses: Response[] = [];
  runPromise: Promise<void>;

  development: boolean;
  hostname: string;
  port: number;
  pendingRequests = 0;

  async #run() {
    for (const req of requests) {
      const res = await this.fetch(req, this);
      this.responses.push(res);
    }
  }

  constructor(
    { fetch, hostname, port, development }: {
      fetch: (
        req: Request,
        server: unknown,
      ) => Response | Promise<Response>;
      hostname?: string;
      port?: number;
      development?: boolean;
      error?: (error: Error) => Response | Promise<Response>;
      tls?: {
        key?: string;
        cert?: string;
      };
    },
  ) {
    this.fetch = fetch;
    this.development = development ?? false;
    this.hostname = hostname ?? "localhost";
    this.port = port ?? 567890;
    currentServer = this;
    this.runPromise = this.#run();
  }

  requestIP(_req: Request): SocketAddress | null {
    return { address: "127.0.0.0", port: 567890, family: "IPv4" };
  }

  stop(): void {
    this.stoppedCount++;
  }
}

function setup(reqs?: Request[]) {
  if (reqs) {
    requests = reqs;
  }
  (globalThis as any)["Bun"] = {
    serve(options: any) {
      return new MockBunServer(options);
    },
  };
}

function teardown() {
  delete (globalThis as any)["Bun"];
  currentServer = undefined;
}

Deno.test({
  name: "bun server can listen",
  async fn() {
    setup();
    const server = new Server({ port: 8080 });
    const listener = await server.listen();
    assertEquals(listener, {
      addr: { hostname: "localhost", port: 8080, transport: "tcp" },
    });
    assert(currentServer);
    assertEquals(currentServer.stoppedCount, 0);
    await server.close();
    assertEquals(currentServer.stoppedCount, 1);
    teardown();
  },
});

Deno.test({
  name: "bun server can process requests",
  async fn() {
    setup([new Request(new URL("http://localhost:8080/"))]);
    const server = new Server({ port: 8080 });
    const listener = await server.listen();
    assertEquals(listener, {
      addr: { hostname: "localhost", port: 8080, transport: "tcp" },
    });
    assert(currentServer);
    // deno-lint-ignore no-async-promise-executor
    const promise = new Promise<void>(async (resolve) => {
      for await (const req of server) {
        assert(req.request);
        assertEquals(req.request.url, "http://localhost:8080/");
        req.respond(new Response("hello world"));
      }
      resolve();
    });
    await server.close();
    await promise;
    assertEquals(currentServer.stoppedCount, 1);
    assertEquals(currentServer.responses.length, 1);
    teardown();
  },
});
