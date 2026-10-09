"use client";

import { useState } from "react";

import { API_URL, describeError, isQueueUnavailable } from "../lib/api";
import { deleteObject, queueAnalysis, type Sequence } from "../lib/genomics";
import { Button, Empty, Notice, Panel, formatDate, cx } from "./primitives";

/** `analysisType` is dispatched to the Bio service, whose `available_tools` these
 * mirror (`GET /` on the service). The backend allowlists the type, so these are
 * the tools a user can actually queue. */
const SUGGESTED_ANALYSES = [
	"gc_content",
	"at_content",
	"translate",
	"sequence_statistics",
	"detect_sequence_type",
	"extract_sequence_features",
	"validate_sequence",
	"parse_fasta",
];

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

	const download = () => {
		if (!sequence.objectKey) return;
		// Streamed through the API, which relays from object storage. A presigned
		// URL would embed the storage host, which the browser cannot reach.
		window.open(
			`${API_URL}/storage/download/${sequence.objectKey}`,
			"_blank",
			"noopener,noreferrer",
		);
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
		<li className="rounded-lg border border-line p-3 dark:border-night-line">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate text-sm font-medium text-forest dark:text-night-text">{label}</p>
					<p className="mt-0.5 text-xs text-muted dark:text-night-muted">
						<span className="font-medium">{sequence.format}</span>
						{sequence.sequenceLength !== null
							? ` · ${sequence.sequenceLength.toLocaleString()} residues`
							: " · not parsed yet"}
						{analysisCount > 0 ? ` · ${analysisCount} ${analysisCount === 1 ? "analysis" : "analyses"}` : ""}
						{" · "}
						{formatDate(sequence.createdAt)}
					</p>
					{sequence.description ? (
						<p className="mt-1 text-xs text-muted dark:text-night-muted">{sequence.description}</p>
					) : null}
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					{sequence.objectKey ? (
						<>
							<Button onClick={download} disabled={busy}>
								Download
							</Button>
							<Button variant="accent" onClick={remove} disabled={busy}>
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
						"rounded-lg border border-line-strong bg-paper px-2 py-1.5 font-mono text-xs",
						"focus:border-teal-ink disabled:opacity-50",
						"dark:border-night-line dark:bg-night dark:text-night-text",
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
