import { Router } from "../mod.ts";

const router = new Router();

class Book {
  constructor(options: any, params: Record<string, string>) {
    console.log("construct book");
    if (options) {
      Object.assign(this, options);
    }
    if (params) {
      Object.assign(this, params);
    }
  }

  static parse(value: string, params: Record<string, string>): Book {
    return new Book(value && JSON.parse(value), params);
  }

  static stringify(value: Book): string {
    return JSON.stringify(value);
  }
}

router.all("/", (ctx) => {
  console.log("route all");
  return { hello: "world" };
});

router.all("/books/:id", async (ctx) => {
  console.log("params", ctx.params);
  const body = await ctx.body();
  console.log("body", body);
  return body;
}, {
  deserializer: Book,
  serializer: Book,
});

router.addEventListener("listen", (evt) => {
  console.log(
    `%cListening %c${
      evt.secure ? "https://" : "http://"
    }${evt.hostname}:${evt.port}`,
    "color:green;font-weight:bold;",
    "color:yellow",
  );
});

router.listen({ port: 8888 });
