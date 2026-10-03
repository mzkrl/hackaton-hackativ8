"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

import type { AnalysisStatus } from "../lib/genomics";
import { AlertIcon, CheckIcon, InfoIcon } from "./brand";

export const cx = (...values: Array<string | false | null | undefined>) =>
	values.filter(Boolean).join(" ");

/*
 * Every colour below comes from the palette in globals.css, and every pairing
 * has been measured rather than eyeballed. The four that shaped this file, all
 * against `--color-paper` `#FFFCF7` or `--color-cream` `#FFEBCB`:
 *
 *   cream on forest   11.63:1   primary button
 *   cream on maroon   11.11:1   accent button
 *   teal-ink           4.87:1   focus ring, active stroke, dashed rules
 *   teal               2.80:1   below the 3:1 floor, so never one of those
 *
 * That last number is why there is no `variant="teal"` on Button: a filled teal
 * button lands at 2.8:1 with cream text, which fails the 3:1 floor an icon owes
 * and a long way short of the 4.5:1 one for body copy. Teal stays a mark colour
 * -- the helix, the composer submit button -- and never becomes a surface or an
 * edge. The one place it is filled, the icon inside it is white rather than
 * cream, because white on teal is 3.26:1 and cream is 2.80:1; see chat-bar.tsx.
 *
 * `--color-dust` at 4.35:1 is the one secondary that is allowed to draw a line.
 * `--color-line-strong` is not, at 1.64:1: it is a divider between two panels of
 * the same surface, not information, so it only has to be quiet.
 */

/* --------------------------------------------------------------- layout --- */

export const Panel = ({
	title,
	description,
	actions,
	children,
	className,
}: {
	title: string;
	description?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}) => (
	<section
		className={cx(
			"overflow-hidden rounded-xl border border-line bg-paper dark:border-night-line dark:bg-night-raised",
			className,
		)}
	>
		<header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 dark:border-night-line">
			<div>
				{/* Panel titles share the page's display treatment: same family, tighter. */}
				<h2 className="font-display text-[15px] font-semibold leading-tight text-forest dark:text-night-text">
					{title}
				</h2>
				{description ? (
					<p className="mt-1 text-xs leading-relaxed text-muted dark:text-night-muted">
						{description}
					</p>
				) : null}
			</div>
			{actions ? <div className="flex items-center gap-2">{actions}</div> : null}
		</header>
		<div className="px-4 py-4">{children}</div>
	</section>
);

/*
 * The empty placeholder: a dashed rule around a sentence saying there is nothing
 * here yet.
 *
 * The rule is `--color-dust`, not `--color-line-strong`. A dashed border is a
 * boundary the reader is meant to see, so it owes the 3:1 that non-text
 * information requires, and on the paper surface `#D9C6A2` measures 1.64:1
 * against `#A76660`'s 4.35:1. It is also the brief's secondary accent, which is
 * what a second visual weight in the palette is for.
 */
export const Empty = ({ children }: { children: ReactNode }) => (
	<p className="rounded-lg border border-dashed border-dust px-3 py-6 text-center text-xs leading-relaxed text-muted dark:border-night-muted dark:border-night-muted/60">
		{children}
	</p>
);

/* --------------------------------------------------------------- notice --- */

export const Notice = ({
	tone = "info",
	children,
}: {
	tone?: "info" | "error" | "success";
	children: ReactNode;
}) => {
	// Status colour, not brand colour: a failure has to read as a failure even
	// to someone who has not learned the palette.
	const tones = {
		info: {
			box: "border-teal-ink/40 bg-teal-ink/10 text-forest dark:border-teal/40 dark:bg-teal/10 dark:text-night-text",
			Icon: InfoIcon,
		},
		error: {
			box: "border-red-300 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100",
			Icon: AlertIcon,
		},
		success: {
			box: "border-teal/40 bg-teal/10 text-forest dark:border-teal/40 dark:bg-teal/10 dark:text-night-text",
			Icon: CheckIcon,
		},
	} as const;

	const { box, Icon } = tones[tone];

	return (
		<p
			role={tone === "error" ? "alert" : "status"}
			className={cx("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed", box)}
		>
			<Icon className="mt-px size-3.5 shrink-0" />
			<span>{children}</span>
		</p>
	);
};

/* -------------------------------------------------------------- controls --- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	/**
	 * `primary` is the one filled action on a screen, `accent` the one filled
	 * action in a group, `ghost` everything else. There is no fourth variant:
	 * a destructive button is `accent` with a warning label, which is easier to
	 * spot in review than a red-filled default.
	 */
	variant?: "primary" | "accent" | "ghost";
	size?: "sm" | "md";
};

