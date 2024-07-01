// Copyright 2018-2024 the oak authors. All rights reserved.

import * as colors from "jsr:@std/fmt@0.225/colors";
import { KeyStack } from "jsr:@std/crypto@0.224/unstable-keystack";
import * as v from "@valibot/valibot";

import { Router } from "../router.ts";
import { Status, STATUS_TEXT } from "jsr:@oak/commons@^0.12/status";

const keys = new KeyStack(["super secret"]);

const router = new Router({
  keys,
  logger: { console: { level: "debug" } },
});

router.get("/", async (ctx) => {
  let count = parseInt((await ctx.cookies.get("count")) ?? "0");
  await ctx.cookies.set("count", String(++count));
  return { hello: "world", count };
}, {
  schema: {
    querystring: v.object({
      a: v.optional(v.string()),
      b: v.optional(v.string()),
    }),
    response: v.object({ hello: v.number(), count: v.number() }),
  },
});
router.get("/error", () => {
  throw new Error("test");
});

router.on(Status.NotFound, () => {
  return Response.json({ message: "Not Found" }, {
    status: Status.NotFound,
    statusText: STATUS_TEXT[Status.NotFound],
  });
});

router.listen({
  port: 3000,
  onListen({ hostname, port }) {
    console.log(`Listening on ${colors.yellow(`http://${hostname}:${port}/`)}`);
  },
});
