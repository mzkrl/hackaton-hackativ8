import type { ReactNode } from "react";

import { parseInsightBlocks } from "../lib/insight";
import { cx } from "./primitives";

/**
 * Renders the Insight Analyst's prose.
 *
 * Inline spans (`**bold**`, `*italic*`, `` `code` ``) become React elements --
 * never `dangerouslySetInnerHTML` -- because the text is model output and must
 * not be treated as markup.
 */

/** Matches the strongest inline span first so `**bold**` is not read as italic. */
const inlinePattern = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;

const renderInline = (text: string, keyPrefix: string): ReactNode[] => {
	const nodes: ReactNode[] = [];
	let last = 0;
	let index = 0;

	for (const match of text.matchAll(inlinePattern)) {
		const start = match.index ?? 0;
		if (start > last) nodes.push(text.slice(last, start));

		const token = match[0];
		const key = `${keyPrefix}-${index}`;
		index += 1;

		if (token.startsWith("**")) {
			nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
		} else if (token.startsWith("`")) {
			nodes.push(
				<code
					key={key}
					className="rounded bg-shell px-1 py-0.5 font-mono text-[0.95em] dark:bg-night"
				>
					{token.slice(1, -1)}
				</code>,
			);
		} else {
			nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
		}

		last = start + token.length;
	}

	if (last < text.length) nodes.push(text.slice(last));
	return nodes;
};

/** Paragraph text, with preserved single newlines rendered as line breaks. */
const renderParagraph = (text: string, keyPrefix: string): ReactNode[] => {
	const lines = text.split("\n");
	const nodes: ReactNode[] = [];

	lines.forEach((line, index) => {
		if (index > 0) nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
		nodes.push(...renderInline(line, `${keyPrefix}-${index}`));
	});

	return nodes;
};

export function InsightMarkdown({ text }: { text: string }) {
	const blocks = parseInsightBlocks(text);

	return (
		<div className="flex flex-col gap-2 text-xs leading-relaxed text-forest dark:text-night-text">
			{blocks.map((block, blockIndex) => {
				if (block.kind === "heading") {
					return (
						<p
							key={blockIndex}
							className={cx(block.level <= 2 ? "text-sm" : "text-xs", "font-semibold")}
						>
							{renderInline(block.text, `h${blockIndex}`)}
						</p>
					);
				}

				if (block.kind === "list") {
					const List = block.ordered ? "ol" : "ul";
					return (
						<List
							key={blockIndex}
							className={cx(
								"flex flex-col gap-1 pl-4",
								block.ordered ? "list-decimal" : "list-disc",
							)}
						>
							{block.items.map((item, itemIndex) => (
								<li key={itemIndex}>{renderInline(item, `l${blockIndex}-${itemIndex}`)}</li>
							))}
						</List>
					);
				}

				return <p key={blockIndex}>{renderParagraph(block.text, `p${blockIndex}`)}</p>;
			})}
		</div>
	);
}
