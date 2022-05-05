import { NativeHttpServer } from "./http_server_native.ts";

const target = new EventTarget();

const server = new NativeHttpServer(target, { port: 8080 });

const listener = server.listen();

console.log("listening...", listener);

(async () => {
  for await (const { request, respondWith } of server) {
    console.log(request.url);
    respondWith(new Response("hello world"));
  }
})();
