// Copyright 2022-2023 the oak authors. All rights reserved.

import {
  ServerSentEvent,
  ServerSentEventStreamTarget,
} from "https://deno.land/std@0.193.0/http/server_sent_event.ts";

import { auth, immutable, Router } from "../mod.ts";
import { createHttpError, Status } from "../deps.ts";
import { assert } from "../util.ts";

// A mock datastore where we index our books based on id.
const BOOK_DB: Record<string, Book> = {
  "1": {
    id: 1,
    title: "The Hound of the Baskervilles",
  },
  "2": {
    id: 2,
    title: "It",
  },
};

// A class with mimics hydrating a book from the datastore.
class Book {
  id!: number;
  title!: string;

  constructor(options: { id: string }) {
    const value = BOOK_DB[options.id];
    if (!value) {
      throw createHttpError(
        Status.NotFound,
        `Book with the id "${options.id}" doesn't exist.`,
      );
    }
    Object.assign(this, value);
  }

  static parse(_value: string, params: { id: string }): Promise<Book> {
    // This is made to be asynchronous to be a bit more like how interactions
    // with a datastore might work.
    let book;
    try {
      book = new Book(params);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve(book);
  }

  static stringify(value: Book): string {
    return JSON.stringify(value);
  }
}

// Creating a router, which will be what listens for requests
const router = new Router();

// The root of the router serves up some immutable JSON
router.get("/", immutable({ hello: "world" }));

// The route `/html` demonstrates returning an an immutable HTML string.
router.get(
  "/html",
  immutable(`<!DOCTYPE html>
<html lang="en">
<head>
  <title>Example returning html</title>
</head>
<body>
  <h1>Example returning HTML</h1>
</body>
</html>`),
);

// A very basic endpoint which will return a JSON value if the right bearer
// token is presented.
router.get(
  "/auth",
  auth(() => ({ hello: "acorn" }), {
    authorize(ctx) {
      if (
        ctx.request.headers.get("authorization")?.toLowerCase() ===
          "bearer 123456789"
      ) {
        return true;
      }
    },
  }),
);

// We then have an API which attempts to fetch the book.
router.get("/books/:id", async (ctx) => {
  const body = await ctx.body();
  // because we are using the deserializer below, the body should be an instance
  // of `Book`.
  assert(body instanceof Book);
  return body;
}, {
  // this takes the request and hydrates it into a `Book` using the static
  // method `.parse()`.
  deserializer: Book,
  // whenever we return a value from the handler, the static method `.stringify`
  // on `Book` will be called.
  serializer: Book,
});

// An example of sending server sent events.
router.get("/events", (_ctx) => {
  const target = new ServerSentEventStreamTarget();

  let counter = 0;

  // Sends an event every 2 seconds, incrementing the ID
  const id = setInterval(() => {
    const evt = new ServerSentEvent(
      "message",
      { data: { hello: "world" }, id: counter++ },
    );
    target.dispatchEvent(evt);
  }, 2000);

  target.addEventListener("close", () => clearInterval(id));

  return target.asResponse();
});

// This listens for when we connect and logs out to the console.
router.addEventListener("listen", (evt) => {
  console.log(
    `%cListening %c${
      evt.secure ? "https://" : "http://"
    }${evt.hostname}:${evt.port}`,
    "color:green;font-weight:bold;",
    "color:yellow",
  );
});

// This listens for each handled event, and logs out to the console information
// about the request/response.
router.addEventListener("handled", (evt) => {
  const responseColor = evt.response.status < 400
    ? "color:green"
    : evt.response.status < 500
    ? "color:yellow"
    : "color:red";
  let url;
  try {
    url = new URL(evt.request.url);
  } catch {
    // just swallow errors here
  }
  console.log(
    `%c${evt.request.method} ${
      evt.route?.route ?? url?.pathname
    } - [${evt.response.status}] ${evt.measure.duration.toFixed(2)}ms`,
    responseColor,
  );
});

// now we will listen on port 8888 if developing locally. The port is ignored
// on Deno Deploy.
router.listen({ port: 8888 });
