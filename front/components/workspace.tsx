"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { describeError, isApiConfigured, isUnauthorized } from "../lib/api";
import {
	getAnalysis,
	getAnalysisStatus,
	getMe,
	listConversations,
	listProjects,
	listSequences,
	logout as endSession,
	createProject,
	type Analysis,
	type Conversation,
	type Project,
	type Sequence,
	type User,
} from "../lib/genomics";
import { AnalysisBoard } from "./analysis-board";
import { AuthView } from "./auth-view";
import { NotesPanel } from "./notes-panel";
import { SequenceBoard } from "./sequence-board";
import { SequenceImport } from "./sequence-import";
import { Button, Empty, Field, Notice, Panel, cx, isPending } from "./primitives";

type Session = { state: "loading" } | { state: "anonymous" } | { state: "ready"; user: User };

/**
 * Tracked analysis ids survive a reload, keyed by project.
 *
 * The API has no endpoint that lists analyses, so without this a refresh would
 * permanently lose track of jobs that are still running. Only ids are stored —
 * never results — and the rows are always re-read from the server.
 */
const STORAGE_KEY = "gia.tracked-analyses";

const readTracked = (): Record<string, string[]> => {
	if (typeof window === "undefined") return {};
	try {
		const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
		if (!parsed || typeof parsed !== "object") return {};
		return Object.fromEntries(
			Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) =>
				Array.isArray(value) && value.every((v) => typeof v === "string") ? [[key, value]] : [],
			),
		);
	} catch {
		return {};
	}
};

const writeTracked = (tracked: Record<string, string[]>) => {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tracked));
	} catch {
		// A blocked or full storage quota is not worth failing the session over.
	}
};

export function Workspace() {
	// `NEXT_PUBLIC_API_URL` is inlined at build time, so this is a constant for
	// the life of the bundle. Resolving it in the initialiser keeps the missing
	// configuration from costing an extra render pass.
	const [session, setSession] = useState<Session>(() =>
		isApiConfigured ? { state: "loading" } : { state: "anonymous" },
	);
	const [fatal, setFatal] = useState<string | null>(null);

	useEffect(() => {
		if (!isApiConfigured) return;

		// The session is an HttpOnly cookie, so it can only be resolved by asking
		// the API. Both handlers below run in a promise callback, never
		// synchronously inside the effect body.
		getMe()
			.then((user) => setSession({ state: "ready", user }))
			.catch((error) => {
				// A rejected session is the normal signed-out path. Anything else
				// means the API is unreachable, and hiding that behind a login
				// form would send the user to type a password into a dead backend.
				if (isUnauthorized(error)) {
					setSession({ state: "anonymous" });
					return;
				}
				setFatal(describeError(error));
			});
	}, []);

	if (fatal) {
		return (
			<div className="mx-auto max-w-lg p-6">
				<Notice tone="error">{fatal}</Notice>
			</div>
		);
	}

	if (session.state === "loading") {
		return <p className="p-6 text-sm text-zinc-500">Checking your session…</p>;
	}

	if (session.state === "anonymous") {
		return (
			<AuthView
				onAuthenticated={(user) => {
					setFatal(null);
					setSession({ state: "ready", user });
				}}
			/>
		);
	}

	return <Dashboard user={session.user} onSignOut={() => setSession({ state: "anonymous" })} />;
}

