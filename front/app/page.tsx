import Link from "next/link";

import { ALLOWED_EXTENSIONS, MAX_DIRECT_UPLOAD_BYTES, formatBytes } from "../lib/sequence";

/**
 * The landing page is a Server Component on purpose.
 *
 * It used to host the workspace, which meant `/` could only ever show
 * "Checking your session…" until the browser had asked the API who it was. The
 * session is an HttpOnly cookie, so that wait is unavoidable -- but it should
 * not be what a visitor sees first. Rendering the pitch statically means `/`
 * paints from the prerender with no client JavaScript at all, and the workspace
 * at `/workspace` is the only thing that has to wait for the session.
 */
export default function Home() {
	return (
		<div className="flex min-h-full flex-col">
			<a
				href="#main"
				className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-lg focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-xs focus:text-white"
			>
				Skip to content
			</a>

			<SiteHeader />

			<main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:py-16">
				<section className="max-w-2xl">
					<h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
						Store research sequences, queue analyses, keep the notes.
					</h1>
					<p className="mt-4 text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
						Genomic Insight Agent is a workspace for nucleotide data. Bring in a
						FASTA or GenBank file, ask for a GC content or open reading frame run,
						and read the result as a chart or a table instead of a wall of JSON.
						Everything is filed under a project so the notes stay with the sequences
						they describe.
					</p>

					<div className="mt-7 flex flex-wrap items-center gap-3">
						<Link
							href="/workspace"
							className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:focus-visible:outline-zinc-100"
						>
							Open the workspace
						</Link>
						<a
							href="#how-it-works"
							className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100"
						>
							How it works
						</a>
					</div>

					<p className="mt-4 text-xs text-zinc-500">
						An account is required. The workspace handles sign in and sign up.
					</p>
				</section>

				<section id="how-it-works" className="mt-16 scroll-mt-8">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
						How it works
					</h2>
					<ol className="mt-4 grid gap-3 sm:grid-cols-2">
						{STEPS.map((step, index) => (
							<li
								key={step.title}
								className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
							>
								<p className="font-mono text-xs text-zinc-400">
									{String(index + 1).padStart(2, "0")}
								</p>
								<h3 className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
									{step.title}
								</h3>
								<p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
									{step.body}
								</p>
							</li>
						))}
					</ol>
				</section>

				<section className="mt-16">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
						Reading a result
					</h2>
					<p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
						A finished analysis is parsed field by field and drawn as a nucleotide
						composition chart, a GC content meter, an open reading frame table, and a
						similarity search table. Numbers the client derived rather than read from
						the payload are labelled as derived, so a computed figure is never presented
						as one a tool reported.
					</p>
				</section>

				<section className="mt-16 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
					<h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
						Accepted files
					</h2>
					<p className="mt-1.5 text-xs text-zinc-500">
						Direct uploads are capped at {formatBytes(MAX_DIRECT_UPLOAD_BYTES)}. Extensions
						are checked in the browser and again by the API.
					</p>
					<ul className="mt-3 flex flex-wrap gap-1.5">
						{ALLOWED_EXTENSIONS.map((extension) => (
							<li
								key={extension}
								className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
							>
								{extension}
							</li>
						))}
					</ul>
				</section>

				<p className="mt-12 max-w-2xl text-xs leading-relaxed text-zinc-400">
					For research and education only. Nothing here is a clinical or diagnostic
					tool, and no result should be used to guide patient care.
				</p>
			</main>

			<SiteFooter />
		</div>
	);
}

function SiteHeader() {
	return (
		<header className="border-b border-zinc-200 dark:border-zinc-800">
			<div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3.5">
				<Link
					href="/"
					className="text-sm font-semibold text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-50 dark:focus-visible:outline-zinc-100"
				>
					Genomic Insight
				</Link>
				<Link
					href="/workspace"
					className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100"
				>
					Workspace
				</Link>
			</div>
		</header>
	);
}

function SiteFooter() {
	return (
		<footer className="border-t border-zinc-200 dark:border-zinc-800">
			<div className="mx-auto w-full max-w-4xl px-4 py-6">
				<p className="text-[11px] leading-relaxed text-zinc-400">
					Analyses run in a background worker, never inside a request. The conversation
					log is a per-project notebook: it stores what you write, and nothing replies
					yet.
				</p>
			</div>
		</footer>
	);
}

const STEPS = [
	{
		title: "Import a sequence",
		body: "Upload a file straight to object storage with a presigned PUT, push a small one through the API, or paste the text. Pasted FASTA and GenBank are read for their record id and length.",
	},
	{
		title: "Queue the analysis",
		body: "Choosing an analysis returns immediately with a job id. The work happens in a long-lived worker, so a slow tool never holds an HTTP connection open.",
	},
	{
		title: "Watch it settle",
		body: "Status moves queued, processing, then completed or failed. The board polls only while something is in flight, and a job that exhausts its retries still leaves the reason behind.",
	},
	{
		title: "Keep the notes",
		body: "Observations are attached to the project, next to the sequences they came from, so a later reader can tell what the numbers were supposed to mean.",
	},
] as const;