export const Button = ({
	variant = "ghost",
	size = "sm",
	className,
	type = "button",
	...props
}: ButtonProps) => {
	const variants = {
		primary:
			"bg-forest text-cream hover:bg-forest/90 dark:bg-cream dark:text-forest dark:hover:bg-white",
		accent: "bg-maroon text-cream hover:bg-maroon/90",
		ghost:
			"border border-line-strong bg-paper text-forest hover:bg-shell dark:border-night-line dark:bg-night dark:text-night-text dark:hover:bg-night-raised",
	} as const;

	const sizes = {
		sm: "px-3 py-1.5 text-xs",
		md: "px-4 py-2 text-sm",
	} as const;

	return (
		<button
			type={type}
			{...props}
			className={cx(
				"inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors",
				"disabled:cursor-not-allowed disabled:opacity-45",
				variants[variant],
				sizes[size],
				className,
			)}
		/>
	);
};

export const Field = ({
	label,
	hint,
	...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) => (
	<label className="block">
		<span className="mb-1 block text-xs font-medium text-forest dark:text-night-text">{label}</span>
		<input
			{...props}
			className={cx(
				"w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-sm text-forest",
				"placeholder:text-muted focus:border-teal-ink",
				"dark:border-night-line dark:bg-night dark:text-night-text dark:placeholder:text-night-muted dark:focus:border-teal",
			)}
		/>
		{hint ? <span className="mt-1 block text-xs text-muted dark:text-night-muted">{hint}</span> : null}
	</label>
);

export const TextArea = ({
	label,
	hint,
	...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode }) => (
	<label className="block">
		<span className="mb-1 block text-xs font-medium text-forest dark:text-night-text">{label}</span>
		<textarea
			{...props}
			className={cx(
				"w-full rounded-lg border border-line-strong bg-paper px-3 py-2 font-mono text-xs text-forest",
				"focus:border-teal-ink",
				"dark:border-night-line dark:bg-night dark:text-night-text dark:focus:border-teal",
			)}
		/>
		{hint ? <span className="mt-1 block text-xs text-muted dark:text-night-muted">{hint}</span> : null}
	</label>
);

/* ---------------------------------------------------------------- status --- */

/*
 * Status colours come from the semantics, not the palette: queued is neutral,
 * processing is amber because that is what amber has always meant, completed is
 * brand teal because "done" and "the brand" agree, and failed is red because
 * nothing else would survive a colour-blind reader. Maroon is deliberately absent
 * -- it is the accent button, and reusing it here would make a destructive
 * action and a fatal error the same colour.
 */
const STATUS_TONES: Record<AnalysisStatus, string> = {
	queued: "bg-shell text-muted dark:bg-night dark:text-night-muted",
	processing: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
	completed: "bg-teal/15 text-teal-ink dark:bg-teal/15 dark:text-teal",
	failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export const StatusBadge = ({ status }: { status: AnalysisStatus }) => {
	const pending = isPending(status);

	return (
		<span
			className={cx(
				"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
				STATUS_TONES[status],
			)}
		>
			{/*
			 * A dot only on the two non-terminal states. It is the one place a
			 * moving indicator is honest: those rows really are still changing,
			 * where a spinner anywhere else would just be decoration.
			 */}
			{pending ? (
				<span
					aria-hidden
					className="animate-status-pulse size-1.5 shrink-0 rounded-full bg-current opacity-70"
				/>
			) : null}
			{status}
		</span>
	);
};

/** `queued` and `processing` are the only non-terminal states worth polling for. */
export const isPending = (status: AnalysisStatus) =>
	status === "queued" || status === "processing";

export const formatDate = (value: string) => {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

/* -------------------------------------------------------------- skeleton --- */

/**
 * Loading placeholder.
 *
 * Every waiting state in the app shows one of these rather than a "Loading…"
 * string, so the layout holds still instead of jumping when real content
 * arrives. The shape is passed in from the caller, which keeps this free of any
 * knowledge about what is being loaded.
 */
export const Skeleton = ({ className }: { className?: string }) => (
	<div aria-hidden className={cx("skeleton rounded", className)} />
);

/** A panel-shaped placeholder, for the moments before a board has any data. */
export const SkeletonRows = ({ rows = 3 }: { rows?: number }) => (
	<div className="flex flex-col gap-2">
		{Array.from({ length: rows }, (_, index) => (
			<div key={index} className="rounded-lg border border-line p-3 dark:border-night-line">
				<Skeleton className="h-3 w-2/5" />
				<Skeleton className="mt-2 h-2.5 w-1/4" />
			</div>
		))}
	</div>
);