function Dashboard({ user, onSignOut }: { user: User; onSignOut: () => void }) {
	const [projects, setProjects] = useState<Project[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [sequences, setSequences] = useState<Sequence[]>([]);
	const [messages, setMessages] = useState<Conversation[]>([]);
	const [tracked, setTracked] = useState<Record<string, string[]>>({});
	const [analyses, setAnalyses] = useState<Analysis[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [queueBlock, setQueueBlock] = useState<string | null>(null);

	const trackedIds = useMemo(
		() => (selectedId ? (tracked[selectedId] ?? []) : []),
		[selectedId, tracked],
	);
	const activeId = selectedId ?? projects[0]?.id ?? null;
	const project = projects.find((p) => p.id === activeId) ?? null;

	useEffect(() => {
		// localStorage does not exist during SSR, so the tracked ids can only be
		// read after mount. Deferred to a microtask to keep the state update out
		// of the effect body, which React flags as a cascading render.
		let cancelled = false;
		void Promise.resolve().then(() => {
			if (!cancelled) setTracked(readTracked());
		});
		return () => {
			cancelled = true;
		};
	}, []);

	/**
	 * Re-reads every tracked job. `GET /analyses/:id/status` is the cheap
	 * endpoint and is enough to see a job settle; only once it is terminal is
	 * the full row fetched, because that is the one carrying `resultJson`.
	 */
	const refreshAnalyses = useCallback(async () => {
		if (trackedIds.length === 0) {
			setAnalyses([]);
			return;
		}

		const rows = await Promise.all(
			trackedIds.map(async (id) => {
				const progress = await getAnalysisStatus(id);
				return progress.status === "queued" || progress.status === "processing"
					? null
					: await getAnalysis(id);
			}),
		);

		// A pending job still needs a row, otherwise the board would blink empty
		// between polls. The status endpoint is all that exists for one, so the
		// placeholder leaves the fields it cannot know blank rather than inventing
		// values the server never sent.
		const settled = rows.filter((row): row is Analysis => row !== null);
		const pending = await Promise.all(
			trackedIds
				.filter((id) => !settled.some((row) => row.id === id))
				.map((id) => getAnalysisStatus(id)),
		);

		setAnalyses([
			...settled,
			...pending.map<Analysis>((progress) => ({
				id: progress.id,
				sequenceId: "",
				analysisType: "",
				status: progress.status,
				queueJobId: progress.queueJobId,
				resultJson: null,
				errorMessage: progress.errorMessage,
				createdAt: progress.updatedAt,
				updatedAt: progress.updatedAt,
			})),
		]);
	}, [trackedIds]);

	const reloadSequences = useCallback(async () => {
		setSequences(activeId ? await listSequences(activeId) : []);
	}, [activeId]);

	const reloadMessages = useCallback(async () => {
		setMessages(activeId ? await listConversations(activeId) : []);
	}, [activeId]);

	/** Manual refresh behind the buttons. Separate from the mount effects below. */
	const refresh = useCallback(async () => {
		try {
			const [nextProjects, nextSequences, nextMessages] = await Promise.all([
				listProjects(),
				activeId ? listSequences(activeId) : Promise.resolve([]),
				activeId ? listConversations(activeId) : Promise.resolve([]),
			]);
			setProjects(nextProjects);
			setSequences(nextSequences);
			setMessages(nextMessages);
			await refreshAnalyses();
			setError(null);
		} catch (caught) {
			setError(describeError(caught));
		}
	}, [activeId, refreshAnalyses]);

	// Projects load once. `activeId` is derived rather than stored, so there is
	// no "pick the first project" effect to cascade a second render.
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const data = await listProjects();
				if (!cancelled) setProjects(data);
			} catch (caught) {
				if (!cancelled) setError(describeError(caught));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// Project-scoped data reloads when the selection changes. Every state update
	// sits past an `await`, so nothing here is a synchronous set in the effect.
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const [nextSequences, nextMessages] = await Promise.all([
					activeId ? listSequences(activeId) : Promise.resolve([]),
					activeId ? listConversations(activeId) : Promise.resolve([]),
				]);
				if (cancelled) return;
				setSequences(nextSequences);
				setMessages(nextMessages);
				setError(null);
			} catch (caught) {
				if (!cancelled) setError(describeError(caught));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [activeId]);

	// Poll only while something is actually in flight; a terminal board stops
	// the timer so an idle tab makes no requests.
	useEffect(() => {
		if (analyses.length === 0 || !analyses.some((a) => isPending(a.status))) return;
		const timer = window.setInterval(() => void refreshAnalyses(), 2000);
		return () => window.clearInterval(timer);
	}, [analyses, refreshAnalyses]);

	const track = useCallback(
		(projectId: string, analysisId: string) => {
			setTracked((current) => {
				const next = {
					...current,
					[projectId]: [...new Set([...(current[projectId] ?? []), analysisId])],
				};
				writeTracked(next);
				return next;
			});
		},
		[],
	);

	// The board cannot add the new id itself — tracking is per project and it
	// does not know which project is selected — so it reports the id back here.
	// Keyed on `activeId`, not `selectedId`: the first project is chosen by
	// derivation, so `selectedId` is still null the first time this runs.
	const onAnalysisQueued = useCallback(
		async (analysisId: string) => {
			if (activeId) track(activeId, analysisId);
			await refreshAnalyses();
		},
		[activeId, track, refreshAnalyses],
	);

	const sequenceLabels = useMemo(() => {
		const labels: Record<string, string> = {};
		for (const sequence of sequences) {
			labels[sequence.id] = sequence.originalFilename ?? sequence.recordId ?? "pasted sequence";
		}
		return labels;
	}, [sequences]);

	const signOut = async () => {
		try {
			await endSession();
		} finally {
			onSignOut();
		}
	};

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<Link
						href="/"
						className="text-lg font-semibold text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-50 dark:focus-visible:outline-zinc-100"
					>
						Genomic Insight
					</Link>
					<p className="text-xs text-zinc-500">Signed in as {user.name || user.email}</p>
				</div>
				<Button onClick={signOut}>Sign out</Button>
			</header>

			{error ? <Notice tone="error">{error}</Notice> : null}
			{queueBlock ? <Notice tone="info">{queueBlock}</Notice> : null}

			<ProjectPicker
				projects={projects}
				selectedId={activeId}
				onSelect={setSelectedId}
				onCreated={refresh}
			/>

			{loading ? (
				<p className="text-sm text-zinc-500">Loading…</p>
			) : !project ? (
				<Empty>Create a project to begin.</Empty>
			) : (
				<>
					<SequenceImport projectId={project.id} onImported={reloadSequences} />

					<SequenceBoard
						sequences={sequences}
						analysesBySequence={countBySequence(analyses)}
						canQueue={!queueBlock}
						onQueued={onAnalysisQueued}
						onSequencesChanged={reloadSequences}
						onQueueBlocked={setQueueBlock}
					/>

					<AnalysisBoard analyses={analyses} sequenceLabels={sequenceLabels} onRefresh={refresh} />

					<NotesPanel projectId={project.id} messages={messages} onChanged={reloadMessages} />
				</>
			)}
		</div>
	);
}

