import Link from "next/link";

/**
 * Rendered inside the root layout, so it inherits the fonts and the global
 * stylesheet. No layout of its own: an unmatched route should look like the rest
 * of the app, not like a separate product.
 */
export default function NotFound() {
	return (
		<div className="flex min-h-full flex-col">
			<main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-16">
				<p className="font-mono text-xs text-muted">404</p>

				<h1 className="mt-3 text-2xl font-semibold tracking-tight text-forest sm:text-3xl dark:text-night-text">
					No sequence at this address.
				</h1>

				<p className="mt-4 max-w-xl text-sm leading-relaxed text-muted dark:text-night-muted">
					The page does not exist. If you followed a link to a project or an
					analysis, it was probably one that has since been deleted.
				</p>

				<div className="mt-7 flex flex-wrap items-center gap-2.5">
					<Link
						href="/"
						className="inline-flex items-center justify-center rounded-lg bg-forest px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-forest/90 dark:bg-cream dark:text-forest dark:hover:bg-white"
					>
						Back to overview
					</Link>
					<Link
						href="/workspace"
						className="inline-flex items-center justify-center rounded-md border border-line-strong bg-paper px-4 py-2 text-sm font-medium text-forest transition-colors hover:bg-shell dark:border-night-line dark:bg-night-raised dark:text-night-text dark:hover:bg-night-raised"
					>
						Open the workspace
					</Link>
				</div>
			</main>
		</div>
	);
}