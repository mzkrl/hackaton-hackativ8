import { describe, expect, test } from "bun:test";

import { normalizeAnalysisOutcome } from "../../src/lib/normalize-result";

/**
 * These pin the one shape the frontend reads. The Bio Service speaks in tool
 * names (`calculate_gc_content`, `find_orfs`) and Langflow wraps its report in a
 * JSON Message, so both must land as the flat fields `front/lib/result.ts`
 * renders.
 */

const bioResults = {
	calculate_gc_content: {
		gc_content_percent: 56.4103,
		gc_count: 22,
		at_count: 17,
		total_length: 39,
	},
	calculate_nucleotide_composition: {
		counts: { A: 9, T: 8, G: 14, C: 8, U: 0, other: 0 },
		total_length: 39,
	},
	find_orfs: {
		total_orfs: 1,
		orfs: [
			{
				start: 3,
				end: 36,
				length: 33,
				strand: 1,
				frame: 1,
				sequence: "ATGAAACCCGGGTTTAAACCCATGGGGCCCTAG",
				protein: "MKPGFKPMGP",
			},
		],
	},
	translate_sequence: { protein_sequence: "MAIVMGR", protein_length: 7 },
};

describe("normalizeAnalysisOutcome", () => {
	test("flattens Bio tool results into the fields the frontend renders", () => {
		const out = normalizeAnalysisOutcome({ source: "bio_service", results: bioResults });

		expect(out.source).toBe("bio_service");
		expect(out.gc_content).toBe(56.4103);
		expect(out.composition).toEqual({ A: 9, T: 8, G: 14, C: 8 });
		expect(out.record).toEqual({ length: 39 });
		expect(out.orfs).toEqual([
			{
				start: 3,
				end: 36,
				length: 33,
				frame: 1,
				strand: "+",
				startCodon: "ATG",
				stopCodon: "TAG",
			},
		]);

		// Flattened tools must not also appear as opaque blobs ...
		expect(out.calculate_gc_content).toBeUndefined();
		expect(out.calculate_nucleotide_composition).toBeUndefined();
		expect(out.find_orfs).toBeUndefined();
		expect(out.translate_sequence).toBeUndefined();
		// ... and the translated protein is lifted into its own field.
		expect(out.translation).toEqual({ protein_sequence: "MAIVMGR", protein_length: 7 });
	});

	test("lifts the translation's note and stop-codon flag", () => {
		const out = normalizeAnalysisOutcome({
			source: "bio_service",
			results: {
				translate_sequence: {
					protein_sequence: "LQNR",
					protein_length: 132,
					nucleotide_length: 5242,
					translation_note: "Input length (5242 nt) is not a multiple of 3; last 1 nucleotide(s) ignored.",
					contains_stop_codon: true,
				},
			},
		});

		expect(out.translation).toEqual({
			protein_sequence: "LQNR",
			protein_length: 132,
			nucleotide_length: 5242,
			note: "Input length (5242 nt) is not a multiple of 3; last 1 nucleotide(s) ignored.",
			contains_stop_codon: true,
		});
	});

	test("reads the sequence length off the composition tool too", () => {
		// at_content runs only the composition tool, whose length lives on
		// `total_length` rather than `sequence_statistics`.
		const out = normalizeAnalysisOutcome({
			source: "bio_service",
			results: {
				calculate_nucleotide_composition: {
					counts: { A: 1, T: 2, G: 3, C: 4 },
					total_length: 10,
				},
			},
		});

		expect(out.composition).toEqual({ A: 1, T: 2, G: 3, C: 4 });
		expect(out.record).toEqual({ length: 10 });
	});

	test("reads the structured report out of Langflow run outputs", () => {
		const report = {
			user_question: "gc_content",
			analysis_results: {
				calculate_gc_content: { gc_content_percent: 51, total_length: 40 },
			},
		};

		const out = normalizeAnalysisOutcome({
			source: "langflow",
			outputs: [JSON.stringify(report)],
		});

		expect(out.source).toBe("langflow");
		expect(out.gc_content).toBe(51);
		expect(out.record).toEqual({ length: 40 });
	});

	test("keeps the insight prose separate from the structured result", () => {
		const report = {
			user_question: "gc_content",
			analysis_results: {
				calculate_gc_content: { gc_content_percent: 51, total_length: 40 },
			},
		};

		const out = normalizeAnalysisOutcome({
			source: "langflow",
			outputs: [JSON.stringify(report), "The GC content is 51%."],
		});

		expect(out.gc_content).toBe(51);
		expect(out.insight).toBe("The GC content is 51%.");
	});

	test("treats a prose-only Langflow output as insight, not structure", () => {
		const out = normalizeAnalysisOutcome({ source: "langflow", outputs: ["Just some text."] });

		expect(out.insight).toBe("Just some text.");
		expect(out.gc_content).toBeUndefined();
	});

	test("does not fabricate a composition when a base is missing", () => {
		const out = normalizeAnalysisOutcome({
			source: "bio_service",
			results: { calculate_nucleotide_composition: { counts: { A: 1, T: 2, G: 3 } } },
		});

		// A chart of three real bars plus a phantom C=0 is worse than no chart.
		expect(out.composition).toBeUndefined();
	});

	test("passes an unrecognised payload through unchanged", () => {
		const out = normalizeAnalysisOutcome({ source: "bio_service", results: { weird: true } });

		expect(out).toEqual({ source: "bio_service", weird: true });
	});
});