const countBySequence = (analyses: Analysis[]) => {
	const counts: Record<string, number> = {};
	for (const analysis of analyses) {
		if (analysis.sequenceId) counts[analysis.sequenceId] = (counts[analysis.sequenceId] ?? 0) + 1;
	}
	return counts;
};

function ProjectPicker({
	projects,
	selectedId,
	onSelect,
	onCreated,
}: {
	projects: Project[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onCreated: () => Promise<void>;
}) {
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const create = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setBusy(true);
		try {
			const project = await createProject(name.trim());
			setName("");
			await onCreated();
			onSelect(project.id);
		} catch (caught) {
			setError(describeError(caught));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Panel title="Projects">
			<div className="flex flex-col gap-3">
				{projects.length === 0 ? (
					<Empty>No projects yet.</Empty>
				) : (
					<div className="flex flex-wrap gap-2">
						{projects.map((item) => (
							<button
								key={item.id}
								type="button"
								onClick={() => onSelect(item.id)}
								aria-pressed={item.id === selectedId}
								className={cx(
									"rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
									item.id === selectedId
										? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
										: "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
								)}
							>
								{item.name}
							</button>
						))}
					</div>
				)}

				<form onSubmit={create} className="flex flex-wrap items-end gap-2">
					<div className="min-w-48 flex-1">
						<Field
							label="New project"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Mito study"
							disabled={busy}
							required
							maxLength={120}
						/>
					</div>
					<Button type="submit" variant="primary" disabled={busy || name.trim().length === 0}>
						{busy ? "Creating…" : "Create"}
					</Button>
				</form>

				{error ? <Notice tone="error">{error}</Notice> : null}
			</div>
		</Panel>
	);
}
