# acorn

[![ci](https://github.com/oakserver/acorn/workflows/ci/badge.svg)](https://github.com/oakserver/acorn)
[![deno doc](https://doc.deno.land/badge.svg)](https://doc.deno.land/https/deno.land/x/acorn/mod.ts)

Rapidly develop and iterate on RESTful APIs using a strongly typed router
designed for Deno CLI and Deno Deploy.

```ts
import { Router } from "https://deno.land/x/acorn/mod.ts";

const BOOKS: Record<string, { id: number; title: string }> = {
  "1": { id: 1, title: "The Hound of the Baskervilles" },
  "2": { id: 2, title: "It" },
};

const router = new Router();

router.get("/", () => ({ hello: "world" }));
router.get("/books/:id", (ctx) => BOOKS[ctx.params.id]);

router.listen({ port: 5000 });
```

## Routes

An instance of a router has several methods for registering a handler for a
route. The methods correspond to one or many HTTP methods or verbs. When a
request is handled by the router that matches a route and the HTTP method(s), it
will invoke the registered handler.

The handler is provided with a context which contains information about the
request:

```ts
interface Context<Params extends Record<string, string>, BodyType> {
  readonly request: Request;
  readonly params: Params;
  body(): Promise<BodyType | undefined>;
}
```

The `.params` property provides any parameters (named captures) parsed out when
matching the route string.

The `.body()` method is a convenience method to deal with decoding a JSON string
body. It can be used with an optional
[deserializer](https://doc.deno.land/https://deno.land/x/acorn/mod.ts/~/Deserializer)
which can do advanced decoding of the body, or it will attempted to be decoded
from the JSON string.

More advanced request body handling can be handled via the `.request` property.

The handler is then expected to have a return value which can be a `Request`
instance, a value that is a
[`BodyInit`](https://doc.deno.land/deno/dom/~/BodyInit), or any other value. If
an optional
[serializer](https://doc.deno.land/https://deno.land/x/acorn/mod.ts/~/Serializer)
is provided and the response is not a `Request` instance or of the type
`BodyInit`, the value will be passed to the serializer. If no serializer is
present then
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

Copyright 2018-2023 the oak authors. All rights reserved. MIT License.
