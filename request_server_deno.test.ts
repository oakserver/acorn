// Copyright 2018-2024 the oak authors. All rights reserved.

import { assertEquals } from "@std/assert/equals";
import DenoServer from "./request_server_deno.ts";

Deno.test({
  name: "DenoServer should be closed initially",
  fn() {
    const { signal } = new AbortController();
    const server = new DenoServer({ signal });
    assertEquals(server.closed, true);
  },
});

// Add more tests here...
