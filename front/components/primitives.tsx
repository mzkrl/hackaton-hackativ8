"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

import type { AnalysisStatus } from "../lib/genomics";

export const cx = (...values: Array<string | false | null | undefined>) =>
	values.filter(Boolean).join(" ");

/* --------------------------------------------------------------- layout --- */

export const Panel = ({
	title,
	description,
	actions,
	children,
}: {
	title: string;
	description?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
}) => (
	<section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
		<header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
			<div>
				<h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
				{description ? (
					<p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
				) : null}
			</div>
			{actions ? <div className="flex items-center gap-2">{actions}</div> : null}
		</header>
		<div className="px-4 py-4">{children}</div>
	</section>
);

export const Empty = ({ children }: { children: ReactNode }) => (
	<p className="rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
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
	const tones = {
		info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100",
		error:
			"border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
		success:
			"border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
	} as const;

	return (
		<p
			role={tone === "error" ? "alert" : "status"}
			className={cx("rounded-lg border px-3 py-2 text-xs", tones[tone])}
		>
			{children}
		</p>
	);
};

/* -------------------------------------------------------------- controls --- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: "primary" | "ghost" | "danger";
};

export const Button = ({ variant = "ghost", className, ...props }: ButtonProps) => {
	const variants = {
		primary:
			"bg-zinc-900 text-white hover:bg-zinc-700 disabled:hover:bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
		ghost:
			"border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
		danger:
			"border border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950",
	} as const;

	return (
		<button
			type="button"
			{...props}
			className={cx(
				"inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100",
				"disabled:cursor-not-allowed disabled:opacity-50",
				variants[variant],
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
		<span className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
		<input
			{...props}
			className={cx(
				"w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900",
				"placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none",
				"dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600",
			)}
		/>
		{hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
	</label>
);

export const TextArea = ({
	label,
	hint,
	...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode }) => (
	<label className="block">
		<span className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
		<textarea
			{...props}
			className={cx(
				"w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900",
				"focus:border-zinc-500 focus:outline-none",
				"dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100",
			)}
		/>
		{hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
	</label>
);

/* ---------------------------------------------------------------- status --- */

const STATUS_TONES: Record<AnalysisStatus, string> = {
	queued: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
	processing: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
	completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
	failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export const StatusBadge = ({ status }: { status: AnalysisStatus }) => (
	<span
		className={cx(
			"inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
			STATUS_TONES[status],
		)}
	>
		{status}
	</span>
);

/** `queued` and `processing` are the only non-terminal states worth polling for. */
export const isPending = (status: AnalysisStatus) =>
	status === "queued" || status === "processing";

export const formatDate = (value: string) => {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};
