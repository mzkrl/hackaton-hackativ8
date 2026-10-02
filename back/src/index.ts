import { createApp } from "./app";
import { closeRedis } from "./lib/redis";

const app = createApp();

// Named export only. Do NOT add `export default app`.
//
// Bun auto-serves any module whose default export has a `.fetch` method (an
// Elysia instance does), binding `PORT`. With an explicit `app.listen()` below
// that means two servers competing for the same port: the explicit listen wins,
// Bun's auto-server then fails with a misleading `EADDRINUSE: Is port 4000 in
// use?` and kills the process, even though nothing else holds the port.
export { app };

const port = Number(process.env.PORT ?? 4000);

// Default to loopback: the API is published by cloudflared on this same host, so
// binding to every interface would expose it directly and bypass the tunnel.
const hostname = process.env.HOST ?? "127.0.0.1";

app.listen({ port, hostname });
console.log(`back API listening on http://${hostname}:${port}`);

// PM2 restarts this process on config changes and deploys. An open Redis socket
// would otherwise be abandoned mid-command, so close it before exiting.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		void closeRedis().finally(() => process.exit(0));
	});
}
