import { Elysia } from "elysia";

const app = new Elysia().get("/", () => "Hello Elysia");

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
