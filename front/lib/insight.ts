/**
 * A deliberately tiny Markdown reader for the Insight Analyst's prose.
 *
 * The model answers with a stable subset -- `**bold**`, `-`/`*` bullets,
 * numbered lists, occasional `#` headings and blank-line-separated paragraphs
 * -- and nothing else. Pulling in a full Markdown engine (and its HTML escape
 * hatch) to render that would trade a dependency and an XSS surface for syntax
 * this flow never emits. So it is parsed into a small block list here and
 * rendered as React elements, which cannot inject markup.
 *
 * It is intentionally not a general-purpose parser: anything it does not
 * recognise stays literal text rather than being dropped.
 */

export type InsightBlock =
	| { kind: "heading"; level: number; text: string }
	| { kind: "list"; ordered: boolean; items: string[] }
	| { kind: "paragraph"; text: string };

const headingPattern = /^(#{1,6})\s+(.*)$/;
const bulletPattern = /^[-*]\s+(.*)$/;
const orderedPattern = /^\d+[.)]\s+(.*)$/;

export const parseInsightBlocks = (markdown: string): InsightBlock[] => {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const blocks: InsightBlock[] = [];
	let paragraph: string[] = [];

	const flush = () => {
		if (paragraph.length === 0) return;
		// Single newlines are meaningful in this prose -- the model puts a bold
		// label on its own line above its body -- so keep them and render as
		// line breaks; blank lines are what separate paragraphs.
		blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
		paragraph = [];
	};

	for (const raw of lines) {
		const line = raw.trim();

		if (line.length === 0) {
			flush();
			continue;
		}

		const heading = headingPattern.exec(line);
		if (heading) {
			flush();
			blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
			continue;
		}

		const bullet = bulletPattern.exec(line);
		const ordered = orderedPattern.exec(line);
		if (bullet || ordered) {
			// A list always starts a new block, even if the previous item is
			// still open, so a paragraph before it is not swallowed.
			flush();

			const orderedList = Boolean(ordered);
			const item = (bullet?.[1] ?? ordered?.[1] ?? "").trim();
			const last = blocks[blocks.length - 1];

			if (last && last.kind === "list" && last.ordered === orderedList) {
				last.items.push(item);
			} else {
				blocks.push({ kind: "list", ordered: orderedList, items: [item] });
			}
			continue;
		}

		paragraph.push(line);
	}

	flush();
	return blocks;
};
