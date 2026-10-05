import { UnrecoverableError } from "bullmq";

import { runBioAnalysis } from "./bio-executor";
import { isLangflowEnabled, langflowConfigured, runLangflowAnalysis } from "./langflow-executor";
import type { AnalysisOutcome } from "./bio-executor";
import type { AnalysisJob } from "./queue";
import type { SequenceResolver } from "./sequence-content";

export type { AnalysisOutcome } from "./bio-executor";

const isUnrecoverable = (error: unknown): boolean =>
	error instanceof UnrecoverableError ||
	(error instanceof Error && error.name === "UnrecoverableError");

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Picks an executor and runs the analysis.
 *
 * Langflow is the primary executor because it produces the written
 * interpretation on top of the sequence maths. The Bio API is the deterministic
 * fallback: if Langflow is unreachable, times out, or is misconfigured, the user
 * still gets real numbers instead of a failed analysis.
 *
 * The fallback is deliberately broad. It covers config errors as well as
 * transient ones, because the two are indistinguishable from the user's side --
 * either way they have no result -- and a deterministic GC count is more useful
 * to them than an error message about a flow they cannot see or edit. Every
 * fallback is logged so a silently degraded Langflow does not go unnoticed.
 */
export const runAnalysis = async (
	job: AnalysisJob,
	resolve?: SequenceResolver,
): Promise<AnalysisOutcome> => {
	const langflowActive = isLangflowEnabled();

	if (langflowActive && !langflowConfigured()) {
		// Worth logging loudly: LANGFLOW_ENABLED=true with a missing flow id or key
		// means the operator believes Langflow is in use when it is not.
		console.warn(
			"[analysis] LANGFLOW_ENABLED is true but Langflow is incompletely configured; using the Bio Service fallback.",
		);
	}

	if (langflowActive && langflowConfigured()) {
		try {
			return await runLangflowAnalysis(job, resolve);
		} catch (error) {
			const unrecoverable = isUnrecoverable(error);

			console.error(
				`[analysis] Langflow failed (${unrecoverable ? "unrecoverable" : "transient"}); falling back to the Bio Service: ${describe(error)}`,
			);
		}
	}

	return runBioAnalysis(job, resolve);
};
