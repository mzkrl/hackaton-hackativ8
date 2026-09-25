import { Elysia } from "elysia";

// aot: false is required for Cloudflare Workers — the runtime forbids
// code generation from strings (new Function / eval) which Elysia's
// ahead-of-time compiler uses.
const app = new Elysia({ aot: false }).get("/", () => "Hello Elysia");

// Local dev with Bun
if (typeof Bun !== "undefined" && process.env.WORKER !== "1") {
  app.listen(4000);
  console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
  );
}

// Cloudflare Worker entry point
export default {
  fetch: app.fetch,
};
