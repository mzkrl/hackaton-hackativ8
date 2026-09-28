"use client";

import { useState } from "react";

import { describeError, isQueueUnavailable } from "../lib/api";
import { deleteObject, getObjectDownload, queueAnalysis, type Sequence } from "../lib/genomics";
import { Button, Empty, Notice, Panel, formatDate, cx } from "./primitives";

/** `analysisType` is free-form on the backend (`1..64` chars, dispatched to the
 * Bio service), so these are starting points, not an enum the server enforces. */
const SUGGESTED_ANALYSES = ["gc_content", "at_content", "translate", "reverse_complement"];

export function SequenceBoard({
	sequences,
	analysesBySequence,
	canQueue,
	onQueued,
	onSequencesChanged,
	onQueueBlocked,
}: {
	sequences: Sequence[];
	analysesBySequence: Record<string, number>;
	canQueue: boolean;
	/** Reports the new job so the parent can start tracking and polling it. */
	onQueued: (analysisId: string) => Promise<void>;
	/** Reloads the sequence list after an upload or a delete. */
	onSequencesChanged: () => Promise<void>;
	/** Lifts a 503 from the queue out to the parent, which reports it once. */
	onQueueBlocked: (message: string) => void;
}) {
	return (
		<Panel
			title="Sequences"
			description={
				canQueue
					? "Pick an analysis to queue against a sequence."
					: "The API reports no working queue, so analyses cannot be submitted right now."
			}
		>
			{sequences.length === 0 ? (
				<Empty>No sequences yet. Add one to get started.</Empty>
			) : (
				<ul className="flex flex-col gap-2">
					{sequences.map((sequence) => (
						<SequenceRow
							key={sequence.id}
							sequence={sequence}
							analysisCount={analysesBySequence[sequence.id] ?? 0}
							canQueue={canQueue}
							onQueued={onQueued}
							onSequencesChanged={onSequencesChanged}
							onQueueBlocked={onQueueBlocked}
						/>
					))}
				</ul>
			)}
		</Panel>
	);
}

function SequenceRow({
	sequence,
	analysisCount,
	canQueue,
	onQueued,
	onSequencesChanged,
	onQueueBlocked,
}: {
	sequence: Sequence;
	analysisCount: number;
	canQueue: boolean;
	onQueued: (analysisId: string) => Promise<void>;
	onSequencesChanged: () => Promise<void>;
	onQueueBlocked: (message: string) => void;
}) {
	const [analysisType, setAnalysisType] = useState(SUGGESTED_ANALYSES[0]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const queue = async () => {
		setError(null);
		setBusy(true);
		try {
			const created = await queueAnalysis({ sequenceId: sequence.id, analysisType });
			await onQueued(created.id);
		} catch (caught) {
			// A missing queue is a deployment problem, not a per-sequence one, so
			// it is reported once at the top level instead of on every row.
			if (isQueueUnavailable(caught)) onQueueBlocked(describeError(caught));
			else setError(describeError(caught));
		} finally {
			setBusy(false);
		}
	};

	const download = async () => {
		if (!sequence.objectKey) return;
		setError(null);
		setBusy(true);
		try {
			// The URL is presigned and short-lived, so it is fetched on demand
			// rather than stored on the row.
			const { downloadUrl } = await getObjectDownload(sequence.objectKey);
			window.open(downloadUrl, "_blank", "noopener,noreferrer");
		} catch (caught) {
			setError(describeError(caught));
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (!sequence.objectKey) return;
		setError(null);
		setBusy(true);
		try {
			await deleteObject(sequence.objectKey);
			await onSequencesChanged();
		} catch (caught) {
			setError(describeError(caught));
		} finally {
			setBusy(false);
		}
	};

	const label = sequence.originalFilename ?? sequence.recordId ?? "pasted sequence";

	return (
		<li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
					<p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
						<span className="font-medium">{sequence.format}</span>
						{sequence.sequenceLength !== null
							? ` · ${sequence.sequenceLength.toLocaleString()} residues`
							: " · not parsed yet"}
						{analysisCount > 0 ? ` · ${analysisCount} ${analysisCount === 1 ? "analysis" : "analyses"}` : ""}
						{" · "}
						{formatDate(sequence.createdAt)}
					</p>
					{sequence.description ? (
						<p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{sequence.description}</p>
					) : null}
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					{sequence.objectKey ? (
						<>
							<Button onClick={download} disabled={busy}>
								Download
							</Button>
							<Button variant="danger" onClick={remove} disabled={busy}>
								Delete
							</Button>
						</>
					) : null}
				</div>
			</div>

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<label className="sr-only" htmlFor={`analysis-${sequence.id}`}>
					Analysis type
				</label>
				<select
					id={`analysis-${sequence.id}`}
					value={analysisType}
					onChange={(e) => setAnalysisType(e.target.value)}
					disabled={busy || !canQueue}
					className={cx(
						"rounded-lg border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs",
						"focus:border-zinc-500 focus:outline-none disabled:opacity-50",
						"dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100",
					)}
				>
					{SUGGESTED_ANALYSES.map((value) => (
						<option key={value} value={value}>
							{value}
						</option>
					))}
				</select>
				<Button variant="primary" onClick={queue} disabled={busy || !canQueue}>
					Queue analysis
				</Button>
			</div>

			{error ? (
				<div className="mt-2">
					<Notice tone="error">{error}</Notice>
				</div>
			) : null}
		</li>
	);
}
