"use client";

import { useRef, useState, type DragEvent } from "react";

import { BoxIcon } from "./brand";
import { cx } from "./primitives";

/*
 * The upload target: the entry point of the whole product.
 *
 * Display plus drag state only. It never reads a file -- it hands the FileList
 * to `onFiles` and forgets it, so whatever stores, validates or parses the bytes
 * stays outside. That also means it works unchanged whether the next step is a
 * presigned PUT, a proxied upload, or nothing wired up yet.
 *
 * The border is 2px dashed `--color-maroon`, the brief's `#601700`. It measures
 * 11.11:1 on cream, so nothing had to be corrected here.
 *
 * The box is a fixed 500x238 rather than growing with its contents. That is
 * deliberate at a size this large: the caption inside wraps to two lines at
 * `max-w-[260px]`, and a box that resized with its text would change height the
 * moment one word of the label was edited.
 *
 * `overflow-hidden` is on the box so the dashed rule is clipped to the 14px
 * radius. Without it the dash corners render square against the curve and the
 * whole element reads as a rectangle with a rounded background.
 *
 * Sizes are the caller's. Nothing here assumes the home screen's numbers.
 */

type UploadTargetProps = {
	onFiles?: (files: FileList) => void;
	accept?: string;
	disabled?: boolean;
	label?: React.ReactNode;
	/** Secondary line under the prompt. */
	hint?: React.ReactNode;
	className?: string;
};

export function UploadTarget({
	onFiles,
	accept,
	disabled = false,
	label = "Drop or upload your FASTA file here to get started!",
	hint,
	className,
}: UploadTargetProps) {
	const [over, setOver] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const dragDepth = useRef(0);

	const onDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		dragDepth.current = 0;
		setOver(false);
		if (disabled) return;
		// `files` rather than a copy: the handler owns it from here.
		if (event.dataTransfer.files.length > 0) onFiles?.(event.dataTransfer.files);
	};

	const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		if (disabled) return;
		// Only highlight when dragging files, not arbitrary page content.
		if (!event.dataTransfer.types.includes("Files")) return;
		dragDepth.current += 1;
		setOver(true);
	};

	const onDragOver = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		if (disabled) return;
		if (!event.dataTransfer.types.includes("Files")) return;
		// Required to allow the drop event to fire.
		event.dataTransfer.dropEffect = "copy";
	};

const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			/*
			 * `relatedTarget === null` means the pointer left the window entirely
			 * rather than moving onto a child. Chrome does not always deliver the
			 * matching `dragenter` when the drag comes back, so without this the
			 * counter stays positive and the box is left stuck in the teal
			 * drag-over state after the cursor is gone.
			 */
			if (event.relatedTarget === null) {
				dragDepth.current = 0;
				setOver(false);
				return;
			}
			dragDepth.current -= 1;
			if (dragDepth.current <= 0) {
				dragDepth.current = 0;
				setOver(false);
			}
		};

	const openFilePicker = () => {
		if (disabled) return;
		inputRef.current?.click();
	};

	return (
		<div
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
			onClick={openFilePicker}
			role="button"
			tabIndex={disabled ? -1 : 0}
			aria-label="Upload a FASTA file"
			aria-disabled={disabled}
			onKeyDown={(event) => {
				if (disabled) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					openFilePicker();
				}
			}}
			className={cx(
				/*
				 * `flex-col` + `justify-center` puts the icon above the caption in
				 * normal flow -- the caption is a sibling of the icon, not something
				 * positioned underneath it, which is what previously let it escape
				 * the box. `gap-[18px]` is the brief's number; Tailwind has no gap
				 * step at 18, hence the arbitrary value.
				 */
				"flex cursor-pointer flex-col items-center justify-center gap-[18px] overflow-hidden rounded-[14px] border-2 border-dashed px-6 text-center",
				/*
				 * Drag-over swaps to the ink teal. It is the only signal that the
				 * target is live, and maroon-on-maroon would be invisible.
				 */
				over ? "border-teal-ink bg-teal-ink/5" : "border-maroon",
				disabled && "pointer-events-none opacity-60",
				className,
			)}
		>
			<BoxIcon
				size={76}
				className={over ? "text-teal-ink" : "text-maroon"}
			/>

			<p className="max-w-[260px] text-[12px] font-semibold leading-snug text-maroon">
				{label}
			</p>

			{hint ? (
				<p className="max-w-[300px] text-[12px] leading-relaxed text-muted">
					{hint}
				</p>
			) : null}

			{/*
			 * The whole box is the drop target, and since it now opens the picker
			 * on click and on Enter/Space it is the accessible control: role=button
			 * plus a tab stop. The input is therefore `tabIndex={-1}` and hidden
			 * from assistive tech -- leaving it focusable would put two tab stops
			 * on one control, and `pointer-events-none` stops a click landing on
			 * the input and bubbling back up to re-trigger `click()`.
			 */}
			<input
				ref={inputRef}
				type="file"
				accept={accept}
				disabled={disabled}
				tabIndex={-1}
				aria-hidden="true"
				className="pointer-events-none sr-only"
				onChange={(event) => {
					if (event.target.files?.length) onFiles?.(event.target.files);
					// Reset so picking the same file twice still fires onChange.
					event.target.value = "";
				}}
			/>
		</div>
	);
}
