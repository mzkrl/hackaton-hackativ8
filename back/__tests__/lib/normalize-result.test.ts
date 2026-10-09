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

	test("flattens the statistics, type, features and validation tools", () => {
		const out = normalizeAnalysisOutcome({
			source: "bio_service",
			results: {
				sequence_statistics: {
					length: 5242,
					base_counts: { A: 1316, C: 1098, G: 1288, T: 1540 },
					unique_bases: 4,
					most_frequent_base: "T",
					least_frequent_base: "C",
					ambiguous_base_count: 0,
				},
				detect_sequence_type: {
					reasoning: "Thymine (T) present without Uracil (U) - characteristic of DNA.",
					confidence: "high",
					has_dna_chars: true,
					has_rna_chars: false,
					sequence_type: "DNA",
					has_protein_only_chars: false,
				},
				extract_sequence_features: {
					length: 5242,
					summary: "Type: DNA (high confidence). Length: 5242 residues.",
					is_valid: true,
					base_counts: { A: 1316, C: 1098, G: 1288, T: 1540 },
					sequence_type: "DNA",
					type_confidence: "high",
					gc_content_percent: 45.517,
					invalid_characters: [],
					most_frequent_base: "T",
					ambiguous_base_count: 0,
				},
				validate_sequence: {
					is_valid: true,
					iupac_dna_valid: true,
					iupac_rna_valid: false,
					sequence_length: 5242,
					invalid_characters: [],
					validation_message: "Sequence contains only valid IUPAC characters.",
					iupac_protein_valid: true,
				},
			},
		});

		expect(out.sequence_statistics).toEqual({
			length: 5242,
			base_counts: { A: 1316, T: 1540, G: 1288, C: 1098 },
			unique_bases: 4,
			most_frequent_base: "T",
			least_frequent_base: "C",
			ambiguous_base_count: 0,
		});
		expect(out.sequence_type).toEqual({
			sequence_type: "DNA",
			confidence: "high",
			reasoning: "Thymine (T) present without Uracil (U) - characteristic of DNA.",
			has_dna_chars: true,
			has_rna_chars: false,
			has_protein_only_chars: false,
		});
		expect(out.sequence_features).toEqual({
			summary: "Type: DNA (high confidence). Length: 5242 residues.",
			length: 5242,
			is_valid: true,
			sequence_type: "DNA",
			type_confidence: "high",
			gc_content_percent: 45.517,
			base_counts: { A: 1316, T: 1540, G: 1288, C: 1098 },
			most_frequent_base: "T",
			ambiguous_base_count: 0,
			invalid_characters: [],
		});
		expect(out.validation).toEqual({
			is_valid: true,
			iupac_dna_valid: true,
			iupac_rna_valid: false,
			iupac_protein_valid: true,
			sequence_length: 5242,
			invalid_characters: [],
			message: "Sequence contains only valid IUPAC characters.",
		});

		// GC% and length are also lifted into the shared fields.
		expect(out.gc_content).toBe(45.517);
		expect(out.record).toEqual({ length: 5242 });

		// ... and none of the flattened tools survive as opaque blobs.
		expect(out.sequence_statistics).toBeDefined();
		expect(out.detect_sequence_type).toBeUndefined();
		expect(out.extract_sequence_features).toBeUndefined();
		expect(out.validate_sequence).toBeUndefined();
	});

	test("falls back to statistics base counts for the composition chart", () => {
		const out = normalizeAnalysisOutcome({
			source: "bio_service",
			results: {
				sequence_statistics: { length: 10, base_counts: { A: 1, T: 2, G: 3, C: 4 } },
			},
		});

		expect(out.composition).toEqual({ A: 1, T: 2, G: 3, C: 4 });
	});

	test("strips the residue text out of parse_fasta records", () => {
		const out = normalizeAnalysisOutcome({
			source: "bio_service",
			results: {
				parse_fasta: {
					records: [
						{
							id: "sequence_1",
							length: 12,
							sequence: "ACGTACGTACGT",
							description: "sequence_1 raw input",
						},
						{ id: "sequence_2", sequence: "ACGT", description: "raw input" },
					],
					total_records: 2,
				},
			},
		});

		expect(out.fasta).toEqual({
			total_records: 2,
			records: [
				{ id: "sequence_1", length: 12, description: "sequence_1 raw input" },
				{ id: "sequence_2", length: 4, description: "raw input" },
			],
		});
		expect(out.parse_fasta).toBeUndefined();
		// The residue text must not survive into the stored payload.
		expect(JSON.stringify(out)).not.toContain("ACGTACGTACGT");
	});
});
