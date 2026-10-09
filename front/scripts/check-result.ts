/**
 * Checks `lib/result.ts` against the documented Bio API payloads and a handful
 * of malformed ones.
 *
 * There is no test framework in this project yet, so this is a plain script run
 * by `bun run check:result` -- zero new dependencies, non-zero exit on failure,
 * so CI can call it. The parser earns one because `result_json` is untyped
 * jsonb written by a service that does not exist yet: when the Bio Service
 * lands with a different shape, this is what tells us.
 */

import { deriveGcContent, parseResult } from "../lib/result";

/** The response exactly as written in the plan, section 4.11. */
const documented = {
	record: { id: "NC_XXXXXX", description: "Epinephelus bontoides mitochondrion", length: 16641 },
	composition: { A: 4890, T: 4670, G: 2610, C: 4471 },
	gc_content: 42.5,
	orfs: [],
};

/** The BLAST response exactly as written in the plan, section 4.12. */
const blastAsDocumented = {
	program: "blastn",
	hits: [{ accession: "NC_XXXXXX", identity: 99.1, e_value: 0.0, bit_score: 2401.0 }],
};

/**
 * Snake_case throughout, because the Bio Service is FastAPI (plan 3.3) and a
 * Python service emits snake_case by convention.
 */
const snakeCased = {
	record: { id: "NC_000001", length: 100 },
	composition: { A: 20, T: 20, G: 30, C: 30 },
	orfs: [
		{ start: 12, end: 311, length: 300, frame: 1, strand: "+", start_codon: "ATG", stop_codon: "TAA" },
		{ start: 400, end: 511, strand: "-", start_codon: "ATG" },
	],
	blast_program: "blastn",
	hits: [{ accession: "NC_002163", percent_identity: 99.1, evalue: 0, bits: 2401 }],
	custom_metadata: { pipeline: "v2" },
};

const onlyUnknownKeys = { foo: 1, bar: "two" };
const wrongTypes = { composition: "not-an-object", gc_content: "42.5", orfs: [null, 3, { start: "x" }] };

/** The normalised `translation` the backend writes for the `translate` tool. */
const translated = {
	translation: {
		protein_sequence: "MLQNR",
		protein_length: 5,
		nucleotide_length: 17,
		note: "Input length (17 nt) is not a multiple of 3; last 2 nucleotide(s) ignored.",
		contains_stop_codon: false,
	},
};

let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) {
		failures += 1;
		console.error(`FAIL  ${label}`);
		console.error(`      expected ${JSON.stringify(expected)}`);
		console.error(`      actual   ${JSON.stringify(actual)}`);
	}
};

const documentedResult = parseResult(documented);
check("record.id", documentedResult.record?.id, "NC_XXXXXX");
check("record.length", documentedResult.record?.length, 16641);
check("composition.A", documentedResult.composition?.A, 4890);
check("gc_content", documentedResult.gcContent, 42.5);
check("documented payload leaves nothing over", documentedResult.extra, {});
check("documented payload is understood", documentedResult.empty, false);

const blast = parseResult(blastAsDocumented);
check("blast program", blast.blastProgram, "blastn");
check("blast accession", blast.blastHits[0]?.accession, "NC_XXXXXX");
check("blast identity", blast.blastHits[0]?.identity, 99.1);
check("blast e_value", blast.blastHits[0]?.eValue, 0);
check("blast bit_score", blast.blastHits[0]?.bitScore, 2401);
check("blast payload leaves nothing over", blast.extra, {});

const snake = parseResult(snakeCased);
check("orf count", snake.orfs.length, 2);
check("orf start_codon", snake.orfs[0]?.startCodon, "ATG");
check("orf start_codon on partial row", snake.orfs[1]?.startCodon, "ATG");
check("blast_program", snake.blastProgram, "blastn");
check("percent_identity", snake.blastHits[0]?.identity, 99.1);
check("evalue", snake.blastHits[0]?.eValue, 0);
check("bits", snake.blastHits[0]?.bitScore, 2401);
// A consumed alias must not also surface as an unrecognised field, or the UI
// would render the same value twice.
check("consumed aliases do not leak into extra", snake.extra, { custom_metadata: { pipeline: "v2" } });

check("GC derived when only composition is given", deriveGcContent(snake.composition), 60);
check("GC not derivable without composition", deriveGcContent(null), undefined);
check("GC not derivable from an all-zero composition", deriveGcContent({ A: 0, T: 0, G: 0, C: 0 }), undefined);

const translation = parseResult(translated);
check("translation protein", translation.translation?.proteinSequence, "MLQNR");
check("translation protein length", translation.translation?.proteinLength, 5);
check("translation nucleotide length", translation.translation?.nucleotideLength, 17);
check("translation stop codon", translation.translation?.containsStopCodon, false);
check("translation note", translation.translation?.note?.startsWith("Input length"), true);
check("translation payload leaves nothing over", translation.extra, {});
check("translation payload is understood", translation.empty, false);

const unknown = parseResult(onlyUnknownKeys);
check("unknown keys are kept, not dropped", unknown.extra, { foo: 1, bar: "two" });
check("unknown keys still count as understood", unknown.empty, false);
check("a genuinely empty payload is empty", parseResult({}).empty, true);

const malformed = parseResult(wrongTypes);
check("malformed composition becomes null", malformed.composition, null);
check("a numeric string is not coerced into a number", malformed.gcContent, undefined);
check("malformed ORF list still yields readable rows", malformed.orfs.length, 1);

check("null payload", parseResult(null).empty, true);
check("array payload", parseResult([]).empty, true);
check("number payload", parseResult(7).empty, true);
check("string payload", parseResult("nope").empty, true);

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}

console.log("result parser: all checks passed");
