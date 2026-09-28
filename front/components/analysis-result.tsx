"use client";

import dynamic from "next/dynamic";

import { deriveGcContent, parseResult, type AnalysisResult } from "../lib/result";
import { Empty, Panel, cx, formatDate } from "./primitives";

/**
 * Recharts measures the DOM, so it cannot be prerendered. `ssr: false` is only
 * honoured inside a Client Component, which is why this file is one -- moving
 * the import up to a Server Component would throw at build time.
 */
const CompositionChart = dynamic(
	() => import("./composition-chart").then((mod) => mod.CompositionChart),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-56 items-center justify-center text-xs text-zinc-400">
				Loading chart…
			</div>
		),
	},
);

/**
 * Renders one completed analysis.
 *
 * The payload is whatever the worker wrote, so this reads it field by field
 * (`parseResult`) and renders only what it recognises. Unrecognised keys are
 * still shown, and a payload with nothing recognisable falls back to raw JSON --
 * a demo should degrade to "here is the data" rather than to a blank panel.
 */
export function AnalysisResultView({
	resultJson,
	analysisType,
	createdAt,
}: {
	resultJson: Record<string, unknown>;
	analysisType: string;
	createdAt: string;
}) {
	const result = parseResult(resultJson);
	const derived = deriveGcContent(result.composition);
	const hasKnown = !result.empty;

	return (
		<div className="mt-3 flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
			{result.record ? <RecordCard record={result.record} /> : null}

			{result.gcContent !== undefined || derived !== undefined ? (
				<GcCard reported={result.gcContent} derived={derived} />
			) : null}

			{result.composition ? (
				<Panel title="Nucleotide composition" description="Counts per base.">
					<CompositionChart composition={result.composition} />
				</Panel>
			) : null}

			{result.orfs.length > 0 ? (
				<Panel
					title="Open reading frames"
					description={`${result.orfs.length} region${result.orfs.length === 1 ? "" : "s"} found.`}
				>
					<OrfTable rows={result.orfs} />
				</Panel>
			) : null}

			{result.blastHits.length > 0 ? (
				<Panel
					title="Similarity search"
					description={result.blastProgram ?? "BLAST"}
				>
					<HitTable rows={result.blastHits} />
				</Panel>
			) : null}

			{Object.keys(result.extra).length > 0 ? (
				<details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
					<summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
						Other fields ({Object.keys(result.extra).join(", ")})
					</summary>
					<pre className="overflow-auto border-t border-zinc-200 p-3 text-[11px] dark:border-zinc-800">
						{JSON.stringify(result.extra, null, 2)}
					</pre>
				</details>
			) : null}

			{/* Nothing the renderers claimed. Show the payload rather than nothing. */}
			{hasKnown ? null : (
				<pre className="max-h-64 overflow-auto rounded-lg bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
					{JSON.stringify(resultJson, null, 2)}
				</pre>
			)}

			<p className="text-[11px] leading-relaxed text-zinc-400">
				Computed by a deterministic tool. AI interpretation, where present, is a
				reasoning layer over these numbers, not the source of them. For research
				and education only — not a clinical or diagnostic tool.
			</p>

			<p className="text-[11px] text-zinc-400">
				{analysisType} · submitted {formatDate(createdAt)}
			</p>
		</div>
	);
}

function RecordCard({ record }: { record: NonNullable<AnalysisResult["record"]> }) {
	return (
		<div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
			<p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
				{record.id ?? "Unnamed record"}
			</p>
			{record.description ? (
				<p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">{record.description}</p>
			) : null}
			{record.length !== undefined ? (
				<p className="mt-1 text-xs text-zinc-500">
					{record.length.toLocaleString()} nucleotides
				</p>
			) : null}
		</div>
	);
}

/**
 * GC content, with a plain meter -- no chart library needed for one number.
 *
 * When the payload omits `gc_content` but carries a composition, the figure is
 * derived here. It is labelled as derived, because a number the client computed
 * must not be presented as one the tool reported.
 */
