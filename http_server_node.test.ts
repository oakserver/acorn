// Copyright 2018-2024 the oak authors. All rights reserved. MIT license.

import { assertEquals } from "./deps_test.ts";

import Server from "./http_server_node.ts";

Deno.test({
  name: "node server can listen",
  async fn() {
    const server = new Server({ port: 8080 });
    const listener = await server.listen();
    assertEquals(listener, {
      addr: { hostname: "localhost", port: 8080, transport: "tcp" },
    });
    await server.close();
  },
});

Deno.test({
  name: "node server can process requests",
  async fn() {
    const server = new Server({ port: 8080, hostname: "localhost" });
    await server.listen();
    const promise = fetch("http://localhost:8080/");
    for await (const req of server) {
      req.respond(Promise.resolve(new Response("hello world")));
      break;
    }
    const res = await promise;
    assertEquals(await res.text(), "hello world");
    await server.close();
  },
});
