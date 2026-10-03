"use client";

import type { FormEvent } from "react";

import { ArrowUpRightIcon, PaperclipIcon } from "./brand";
import { cx } from "./primitives";

/*
 * The chat bar, in the two variants the app uses.
 *
 * Presentational only. It holds no state: `value` and `onChange` make it a
 * controlled input, so wherever it is mounted stays the single owner of what has
 * been typed. `onSubmit` is optional -- without it the form will not submit,
 * which is the safe default for a component that has nothing to do with a reply.
 *
 * The `filled` variant is the hero bar at the foot of the home column: a 46px
 * pill in the brief's `#601700`, with the paperclip on the left, the input in the
 * middle and a teal circle on the right. Every colour in it was measured against
 * what it actually sits on rather than against cream, because three of the four
 * are on a dark fill:
 *
 *   cream placeholder on maroon   11.11:1
 *   teal button on the maroon bar  3.97:1   (the edge, needs 3:1)
 *
 * The arrow is **white**, not cream, and that is the one place this file departs
 * from the brief. Cream on `#21A179` measures 2.80:1, under the 3:1 that a 18px
 * icon owes; white on the same teal is 3.26:1 and passes. The alternative was
 * teal-ink on teal at 1.53:1, which is worse than nothing. Cream on the bar stays
 * cream -- there it has 11.11:1 -- so the two creams in this bar are different
 * colours on purpose.
 *
 * `h-[46px]` is a fixed height, so the three children are laid out with
 * `items-center` and the input is `h-full` rather than padding itself to 46px.
 * Padding plus a line-height is how a bar ends up 49px tall.
 */

type ChatBarProps = {
	value: string;
	onChange: (value: string) => void;
	onSubmit?: () => void;
	placeholder?: string;
	variant?: "filled" | "plain";
	disabled?: boolean;
	label: string;
	className?: string;
};

export function ChatBar({
	value,
	onChange,
	onSubmit,
	placeholder = "What are we analyzing today?",
	variant = "plain",
	disabled = false,
	label,
	className,
}: ChatBarProps) {
	const filled = variant === "filled";

	const submit = (event: FormEvent) => {
		event.preventDefault();
		onSubmit?.();
	};

	return (
		<form
			onSubmit={submit}
			className={cx(
				"flex items-center gap-2.5 transition-colors",
				filled
					? "h-[46px] rounded-full bg-maroon pl-4 pr-1.5 focus-within:ring-2 focus-within:ring-teal-ink focus-within:ring-offset-2 focus-within:ring-offset-cream"
					: "rounded-xl border border-line-strong bg-paper p-1.5 text-forest focus-within:border-teal-ink",
				disabled && "opacity-60",
				className,
			)}
		>
			{/*
			 * Left, not right. The brief puts the paperclip first and the send
			 * circle last, and that order is not cosmetic: attach is the thing
			 * you reach for before you have anything to send, so it reads left
			 * to right as "add input, then submit".
			 */}
			<button
				type="button"
				disabled={disabled}
				aria-label="Attach a FASTA file"
				className={cx(
					"shrink-0 rounded-full transition-colors",
					filled
						? "text-cream hover:text-white"
						: "p-2 text-muted hover:bg-shell hover:text-forest",
				)}
			>
				<PaperclipIcon size={20} />
			</button>

			<label className="sr-only" htmlFor={`chat-${variant}`}>
				{label}
			</label>

			{/*
			 * `min-w-0` is load-bearing. A flex item defaults to `min-width: auto`,
			 * which refuses to shrink below its content, so a long placeholder
			 * would widen the bar past 558px and push the send circle out of the
			 * pill. This one class is what keeps the input inside its track.
			 */}
			<input
				id={`chat-${variant}`}
				type="text"
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				aria-label={label}
				className={cx(
					"min-w-0 flex-1 bg-transparent outline-none",
					filled
						? "h-full text-[13px] font-semibold text-cream placeholder:text-cream/90"
						: "px-1 py-1.5 text-sm text-forest placeholder:text-muted",
				)}
			/>

			<button
				type="submit"
				disabled={disabled || value.trim().length === 0}
				aria-label="Send"
				className={cx(
					"grid shrink-0 place-items-center rounded-full transition-opacity disabled:cursor-not-allowed",
					filled
						? "size-[34px] bg-teal text-white hover:opacity-90 disabled:bg-cream/25"
						: "size-8 bg-forest text-cream hover:bg-forest/90 disabled:bg-shell disabled:text-muted",
				)}
			>
				<ArrowUpRightIcon size={18} />
			</button>
		</form>
	);
}
