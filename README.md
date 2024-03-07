# acorn

[![ci](https://github.com/oakserver/acorn/workflows/ci/badge.svg)](https://github.com/oakserver/acorn)

Rapidly develop and iterate on RESTful APIs using a strongly typed router
designed for Deno CLI, Deno Deploy and Bun.

## Usage

### Under Deno CLI or Deploy

You need to import the package into your code:

```ts
import { Router } from "jsr:@oak/acorn/router";

const BOOKS: Record<string, { id: number; title: string }> = {
  "1": { id: 1, title: "The Hound of the Baskervilles" },
  "2": { id: 2, title: "It" },
};

const router = new Router();

router.get("/", () => ({ hello: "world" }));
router.get("/books/:id", (ctx) => BOOKS[ctx.params.id]);

router.listen({ port: 5000 });
```

### Under Bun

You need to add the package to your project:

```
bunx jsr add @oak/acorn
```

Then you need to import the package into your code:

```ts
import { Router } from "@oak/acorn/router";

const BOOKS: Record<string, { id: number; title: string }> = {
  "1": { id: 1, title: "The Hound of the Baskervilles" },
  "2": { id: 2, title: "It" },
};

const router = new Router();

router.get("/", () => ({ hello: "world" }));
router.get("/books/:id", (ctx) => BOOKS[ctx.params.id]);

router.listen({ port: 5000 });
```

## Philosophy

After having spent years working on [oak](https://jsr.io/@oak/oak) and extensive
experience with building Deno, that really when people were looking at
middleware type of solution, really what they were looking fore was a straight
forward router that made it easy to handle JSON payloads.

Also, oak was created in the early days of Deno, before it even had a native
HTTP server, and that server supported the web standard `Request` and
`Response`.

Acorn was the culmination of that need. It makes it easy to have route handlers
that are straight forward and focuses on staying closer to the native
implementations of Deno constructs that have evolved over time.

## Routes

An instance of a router has several methods for registering a handler for a
route. The methods correspond to one or many HTTP methods or verbs. When a
request is handled by the router that matches a route and the HTTP method(s), it
will invoke the registered handler.

The handler is provided with a context which contains information about the
request:

```ts
interface Context<Params extends Record<string, string>, BodyType> {
  readonly addr: Addr;
  readonly cookies: SecureCookieMap;
  readonly params: Params;
  readonly request: Request;
  readonly searchParams: Record<string, string>;
  body(): Promise<BodyType | undefined>;
  url(): URL;
}
```

The `.params` property provides any parameters (named captures) parsed out when
matching the route string.

The `.searchParams` property provides any search parameters associated with the
request.

The `.addr` property provides the remote address associated with the request.

The `.url()` method returns an instance of URL associated with the request.

The `.body()` method is a convenience method to deal with decoding a JSON string
body. It can be used with an optional
[deserializer](https://deno.land/x/acorn@0.4.0/mod.ts?s=Deserializer) which can
do advanced decoding of the body, or it will attempted to be decoded from the
JSON string.

More advanced request body handling can be handled via the `.request` property.

The handler is then expected to have a return value which can be a `Request`
instance, a value that is a [`BodyInit`](https://deno.land/api?s=BodyInit), or
any other value. If an optional
[serializer](https://deno.land/x/acorn@0.4.0/mod.ts?s=Serializer) is provided
and the response is not a `Request` instance or of the type `BodyInit`, the
value will be passed to the serializer. If no serializer is present then
[`JSON.stringify()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
will be used to attempt to convert the value to a JSON string. If `undefined` is
returned, then a `404 NotFound` response will be generated.

The handling of the request differs significantly from middleware solutions like
[oak](https://oakserver.github.io/oak/). In most cases you will want only one
handler per route and HTTP method combination. There is nothing that prevents
multiple registrations, but the first handler registered that returns a non
`undefined` value will be used and any remaining handlers will not be called.

Underneath, the router matches route strings using the browser standard
[URL Pattern API](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API)
and matches the pathname part of the URL.

---

Copyright 2018-2024 the oak authors. All rights reserved. MIT License.
