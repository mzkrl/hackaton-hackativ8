"use client";

import { useMemo, useState } from "react";

import { describeError } from "../lib/api";
import { createPastedSequence, proxyUpload } from "../lib/genomics";
import {
	ALLOWED_EXTENSIONS,
	MAX_UPLOAD_BYTES,
	formatBytes,
	hasAllowedExtension,
	hashSequence,
	parseFastaRecords,
	summariseAllSequences,
} from "../lib/sequence";
import { Button, Notice, Panel, TextArea, Field, cx } from "./primitives";

type Tab = "file" | "paste";

/**
 * Adds a sequence to a project.
 *
 * Three paths, because the backend offers three and they fail differently:
 *
 * - presign (default) sends the bytes straight to object storage. The row is
 *   created before the upload starts, so a failed PUT leaves a sequence whose
 *   `sequence_length` stays NULL — visible, and re-uploadable, rather than a
 *   silent gap.
 * - proxy pushes a small file through the backend, capped at 5 MiB.
 * - paste registers metadata only. The backend does not parse the text, so the
 *   length and hash are computed here.
 */
export function SequenceImport({ projectId, onImported }: { projectId: string; onImported: () => void }) {
	const [tab, setTab] = useState<Tab>("file");
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const run = async (task: () => Promise<string>) => {
		setError(null);
		setDone(null);
		setBusy(true);
		try {
			setDone(await task());
			onImported();
		} catch (caught) {
			setError(describeError(caught));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Panel
			title="Add a sequence"
			description="Upload a research file, or register a sequence from pasted text."
		>
			<div className="flex flex-col gap-4">
				<div className="flex gap-1 rounded-lg bg-shell p-1 dark:bg-night-raised">
					{(["file", "paste"] as const).map((value) => (
						<button
							key={value}
							type="button"
							onClick={() => {
								setTab(value);
								setError(null);
								setDone(null);
							}}
							className={cx(
								"flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
								tab === value
									? "bg-paper text-forest shadow-sm dark:bg-night dark:text-night-text"
									: "text-muted hover:text-forest dark:text-night-muted dark:hover:text-night-text",
							)}
						>
							{value === "file" ? "Upload file" : "Paste sequence"}
						</button>
					))}
				</div>

				{error ? <Notice tone="error">{error}</Notice> : null}
				{done ? <Notice tone="success">{done}</Notice> : null}

				{tab === "file" ? (
					<FileImport projectId={projectId} busy={busy} onRun={run} />
				) : (
					<PasteImport projectId={projectId} busy={busy} onRun={run} />
				)}
			</div>
		</Panel>
	);
}

type RunFn = (task: () => Promise<string>) => Promise<void>;

function FileImport({
	projectId,
	busy,
	onRun,
}: {
	projectId: string;
	busy: boolean;
	onRun: RunFn;
}) {
	const [file, setFile] = useState<File | null>(null);
	const [description, setDescription] = useState("");
	const [recordCount, setRecordCount] = useState<number | null>(null);

	const tooLarge = file !== null && file.size > MAX_UPLOAD_BYTES;
	const badExtension = file !== null && !hasAllowedExtension(file.name);

	const detectRecords = async (f: File) => {
		if (!f.name.toLowerCase().match(/\.(fa|fasta|fna)$/)) {
			setRecordCount(null);
			return;
		}
		try {
			const text = await f.text();
			const records = parseFastaRecords(text);
			setRecordCount(records.length);
		} catch {
			setRecordCount(null);
		}
	};

	const upload = () =>
		onRun(async () => {
			if (!file) throw new Error("Choose a file first.");
			if (badExtension) throw new Error(`Allowed extensions: ${ALLOWED_EXTENSIONS.join(", ")}.`);
			if (tooLarge) {
				throw new Error(
					`That file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
				);
			}

			const form = new FormData();
			form.set("projectId", projectId);
			form.set("filename", file.name);
			form.set("file", file);
			if (description.trim()) form.set("description", description.trim());

			// Bytes go through the API, which relays them to object storage. The
			// browser is never handed a storage URL, so storage stays internal.
			await proxyUpload(form);

			// Multi-record FASTA: the file is one object, but each record becomes
			// its own sequence row. `proxyUpload` created the row for the first
			// record; add the rest.
			const isMultiRecordFasta = recordCount !== null && recordCount > 1;
			if (isMultiRecordFasta) {
				const records = parseFastaRecords(await file.text());
				await Promise.all(
					records.slice(1).map((record) =>
						createPastedSequence(projectId, {
							format: "fasta",
							sequenceLength: record.sequence.length,
							sequenceHash: hashSequence(record.sequence),
							description: description.trim() || null,
							recordId: record.recordId,
						}),
					),
				);
			}

			const suffix = isMultiRecordFasta ? ` — created ${recordCount} sequences.` : ".";
			setFile(null);
			setDescription("");
			setRecordCount(null);
			return `Uploaded ${file.name} (${formatBytes(file.size)})${suffix}`;
		});

	return (
		<div className="flex flex-col gap-3">
			<Field
				label="File"
				type="file"
				accept={ALLOWED_EXTENSIONS.join(",")}
				onChange={(e) => {
					const f = e.target.files?.[0] ?? null;
					setFile(f);
					setRecordCount(null);
					if (f) detectRecords(f);
				}}
				disabled={busy}
				hint={
					<span>
						{ALLOWED_EXTENSIONS.join(", ")} · up to {formatBytes(MAX_UPLOAD_BYTES)} · sent through
						the API
					</span>
				}
			/>

			<Field
				label="Description (optional)"
				value={description}
				onChange={(e) => setDescription(e.target.value)}
				maxLength={2000}
				disabled={busy}
			/>

			{file ? (
				<p className="text-xs text-muted">
					{file.name} · {formatBytes(file.size)}
					{badExtension ? " · unsupported extension" : ""}
					{recordCount !== null && recordCount > 1 ? ` · ${recordCount} FASTA records` : ""}
				</p>
			) : null}

			<div className="flex flex-wrap gap-2">
				<Button
					variant="primary"
					onClick={upload}
					disabled={busy || !file || tooLarge || badExtension}
				>
					{busy ? "Uploading…" : "Upload"}
				</Button>
			</div>
		</div>
	);
}

function PasteImport({
	projectId,
	busy,
	onRun,
}: {
	projectId: string;
	busy: boolean;
	onRun: RunFn;
}) {
	const [text, setText] = useState("");
	const [description, setDescription] = useState("");

	const summaries = useMemo(() => (text.trim() ? summariseAllSequences(text) : []), [text]);
	const summary = summaries[0] ?? null;
	const isMultiRecord = summaries.length > 1;

	return (
		<div className="flex flex-col gap-3">
			<TextArea
				label="Sequence text"
				rows={6}
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder={">NC_000001\nGATTACA..."}
				disabled={busy}
				hint="FASTA and GenBank headers are recognised; the rest is measured as typed. Multi-record FASTA is supported — each record becomes a separate sequence."
			/>

			<Field
				label="Description (optional)"
				value={description}
				onChange={(e) => setDescription(e.target.value)}
				maxLength={2000}
				disabled={busy}
			/>

			{summary ? (
				<p className="text-xs text-muted">
					Detected <strong className="font-medium text-forest dark:text-night-muted">{summary.format}</strong>
					{summary.recordId ? (
						<>
							{" · "}
							record <strong className="font-medium text-forest dark:text-night-muted">{summary.recordId}</strong>
						</>
					) : null}
					{" · "}
					{summary.sequenceLength.toLocaleString()} residues
					{isMultiRecord ? (
						<>
							{" · "}
							<strong className="font-medium text-forest dark:text-night-muted">
								{summaries.length} records detected
							</strong>
						</>
					) : null}
				</p>
			) : null}

			<Button
				variant="primary"
				disabled={busy || !summary || summary.sequenceLength < 1}
				onClick={() =>
					onRun(async () => {
						if (summaries.length === 0) throw new Error("Nothing to register.");

						if (summaries.length === 1) {
							const s = summaries[0];
							const sequence = await createPastedSequence(projectId, {
								format: s.format,
								sequenceLength: s.sequenceLength,
								sequenceHash: s.sequenceHash,
								description: description.trim() || null,
								...(s.recordId ? { recordId: s.recordId } : {}),
							});
							setText("");
							setDescription("");
							return `Registered ${sequence.format} sequence, ${(sequence.sequenceLength ?? 0).toLocaleString()} residues.`;
						}

						// Multi-record: create one sequence row per record
						const created = await Promise.all(
							summaries.map((s) =>
								createPastedSequence(projectId, {
									format: s.format,
									sequenceLength: s.sequenceLength,
									sequenceHash: s.sequenceHash,
									description: description.trim() || null,
									...(s.recordId ? { recordId: s.recordId } : {}),
								}),
							),
						);
						setText("");
						setDescription("");
						return `Registered ${created.length} sequences from multi-record ${created[0]?.format ?? "fasta"} input.`;
					})
				}
			>
				{busy ? "Registering…" : isMultiRecord ? `Register ${summaries.length} sequences` : "Register sequence"}
			</Button>
		</div>
	);
}
