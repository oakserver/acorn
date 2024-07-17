// Copyright 2018-2024 the oak authors. All rights reserved.

import { Router, Status, v } from "../mod.ts";
import { assert } from "@oak/commons/assert";

const router = new Router({ logger: { console: true } });

const db = await Deno.openKv();

const book = v.object({
  author: v.string(),
  title: v.string(),
});

const bookList = v.array(book);

type Book = v.InferOutput<typeof book>;

const bookPatch = v.object({
  author: v.optional(v.string()),
  title: v.optional(v.string()),
});

router.get("/", async (ctx) => {
  const count = parseInt(await ctx.cookies.get("count") ?? "0", 10) + 1;
  await ctx.cookies.set("count", String(count));
  return { hello: "world", count };
});

router.get("/redirect", (ctx) => {
  return ctx.redirect("/book/:id", {
    params: { id: "1" },
    status: Status.TemporaryRedirect,
  });
});

router.get("/book", async () => {
  const books: Book[] = [];
  const bookEntries = db.list<Book>({ prefix: ["books"] });
  for await (const { key, value } of bookEntries) {
    if (key[1] === "id") {
      continue;
    }
    console.log(key, value);
    books.push(value);
  }
  return books;
}, { schema: { response: bookList } });

router.get("/book/:id", async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  const maybeBook = await db
    .get<Book>(["books", id]);
  if (!maybeBook.value) {
    ctx.throw(Status.NotFound, "Book not found");
  }
  return maybeBook.value;
}, { schema: { response: book } });

router.post("/book", async (ctx) => {
  const body = await ctx.body();
  assert(body, "Body required.");
  const idEntry = await db.get<number>(["books", "id"]);
  const id = (idEntry.value ?? 0) + 1;
  const result = await db.atomic()
    .check({ key: ["books", "id"], versionstamp: idEntry.versionstamp })
    .set(["books", "id"], id)
    .set(["books", id], body)
    .commit();
  if (!result.ok) {
    ctx.throw(Status.InternalServerError, "Conflict updating the book id");
  }
  return ctx.created(body, {
    location: `/book/:id`,
    params: { id: String(id) },
  });
}, { schema: { body: book, response: book } });

router.put("/book/:id", async (ctx) => {
  const body = await ctx.body();
  const id = parseInt(ctx.params.id, 10);
  const bookEntry = await db.get<Book>(["books", id]);
  if (!bookEntry.value) {
    ctx.throw(Status.NotFound, "Book not found");
  }
  const result = await db.atomic()
    .check({ key: ["books", id], versionstamp: bookEntry.versionstamp })
    .set(["books", id], body)
    .commit();
  if (!result.ok) {
    ctx.throw(Status.InternalServerError, "Conflict updating the book");
  }
  return book;
}, { schema: { body: book, response: book } });

router.patch("/book/:id", async (ctx) => {
  const body = await ctx.body();
  const id = parseInt(ctx.params.id, 10);
  const bookEntry = await db.get<Book>(["books", id]);
  if (!bookEntry.value) {
    ctx.throw(Status.NotFound, "Book not found");
  }
  const book = { ...bookEntry.value, ...body };
  const result = await db.atomic()
    .check({ key: ["books", id], versionstamp: bookEntry.versionstamp })
    .set(["books", id], book)
    .commit();
  if (!result.ok) {
    ctx.throw(Status.InternalServerError, "Conflict updating the book");
  }
  return book;
}, { schema: { body: bookPatch, response: book } });

router.delete("/book/:id", async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  await db.delete(["books", id]);
});

router.listen({ port: 3000 });
