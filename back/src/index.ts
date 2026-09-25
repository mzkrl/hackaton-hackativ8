import { Elysia } from "elysia";

const app = new Elysia().get("/", () => "Hello Elysia");

if (process.env.VERCEL !== "1") {
  app.listen(4000);
  console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
  );
}

export default app;
