// Copyright 2018-2024 the oak authors. All rights reserved.

import { isHttpError } from "@oak/commons/http_errors";
import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/assert-equals";
import { assertRejects } from "@std/assert/assert-rejects";
import * as v from "@valibot/valibot";
import { MockRequestEvent } from "./testing_utils.ts";

import { Schema } from "./schema.ts";

Deno.test({
  name: "Schema - empty schema should passthrough values for querystring",
  async fn() {
    const schema = new Schema();
    const requestEvent = new MockRequestEvent("http://localhost/?a=1&b=2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: 3 }),
    });
    const result = await schema.validateQueryString(requestEvent);
    assertEquals(result, { output: { a: "1", b: "2" } });
  },
});

Deno.test({
  name: "Schema - empty schema should passthrough values for body",
  async fn() {
    const schema = new Schema();
    const requestEvent = new MockRequestEvent("http://localhost/?a=1&b=2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: 3 }),
    });
    const result = await schema.validateBody(requestEvent);
    assertEquals(result, { output: { c: 3 } });
  },
});

Deno.test({
  name: "Schema - empty schema should passthrough values for response",
  async fn() {
    const schema = new Schema();
    const result = await schema.validateResponse({ hello: "world" });
    assertEquals(result, { output: { hello: "world" } });
  },
});

Deno.test({
  name: "Schema - querystring schema should validate querystring",
  async fn() {
    const schema = new Schema({
      querystring: v.object({ a: v.string(), b: v.string() }),
    });
    const requestEvent = new MockRequestEvent("http://localhost/?a=1&b=2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: 3 }),
    });
    const result = await schema.validateQueryString(requestEvent);
    assertEquals(result, { output: { a: "1", b: "2" } });
  },
});

Deno.test({
  name: "Schema - body schema should validate body",
  async fn() {
    const schema = new Schema({ body: v.object({ c: v.number() }) });
    const requestEvent = new MockRequestEvent("http://localhost/?a=1&b=2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: 3 }),
    });
    const result = await schema.validateBody(requestEvent);
    assertEquals(result, { output: { c: 3 } });
  },
});

Deno.test({
  name: "Schema - response schema should validate response",
  async fn() {
    const schema = new Schema({ response: v.object({ hello: v.string() }) });
    const result = await schema.validateResponse({ hello: "world" });
    assertEquals(result, { output: { hello: "world" } });
  },
});

Deno.test({
  name: "Schema - invalid querystring should reject with 400",
  async fn() {
    const schema = new Schema({
      querystring: v.object({ a: v.string(), b: v.string() }),
    });
    const requestEvent = new MockRequestEvent("http://localhost/?a=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: 3 }),
    });
    const error = await assertRejects(async () => {
      await schema.validateQueryString(requestEvent);
    });
    assert(isHttpError(error));
    assertEquals(error.status, 400);
  },
});

Deno.test({
  name: "Schema - invalid body should reject with 400",
  async fn() {
    const schema = new Schema({ body: v.object({ c: v.string() }) });
    const requestEvent = new MockRequestEvent("http://localhost/?a=1&b=2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: 3 }),
    });
    const error = await assertRejects(async () => {
      await schema.validateBody(requestEvent);
    });
    assert(isHttpError(error));
    assertEquals(error.status, 400);
  },
});

Deno.test({
  name: "Schema - invalid response should should reject with 400",
  async fn() {
    const schema = new Schema({ response: v.object({ hello: v.number() }) });
    const error = await assertRejects(async () => {
      await schema.validateResponse({ hello: "world" });
    });
    assert(isHttpError(error));
    assertEquals(error.status, 400);
  },
});

Deno.test({
  name: "Schema - invalid querystring should call invalid handler",
  async fn() {
    const schema = new Schema({
      querystring: v.object({ a: v.string(), b: v.string() }),
      invalidHandler(type, issues) {
        assert(type === "querystring");
        assertEquals(issues.length, 1);
        return new Response("Invalid querystring", { status: 400 });
      },
    });
    const requestEvent = new MockRequestEvent("http://localhost/?a=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: 3 }),
    });
    const result = await schema.validateQueryString(requestEvent);
    assert(result.invalidResponse instanceof Response);
    assertEquals(result.invalidResponse.status, 400);
  },
});

Deno.test({
  name: "Schema - invalid body should call invalid handler",
  async fn() {
    const schema = new Schema({
      body: v.object({ c: v.string() }),
      invalidHandler(type, issues) {
        assert(type === "body");
        assertEquals(issues.length, 1);
        return new Response("Invalid querystring", { status: 400 });
      },
    });
    const requestEvent = new MockRequestEvent("http://localhost/?a=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: 3 }),
    });
    const result = await schema.validateBody(requestEvent);
    assert(result.invalidResponse instanceof Response);
    assertEquals(result.invalidResponse.status, 400);
  },
});

Deno.test({
  name: "Schema - invalid response should should call invalid handler",
  async fn() {
    const schema = new Schema({
      response: v.object({ hello: v.number() }),
      invalidHandler(type, issues) {
        assert(type === "response");
        assertEquals(issues.length, 1);
        return new Response("Invalid querystring", { status: 400 });
      },
    });
    const result = await schema.validateResponse({ hello: "world" });
    assert(result.invalidResponse instanceof Response);
    assertEquals(result.invalidResponse.status, 400);
  },
});

Deno.test({
  name: "Schema - throwing in invalid handler should throw 500 for querystring",
  async fn() {
    const schema = new Schema({
      querystring: v.object({ a: v.string(), b: v.string() }),
      invalidHandler() {
        throw new Error("Boom");
      },
    });
    const requestEvent = new MockRequestEvent("http://localhost/?a=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: 3 }),
    });
    const error = await assertRejects(async () => {
      await schema.validateQueryString(requestEvent);
    });
    assert(isHttpError(error));
    assertEquals(error.status, 500);
    assert(error.cause instanceof Error);
    assertEquals(error.cause.message, "Boom");
  },
});

Deno.test({
  name: "Schema - throwing in invalid handler should throw 500 for body",
  async fn() {
    const schema = new Schema({
      body: v.object({ c: v.string() }),
      invalidHandler() {
        throw new Error("Boom");
      },
    });
    const requestEvent = new MockRequestEvent("http://localhost/?a=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: 3 }),
    });
    const error = await assertRejects(async () => {
      await schema.validateBody(requestEvent);
    });
    assert(isHttpError(error));
    assertEquals(error.status, 500);
    assert(error.cause instanceof Error);
    assertEquals(error.cause.message, "Boom");
  },
});

Deno.test({
  name: "Schema - throwing in invalid handler should throw 500 for response",
  async fn() {
    const schema = new Schema({
      response: v.object({ hello: v.number() }),
      invalidHandler() {
        throw new Error("Boom");
      },
    });
    const error = await assertRejects(async () => {
      await schema.validateResponse({ hello: "world" });
    });
    assert(isHttpError(error));
    assertEquals(error.status, 500);
    assert(error.cause instanceof Error);
    assertEquals(error.cause.message, "Boom");
  },
});
