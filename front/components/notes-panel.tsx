"use client";

import { useState } from "react";

import { describeError } from "../lib/api";
import { appendConversation, type Conversation } from "../lib/genomics";
import { Button, Empty, Notice, Panel, TextArea, cx, formatDate } from "./primitives";

/**
 * The per-project message log.
 *
 * `role` and `content` are both free-form on the backend, which is why the
 * picker is limited to the two roles this UI actually writes while the reader
 * renders whatever is stored. There is no assistant behind this: `POST
 * /conversations` only appends a row, it does not generate a reply.
 */
export function NotesPanel({
	projectId,
	messages,
	onChanged,
}: {
	projectId: string;
	messages: Conversation[];
	onChanged: () => void;
}) {
	const [role, setRole] = useState("user");
	const [content, setContent] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setBusy(true);
		try {
			await appendConversation({ projectId, role, content: content.trim() });
			setContent("");
			onChanged();
		} catch (caught) {
			setError(describeError(caught));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Panel title="Notes" description="Lab notes attached to this project.">
			<div className="flex flex-col gap-4">
				{messages.length === 0 ? (
					<Empty>No notes yet.</Empty>
				) : (
					<ul className="flex max-h-72 flex-col gap-2 overflow-auto pr-1">
						{messages.map((message) => (
							<li
								key={message.id}
								className={cx(
									"rounded-lg border px-3 py-2",
									message.role === "user"
										? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
										: "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
								)}
							>
								<p className="flex items-baseline gap-2">
									<span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
										{message.role}
									</span>
									<span className="text-[11px] text-zinc-400">{formatDate(message.createdAt)}</span>
								</p>
								<p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">
									{message.content}
								</p>
							</li>
						))}
					</ul>
				)}

				<form onSubmit={submit} className="flex flex-col gap-2">
					<TextArea
						label="Add a note"
						rows={3}
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder="Observed a 41% GC content in the control arm."
						disabled={busy}
						required
						maxLength={100000}
					/>

					{error ? <Notice tone="error">{error}</Notice> : null}

					<div className="flex items-center gap-2">
						<label className="sr-only" htmlFor={`role-${projectId}`}>
							Role
						</label>
						<select
							id={`role-${projectId}`}
							value={role}
							onChange={(e) => setRole(e.target.value)}
							disabled={busy}
							className={cx(
								"rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs",
								"focus:border-zinc-500 focus:outline-none disabled:opacity-50",
								"dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100",
							)}
						>
							<option value="user">user</option>
							<option value="assistant">assistant</option>
							<option value="note">note</option>
						</select>
						<Button type="submit" variant="primary" disabled={busy || content.trim().length === 0}>
							{busy ? "Saving…" : "Add note"}
						</Button>
					</div>
				</form>
			</div>
		</Panel>
	);
}
