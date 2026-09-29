/**
 * PM2 configuration for the Genomic Insight Agent backend.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 logs gia-api
 *   pm2 reload gia-api          # zero-downtime reload of the API
 *   pm2 restart gia-worker      # worker drains in-flight jobs first
 *
 * Two processes, deliberately not clustered:
 *
 *   gia-api     HTTP listener on 127.0.0.1, published by cloudflared
 *   gia-worker  BullMQ consumer, long-lived
 *
 * The API runs in `fork` mode with a single instance on purpose. Bun's server
 * does not share a listening socket across PM2 workers, so clustering would give
 * you N processes racing for the same port and only one would win.
 *
 * Secrets are NOT in this file. `cwd` is set to the package root so Bun loads
 * `back/.env` on its own; keep that file at mode 600 on the VPS. Anything set in
 * `env` below takes precedence over `.env`, because Bun never overwrites a
 * variable that is already in `process.env` — so operational config lives here
 * and credentials live in `.env`.
 */

const base = {
	cwd: __dirname,
	exec_mode: "fork",
	instances: 1,
	watch: false,
	time: true,
	merge_logs: true,
	autorestart: true,
	// Fail fast instead of crash-looping forever: if a process dies more than
	// `max_restarts` times inside `restart_delay`, PM2 gives up and leaves it
	// down for a human to look at. Without this a bad deploy can silently
	// restart-loop a few hundred times before anyone notices.
	max_restarts: 10,
	restart_delay: 60_000,
	exp_backoff_restart_delay: 2_000,
};

module.exports = {
	apps: [
		{
			...base,
			name: "gia-api",
			script: "src/index.ts",
			interpreter: "bun",
			// The API is stateless, so a plain restart is fine and there is no
			// in-flight work to lose. Use `pm2 reload` for a graceful handover.
			kill_timeout: 5_000,
			max_memory_restart: "400M",
			out_file: "logs/api-out.log",
			error_file: "logs/api-error.log",
			env: {
				NODE_ENV: "production",
				DEPLOY_RUNTIME: "vps",
				// Loopback only. The tunnel owns the public hostname; binding
				// 0.0.0.0 would expose the API directly and bypass it.
				HOST: "127.0.0.1",
				PORT: "4000",
			},
		},
		{
			...base,
			name: "gia-worker",
			script: "src/worker/analysis.ts",
			interpreter: "bun",
			// This one matters. SIGTERM triggers `await worker.close()`, which
			// waits for in-flight jobs to finish before exiting. PM2's default
			// kill timeout is 1.6s, which SIGKILLs mid-analysis and leaves the
			// analysis row stuck in `processing` until BullMQ's stalled-job
			// checker notices and re-queues it. Give the drain real time.
			kill_timeout: 120_000,
			max_memory_restart: "800M",
			out_file: "logs/worker-out.log",
			error_file: "logs/worker-error.log",
			env: {
				NODE_ENV: "production",
				DEPLOY_RUNTIME: "vps",
				// Concurrent analyses. Keep this at or below the CPU/memory the
				// Bio Service and the external APIs can absorb, not the core count.
				WORKER_CONCURRENCY: "2",
			},
		},
	],
};
