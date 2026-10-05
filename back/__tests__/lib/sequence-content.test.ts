import { describe, expect, test } from "bun:test";

import { parseSequenceText } from "../../src/lib/sequence-content";

describe("parseSequenceText", () => {
test("reads a single-record FASTA and drops the header", () => {
		const line1 = "GATCCTCCATATACAACGGTTTCCACGGTTTCTGTGTTTCTGTGTTT";
		const line2 = "CTGTGTTTCTGTGTTT";
		const fasta = [
			">NC_000913.3 Escherichia coli str. K-12, complete genome",
			line1,
			line2,
		].join("\n");

		expect(parseSequenceText(fasta)).toBe(line1 + line2);
		expect(parseSequenceText(fasta)).toHaveLength(63);
	});

	test("keeps only the first record of a multi-record FASTA", () => {
		const multi = [">seq_one", "ACGTACGT", ">seq_two", "TTTTGGGG"].join("\n");

		// Concatenating records would produce a sequence that belongs to nothing,
		// and taking the last would silently analyse the wrong one.
		expect(parseSequenceText(multi)).toBe("ACGTACGT");
	});

	test("handles CRLF line endings", () => {
		const fasta = ">id\r\nACGT\r\nACGT\r\n";

		expect(parseSequenceText(fasta)).toBe("ACGTACGT");
	});

	test("ignores blank lines and internal whitespace", () => {
		const fasta = ">id\nACGT ACGT\n\n  ACGT  \n";

		expect(parseSequenceText(fasta)).toBe("ACGTACGT" + "ACGT");
		expect(parseSequenceText(fasta)).toHaveLength(12);
	});

	test("treats headerless content as a bare sequence", () => {
		// Real uploads hit this: `.txt`/`.csv` exports from spreadsheets and
		// instruments carry bases with no `>` header. The `private.fasta` rows in
		// the dev database are exactly this shape.
		expect(parseSequenceText("acgt")).toBe("acgt");
		expect(parseSequenceText("ACGT\nACGT\n")).toBe("ACGTACGT");
		expect(parseSequenceText("  ACGT  \r\n  ACGT  ")).toBe("ACGTACGT");
	});

	test("does not mistake non-sequence text for a bare sequence", () => {
		// Storage fixtures upload bodies like `direct-put-body`. Parsing cannot
		// reject these -- that judgement belongs to the IUPAC check in
		// resolveSequenceContent -- but it must not silently return "" and let the
		// caller believe the object was empty.
		expect(parseSequenceText("direct-put-body")).toBe("direct-put-body");
	});

	test("reads only the ORIGIN block of a GenBank record", () => {
		const origin1 = "gatcctccat atacaacggt ttccacggtt tctgtgtttc";
		const origin2 = "tgtgtttctg tgtttctgtg tttctgtgtt";
		const genbank = [
			"LOCUS       SCU49845     5028 bp    DNA             PLN       21-JUN-1999",
			"DEFINITION  Saccharomyces cerevisiae.",
			"FEATURES             Location/Qualifiers",
			"     source          1..5028",
			"     CDS             100..200",
			'                     /gene="abc"',
			"ORIGIN",
			`        1 ${origin1}`,
			`       51 ${origin2}`,
			"//",
		].join("\n");

		// The FEATURES coordinates (1..5028, 100..200) and the ORIGIN line numbers
		// must not appear as bases.
		expect(parseSequenceText(genbank)).toBe(
			origin1.replace(/ /g, "") + origin2.replace(/ /g, ""),
		);
		expect(parseSequenceText(genbank)).toHaveLength(70);
	});

	test("does not read GenBank sequence that appears before ORIGIN", () => {
		const genbank = [
			"LOCUS       TEST    10 bp",
			"DEFINITION  has stray bases ACGTACGTAC before the origin block",
			"ORIGIN",
			"        1 acgtacgtac",
			"//",
		].join("\n");

		expect(parseSequenceText(genbank)).toBe("acgtacgtac");
	});

	test("returns an empty string for input with no sequence", () => {
		expect(parseSequenceText("")).toBe("");
		expect(parseSequenceText("   \n\n  ")).toBe("");
		expect(parseSequenceText(">only_a_header")).toBe("");
		expect(parseSequenceText("LOCUS       TEST    1 bp")).toBe("");
	});

	test("preserves lowercase and every IUPAC ambiguity code", () => {
		const bases = "acgtryswkmbdhvnACGTRYSWKMBDHVN";

		expect(parseSequenceText(`>i\n${bases}\n`)).toBe(bases);
	});

	test("preserves unexpected characters so validation can reject them", () => {
		// Digits are stripped as line numbering; anything else non-IUPAC survives
		// parsing and is caught by the IUPAC check, rather than being deleted.
		expect(parseSequenceText(">i\nACGTX!ACGT")).toBe("ACGTX!ACGT");
	});

	test("stops at the second FASTA record instead of resetting", () => {
		const fasta = [">one", "ACGTACGTAC", ">two", "GGGGCCCC", ">three", "TTTTAAAA"].join(
			"\n",
		);

		// Resetting on each header would silently return the LAST record, which is
		// as wrong as concatenating them -- and wrong without any visible sign.
		expect(parseSequenceText(fasta)).toBe("ACGTACGTAC");
	});
});