function GcCard({ reported, derived }: { reported?: number; derived?: number }) {
	const value = reported ?? derived;
	const isDerived = reported === undefined && derived !== undefined;
	if (value === undefined) return null;

	// 0-100 on a bar, clamped because a bad payload should not invert the meter.
	const width = Math.min(100, Math.max(0, value));

	return (
		<div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
			<div className="flex items-baseline justify-between">
				<p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">GC content</p>
				<p className="font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-50">
					{value.toFixed(1)}%
				</p>
			</div>
			<div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
				<div
					className="h-full rounded-full bg-emerald-500"
					style={{ width: `${width}%` }}
				/>
			</div>
			<p className="mt-1.5 text-[11px] text-zinc-500">
				{isDerived
					? "Derived from the base counts; the tool did not report this figure."
					: "Reported by the analysis tool."}
			</p>
		</div>
	);
}

function OrfTable({ rows }: { rows: NonNullable<AnalysisResult["orfs"]> }) {
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-xs">
				<thead className="text-zinc-500">
					<tr>
						<th className="py-1 pr-3 font-medium">Strand</th>
						<th className="py-1 pr-3 font-medium">Frame</th>
						<th className="py-1 pr-3 font-medium">Start</th>
						<th className="py-1 pr-3 font-medium">End</th>
						<th className="py-1 pr-3 font-medium">Length</th>
						<th className="py-1 font-medium">Codons</th>
					</tr>
				</thead>
				<tbody className="font-mono text-zinc-700 dark:text-zinc-200">
					{rows.map((orf, index) => (
						<tr key={`${orf.start}-${index}`} className="border-t border-zinc-100 dark:border-zinc-800">
							<td className="py-1 pr-3">{orf.strand ?? "—"}</td>
							<td className="py-1 pr-3">{orf.frame ?? "—"}</td>
							<td className="py-1 pr-3">{orf.start?.toLocaleString() ?? "—"}</td>
							<td className="py-1 pr-3">{orf.end?.toLocaleString() ?? "—"}</td>
							<td className="py-1 pr-3">{orf.length?.toLocaleString() ?? "—"}</td>
							<td className="py-1 text-zinc-500">
								{orf.startCodon ?? "—"}
								{orf.stopCodon ? ` … ${orf.stopCodon}` : ""}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function HitTable({ rows }: { rows: NonNullable<AnalysisResult["blastHits"]> }) {
	if (rows.length === 0) return <Empty>No hits returned.</Empty>;

	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-xs">
				<thead className="text-zinc-500">
					<tr>
						<th className="py-1 pr-3 font-medium">Accession</th>
						<th className="py-1 pr-3 font-medium">Identity</th>
						<th className="py-1 pr-3 font-medium">E-value</th>
						<th className="py-1 font-medium">Bit score</th>
					</tr>
				</thead>
				<tbody className="font-mono text-zinc-700 dark:text-zinc-200">
					{rows.map((hit, index) => (
						<tr key={hit.accession ?? index} className="border-t border-zinc-100 dark:border-zinc-800">
							<td className="py-1 pr-3">{hit.accession ?? "—"}</td>
							<td
								className={cx(
									"py-1 pr-3",
									hit.identity !== undefined && hit.identity < 90 ? "text-amber-600 dark:text-amber-400" : "",
								)}
							>
								{hit.identity !== undefined ? `${hit.identity.toFixed(1)}%` : "—"}
							</td>
							<td className="py-1 pr-3">
								{hit.eValue !== undefined ? formatEValue(hit.eValue) : "—"}
							</td>
							<td className="py-1">{hit.bitScore !== undefined ? hit.bitScore.toFixed(1) : "—"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** E-values span many orders of magnitude, so 0.0 needs to stay readable as 0. */
const formatEValue = (value: number) =>
	value === 0 ? "0" : value < 0.001 ? value.toExponential(2) : value.toFixed(4);
