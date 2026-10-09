"use client";

import { useState } from "react";

import { describeError } from "../lib/api";
import { deleteAnalysis, getAnalysis, queueAnalysis, type Analysis } from "../lib/genomics";
import { AnalysisResultView } from "./analysis-result";
import { Button, Empty, Notice, Panel, StatusBadge, formatDate } from "./primitives";

/**
 * Analyses belonging to one project.
 *
 * There is no `GET /analyses` endpoint — the API only exposes
 * `POST /analyses`, `GET /analyses/:id` and `GET /analyses/:id/status` — so the
 * caller can only know about jobs it submitted itself. The parent owns the list
 * of ids, polls them, and passes the resulting rows down. This component renders
 * and can force a refresh; it keeps no analysis state of its own, because a
 * second copy would drift from the one the parent is polling.
 */
export function AnalysisBoard({
	analyses,
	sequenceLabels,
	onRefresh,
	onQueued,
	onDeleted,
}: {
	analyses: Analysis[];
	sequenceLabels: Record<string, string>;
	onRefresh: () => void;
	/** A retry submits a fresh row, which the parent then tracks. */
	onQueued: (analysisId: string) => void;
	/** The row is gone server-side; the parent drops it from its tracked list. */
	onDeleted: (analysisId: string) => void;
}) {
	return (
		<Panel
			title="Analyses"
			description="Tracked for this session. Status refreshes while a job is queued or processing."
			actions={
				<Button onClick={onRefresh} disabled={analyses.length === 0}>
					Refresh
				</Button>
			}
		>
			{analyses.length === 0 ? (
				<Empty>Nothing queued yet. Submit an analysis from a sequence above.</Empty>
			) : (
				<ul className="flex flex-col gap-2">
					{analyses.map((analysis) => (
						<AnalysisRow
							key={analysis.id}
							analysis={analysis}
							label={sequenceLabels[analysis.sequenceId] ?? "unknown sequence"}
							onRefresh={onRefresh}
							onQueued={onQueued}
							onDeleted={onDeleted}
						/>
					))}
				</ul>
			)}
		</Panel>
	);
}

function AnalysisRow({
	analysis,
	label,
	onRefresh,
	onQueued,
	onDeleted,
}: {
	analysis: Analysis;
	label: string;
	onRefresh: () => void;
	onQueued: (analysisId: string) => void;
	onDeleted: (analysisId: string) => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const load = async () => {
		setError(null);
		try {
			// Re-read the full row so a result the worker wrote since the last poll
			// becomes visible. The parent then replaces the row it holds.
			await getAnalysis(analysis.id);
			onRefresh();
		} catch (caught) {
			setError(describeError(caught));
		}
	};

	const retry = async () => {
		setError(null);
		setBusy(true);
		try {
			// A retry is a fresh row on purpose: the old job id may still sit in
			// Redis and BullMQ dedupes on jobId, so re-using this analysis would
			// silently do nothing.
			const created = await queueAnalysis({
				sequenceId: analysis.sequenceId,
				analysisType: analysis.analysisType,
			});
			onQueued(created.id);
		} catch (caught) {
			setError(describeError(caught));
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (!window.confirm("Delete this analysis? This cannot be undone.")) return;
		setError(null);
		setBusy(true);
		try {
			await deleteAnalysis(analysis.id);
			onDeleted(analysis.id);
		} catch (caught) {
			setError(describeError(caught));
		} finally {
			setBusy(false);
		}
	};

	return (
		<li className="rounded-lg border border-line p-3 dark:border-night-line">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate text-sm font-medium text-forest dark:text-night-text">
						<span className="font-mono">{analysis.analysisType}</span>
						<span className="font-normal text-muted"> · {label}</span>
					</p>
					<p className="mt-0.5 text-xs text-muted dark:text-night-muted">
						{formatDate(analysis.createdAt)}
						{analysis.queueJobId ? ` · job ${analysis.queueJobId.slice(0, 8)}` : ""}
					</p>
				</div>

				<div className="flex items-center gap-1.5">
					<StatusBadge status={analysis.status} />
					<Button onClick={load} disabled={busy}>
						Reload
					</Button>
					{analysis.status === "failed" && analysis.sequenceId ? (
						<Button onClick={retry} disabled={busy}>
							Retry
						</Button>
					) : null}
					<Button variant="accent" onClick={remove} disabled={busy}>
						Delete
					</Button>
				</div>
			</div>

			{analysis.status === "failed" && analysis.errorMessage ? (
				<div className="mt-2">
					<Notice tone="error">{analysis.errorMessage}</Notice>
				</div>
			) : null}

			{analysis.resultJson ? (
				<AnalysisResultView
					resultJson={analysis.resultJson}
					analysisType={analysis.analysisType}
					createdAt={analysis.createdAt}
				/>
			) : null}

			{error ? (
				<div className="mt-2">
					<Notice tone="error">{error}</Notice>
				</div>
			) : null}
		</li>
	);
}
