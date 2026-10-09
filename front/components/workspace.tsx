"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { describeError, isApiConfigured, isUnauthorized } from "../lib/api";
import {
	claimGuest,
	clearGuestToken,
	getAnalysis,
	getAnalysisStatus,
	getMe,
	listConversations,
	listProjects,
	listSequences,
	logout as endSession,
	createProject,
	readGuestToken,
	type Analysis,
	type Conversation,
	type Principal,
	type Project,
	type Sequence,
	type User,
} from "../lib/genomics";
import { AnalysisBoard } from "./analysis-board";
import { AppShell } from "./app-shell";
import { AuthView } from "./auth-view";
import { LogInIcon, LogOutIcon, PlusIcon } from "./brand";
import { NotesPanel } from "./notes-panel";
import { SequenceBoard } from "./sequence-board";
import { SequenceImport } from "./sequence-import";
import { Button, Empty, Field, Notice, Panel, Skeleton, SkeletonRows, cx, isPending } from "./primitives";

type Session =
	| { state: "loading" }
	| { state: "anonymous" }
	| { state: "ready"; principal: Principal };

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
			.then((principal) => setSession({ state: "ready", principal }))
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

	// The session lives in an HttpOnly cookie, so "am I signed in" can only be
	// answered by the API from the browser. This is a real round trip on every
	// load of /workspace, so it gets a placeholder rather than a spinner: the
	// workspace below keeps its shape and the page does not jump once it lands.
	//
	// The shell is rendered in all three states so the chrome does not move when
	// the session resolves — wordmark and sidebar in place, only the middle
	// column swaps.
	if (session.state === "loading") {
		return (
			<AppShell>
				<div className="mx-auto w-full max-w-3xl p-4">
					<Skeleton className="h-4 w-40" />
					<div className="mt-6 flex flex-col gap-3">
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-24 w-full" />
					</div>
				</div>
			</AppShell>
		);
	}

	if (session.state === "anonymous") {
		return (
			// No `login` prop: the login form *is* the content here, so a second
			// sign-in call above it would be a duplicate control.
			<AppShell>
				<AuthView
					onAuthenticated={(user) => {
						setFatal(null);
						setSession({ state: "ready", principal: { kind: "user", user } });
					}}
onGuest={(guest) => {
					setFatal(null);
					setSession({ state: "ready", principal: guest });
				}}
				/>
			</AppShell>
		);
	}

	if (session.principal.kind === "guest") {
		return <GuestDashboard expiresAt={session.principal.expiresAt} />;
	}

	return (
		<Dashboard
			user={session.principal.user}
			onSignOut={() => setSession({ state: "anonymous" })}
		/>
	);
}

/**
 * All the data a dashboard shows, however the visitor is signed in.
 *
 * Extracted so a guest dashboard and a user dashboard share one implementation.
 * The two differ only in what they put at the top — a "sign up to save" banner
 * versus an account block — and not in how they load or refresh anything.
 */
function useDashboardData() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [sequences, setSequences] = useState<Sequence[]>([]);
	const [messages, setMessages] = useState<Conversation[]>([]);
	const [tracked, setTracked] = useState<Record<string, string[]>>({});
	const [analyses, setAnalyses] = useState<Analysis[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [queueBlock, setQueueBlock] = useState<string | null>(null);

	/**
	 * The project the dashboards describe.
	 *
	 * `selectedId` is null until the visitor picks a project, so it falls back to
	 * the first one. `trackedIds` keys on this, not on the raw `selectedId`: queue
	 * an analysis on a fresh load and it is tracked under `projects[0].id`, while a
	 * `selectedId`-keyed lookup would read `tracked[null]` -- empty -- and the
	 * analysis would never appear.
	 */
	const activeId = selectedId ?? projects[0]?.id ?? null;
	const trackedIds = useMemo(
		() => (activeId ? (tracked[activeId] ?? []) : []),
		[activeId, tracked],
	);
	const project = projects.find((p) => p.id === activeId) ?? null;

	useEffect(() => {
		let cancelled = false;
		void Promise.resolve().then(() => {
			if (!cancelled) setTracked(readTracked());
		});
		return () => {
			cancelled = true;
		};
	}, []);

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

	/**
	 * Load the tracked analyses for the active project whenever the effective
	 * project (or its track list) changes -- including on mount.
	 *
	 * Without this the board only ever filled after a manual Refresh, and the
	 * Refresh button is disabled while the board is empty, so a reload left it
	 * permanently blank. Queueing had the same shape of bug: `track()` schedules a
	 * state update, so the `refreshAnalyses` in the caller's closure still used the
	 * pre-queue id list; re-running here picks up the committed list.
	 */
	useEffect(() => {
		// Deferred a tick so the state updates happen in a callback, not
		// synchronously in the effect body -- the rule the tracked-load effect above
		// also works around.
		void Promise.resolve().then(() => refreshAnalyses());
	}, [refreshAnalyses]);

	const reloadSequences = useCallback(async () => {
		setSequences(activeId ? await listSequences(activeId) : []);
	}, [activeId]);

	const reloadMessages = useCallback(async () => {
		setMessages(activeId ? await listConversations(activeId) : []);
	}, [activeId]);

	/**
	 * Reload everything.
	 *
	 * Takes an optional `projectId` so a caller that already knows which project it
	 * wants -- project creation, in practice -- can refresh against that one. The
	 * captured `activeId` is no use there: `setSelectedId` has not been committed
	 * by the time such a caller wants to reload, so reading `activeId` fetches the
	 * *previous* project's sequences and notes and leaves them on screen.
	 */
	const refresh = useCallback(
		async (projectId?: string) => {
			const target = projectId ?? activeId;
			try {
				const [nextProjects, nextSequences, nextMessages] = await Promise.all([
					listProjects(),
					target ? listSequences(target) : Promise.resolve([]),
					target ? listConversations(target) : Promise.resolve([]),
				]);
				setProjects(nextProjects);
				// Pin the selection to what was actually fetched, so the boards and
				// the highlighted row can never describe two different projects.
				if (target) setSelectedId(target);
				setSequences(nextSequences);
				setMessages(nextMessages);
				await refreshAnalyses();
				setError(null);
			} catch (caught) {
				setError(describeError(caught));
			}
		},
		[activeId, refreshAnalyses],
	);

	/**
	 * Create a project and make it the selected one.
	 *
	 * The order is the entire fix. Reloading first and selecting afterwards renders
	 * the previous project's sequences, analyses and notes for a beat, which is
	 * exactly what read as "creating a new project just points at the last one".
	 * Refreshing *against the new id* means the boards that appear are already the
	 * new project's, and there is no window in which the old data is on screen.
	 *
	 * `createProject` is allowed to throw so the caller's form can show the message
	 * next to the input that caused it; `refresh` reports its own failures through
	 * the banner instead.
	 */
	const createAndSelect = useCallback(
		async (name: string) => {
			const created = await createProject(name.trim());
			await refresh(created.id);
			return created;
		},
		[refresh],
	);

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

	const untrack = useCallback(
		(projectId: string, analysisId: string) => {
			setTracked((current) => {
				const next = {
					...current,
					[projectId]: (current[projectId] ?? []).filter((id) => id !== analysisId),
				};
				writeTracked(next);
				return next;
			});
		},
		[],
	);

	const onAnalysisQueued = useCallback(
		async (analysisId: string) => {
			if (activeId) track(activeId, analysisId);
			await refreshAnalyses();
		},
		[activeId, track, refreshAnalyses],
	);

	/**
	 * Drops a deleted analysis from the tracked list.
	 *
	 * No refresh is issued here on purpose: `refreshAnalyses` closes over the
	 * pre-delete id list, so calling it now would poll an id that no longer
	 * exists and 404. The `refreshAnalyses` identity changes with `trackedIds`,
	 * and the load effect re-runs against the list that no longer has the id.
	 */
	const onAnalysisDeleted = useCallback(
		(analysisId: string) => {
			if (activeId) untrack(activeId, analysisId);
		},
		[activeId, untrack],
	);

	const sequenceLabels = useMemo(() => {
		const labels: Record<string, string> = {};
		for (const sequence of sequences) {
			labels[sequence.id] = sequence.originalFilename ?? sequence.recordId ?? "pasted sequence";
		}
		return labels;
	}, [sequences]);

	return {
		projects,
		selectedId,
		setSelectedId,
		sequences,
		messages,
		tracked,
		analyses,
		error,
		loading,
		queueBlock,
		setQueueBlock,
		refresh,
		refreshAnalyses,
		createAndSelect,
		reloadSequences,
		reloadMessages,
		track,
		onAnalysisQueued,
		onAnalysisDeleted,
		activeId,
		project,
		sequenceLabels,
	};
}

type DashboardData = ReturnType<typeof useDashboardData>;

function DashboardContent({
	user,
	onSignOut,
	onSignUp,
	banner,
	...data
}: {
	user?: User;
	onSignOut?: () => void;
	onSignUp?: () => void;
	/** Rendered inside the shell, above the notices. */
	banner?: ReactNode;
} & DashboardData) {
	const {
		projects,
		setSelectedId,
		sequences,
		messages,
		analyses,
		error,
		loading,
		queueBlock,
		setQueueBlock,
		refresh,
		reloadSequences,
		reloadMessages,
		onAnalysisQueued,
		onAnalysisDeleted,
		activeId,
		project,
		sequenceLabels,
		createAndSelect,
	} = data;

	/**
	 * Signing out has to clear the server session, not just the local state.
	 *
	 * Resetting state alone would leave the cookie in place, and the next
	 * `getMe()` would hand the same account straight back — which reads as the
	 * button not working. The local reset happens either way, so a failed request
	 * still leaves a usable logged-out screen.
	 */
	/**
	 * The sidebar gets a ref to this so the "New project" action above it can put
	 * the caret in the field rather than being another control that scrolls to
	 * somewhere and leaves the user to work out what to do next.
	 */
	const newProjectRef = useRef<HTMLInputElement>(null);

	const signOut = async () => {
		try {
			await endSession();
		} finally {
			onSignOut?.();
		}
	};

	return (
		<AppShell
			action={{
				label: "New project",
				onClick: () => newProjectRef.current?.focus(),
				icon: <PlusIcon className="size-4" />,
			}}
			/*
			 * The projects list. This slot used to be passed nothing at all, so the
			 * sidebar rendered an empty scroll area between the nav and the footer --
			 * the projects existed, they were simply never drawn anywhere in the
			 * sidebar, which is why creating one appeared to do nothing.
			 */
			recent={
				<SidebarProjects
					projects={projects}
					selectedId={activeId}
					onSelect={setSelectedId}
					onCreate={createAndSelect}
					nameRef={newProjectRef}
				/>
			}
			account={
				user
					? {
							name: user.name || user.email,
							detail: user.email,
							action: {
								label: "Sign out",
								onClick: () => void signOut(),
								icon: <LogOutIcon className="size-3.5" />,
							},
						}
					: {
							name: "Guest",
							detail: "Work is saved on this device",
							action: {
								label: "Sign up to save",
								onClick: () => onSignUp?.(),
								icon: <LogInIcon className="size-3.5" />,
							},
						}
			}
		>
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8">
				{banner}
				{error ? <Notice tone="error">{error}</Notice> : null}
				{queueBlock ? <Notice tone="info">{queueBlock}</Notice> : null}

				<ProjectPicker
					projects={projects}
					selectedId={activeId}
					onSelect={setSelectedId}
					onCreate={createAndSelect}
				/>

				{loading ? (
					<div className="flex flex-col gap-3">
						<Panel title="Sequences" description="Loading your sequences…">
							<SkeletonRows rows={3} />
						</Panel>
						<Panel title="Analyses" description="Loading analysis history…">
							<SkeletonRows rows={2} />
						</Panel>
					</div>
				) : !project ? (
					<Empty>Create a project to begin.</Empty>
				) : (
					<>
						<div id="new-analysis" className="scroll-mt-24">
							<SequenceImport projectId={project.id} onImported={reloadSequences} />
						</div>

						<SequenceBoard
							sequences={sequences}
							analysesBySequence={countBySequence(analyses)}
							canQueue={!queueBlock}
							onQueued={onAnalysisQueued}
							onSequencesChanged={reloadSequences}
							onQueueBlocked={setQueueBlock}
						/>

						<AnalysisBoard
							analyses={analyses}
							sequenceLabels={sequenceLabels}
							onRefresh={refresh}
							onQueued={onAnalysisQueued}
							onDeleted={onAnalysisDeleted}
						/>

						<NotesPanel projectId={project.id} messages={messages} onChanged={reloadMessages} />
					</>
				)}
			</div>
		</AppShell>
	);
}

function Dashboard({ user, onSignOut }: { user: User; onSignOut: () => void }) {
	return <DashboardContent user={user} onSignOut={onSignOut} {...useDashboardData()} />;
}

/**
 * The guest dashboard.
 *
 * Same data, same boards as a signed-in user — a guest is a real principal, not
 * a degraded one. The difference is the banner: work created as a guest lives
 * in a session that expires, so the one thing the UI has to make impossible to
 * miss is that signing up is what makes it permanent.
 */
function GuestDashboard({ expiresAt }: { expiresAt: string }) {
	const [showAuth, setShowAuth] = useState(false);
	const [claiming, setClaiming] = useState(false);
	const [claimError, setClaimError] = useState<string | null>(null);

	// Unconditional and first: the sign-up form and the dashboard are two branches
	// of the same component, so a hook called after the early return below would
	// change hook order the moment the visitor opens the form — which React
	// treats as a different component and unmounts the tree underneath.
	const data = useDashboardData();

	/**
	 * Signing up replaces the session cookie, so the guest work has to be moved
	 * across explicitly using the token kept in local storage.
	 *
	 * The token is only cleared once the server confirms the move. Clearing it on
	 * failure would be the worst possible outcome: the visitor would be looking at
	 * a signed-in account with none of their data, and the guest rows would be
	 * unreachable forever because the one key that could claim them is gone. So a
	 * failed claim keeps the token and offers a retry.
	 */
	const claimIntoAccount = async () => {
		const guestId = readGuestToken();

		if (!guestId) {
			setShowAuth(false);
			return;
		}

		setClaiming(true);
		setClaimError(null);

		try {
			await claimGuest(guestId);
			clearGuestToken();
			// The session changed identity, so the cheapest correct way to pick up
			// the new owner on every already-mounted board is a fresh load.
			window.location.reload();
		} catch (caught) {
			setClaimError(describeError(caught));
			setClaiming(false);
		}
	};

	if (showAuth) {
		return (
			<AppShell>
				<div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
					{claimError ? (
						<Notice tone="error">
							<p>{claimError}</p>
							<p className="mt-2">
								Your guest work has <strong>not</strong> been moved yet, and it is still here. Try again.
							</p>
							<button
								type="button"
								className="mt-3 underline"
								disabled={claiming}
								onClick={() => void claimIntoAccount()}
							>
								{claiming ? "Moving your work…" : "Retry"}
							</button>
						</Notice>
					) : null}
					<AuthView
						onAuthenticated={() => void claimIntoAccount()}
						onGuest={() => setShowAuth(false)}
					/>
				</div>
			</AppShell>
		);
	}

	return (
		<DashboardContent
			onSignUp={() => setShowAuth(true)}
			banner={
				<Notice tone="info">
					You are working as a guest{expirySuffix(expiresAt)}. Your work is saved on this device and
					is temporary — create an account to keep it.
				</Notice>
			}
			{...data}
		/>
	);
}

/**
 * "until <date>" for a guest session, omitted when the server sent no expiry.
 *
 * Deliberately says nothing rather than rendering a blank or an "Invalid Date":
 * the banner's whole job is to be honest about how long the work survives.
 */
function expirySuffix(expiresAt: string) {
	if (!expiresAt) return "";

	const until = new Date(expiresAt);

	if (Number.isNaN(until.getTime())) return "";

	return ` until ${until.toLocaleDateString()}`;
}

const countBySequence = (analyses: Analysis[]) => {
	const counts: Record<string, number> = {};
	for (const analysis of analyses) {
		if (analysis.sequenceId) counts[analysis.sequenceId] = (counts[analysis.sequenceId] ?? 0) + 1;
	}
	return counts;
};

/**
 * Shared plumbing for the two places a project can be created.
 *
 * Both the sidebar and the main panel submit a name and get the same
 * `onCreate(name)` back, so there is exactly one definition of what "creating a
 * project" does to the screen -- and it is `createAndSelect` in `useDashboardData`,
 * which refreshes against the new id. Neither form does its own reload.
 */
function useProjectCreator(onCreate: (name: string) => Promise<Project>) {
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		const trimmed = name.trim();
		// Guarded here as well as on the button: Enter reaches submit directly.
		if (trimmed.length === 0 || busy) return;

		setError(null);
		setBusy(true);
		try {
			await onCreate(trimmed);
			setName("");
		} catch (caught) {
			// The name is deliberately left in the field: losing it would make a
			// failure -- a quota rejection, most likely -- cost the user their typing.
			setError(describeError(caught));
		} finally {
			setBusy(false);
		}
	};

	return { name, setName, error, busy, submit };
}

/**
 * The sidebar's project list, plus the inline form that creates one.
 *
 * `aria-current="page"` on the selected row rather than a colour alone, since the
 * selected row is the only thing telling the user which project the boards below
 * belong to.
 */
function SidebarProjects({
	projects,
	selectedId,
	onSelect,
	onCreate,
	nameRef,
}: {
	projects: Project[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onCreate: (name: string) => Promise<Project>;
	nameRef: React.RefObject<HTMLInputElement | null>;
}) {
	const { name, setName, error, busy, submit } = useProjectCreator(onCreate);

	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">Projects</h2>

			{projects.length === 0 ? (
				<p className="text-[12px] leading-relaxed text-muted">
					No projects yet. Name one below to get started.
				</p>
			) : (
				<ul className="flex flex-col gap-1">
					{projects.map((item) => {
						const current = item.id === selectedId;
						return (
							<li key={item.id}>
								<button
									type="button"
									onClick={() => onSelect(item.id)}
									aria-current={current ? "page" : undefined}
									className={cx(
										"flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
										current
											? "bg-forest/10 font-semibold text-forest"
											: "text-muted hover:bg-forest/5 hover:text-forest",
									)}
								>
									<span className="min-w-0 truncate">{item.name}</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}

			<form onSubmit={submit} className="flex min-w-0 flex-col gap-2">
				<label className="text-[12px] font-semibold text-forest" htmlFor="sidebar-new-project">
					New project
				</label>
				<input
					id="sidebar-new-project"
					ref={nameRef}
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="Mito study"
					disabled={busy}
					maxLength={120}
					className="min-w-0 rounded-lg border border-line-strong bg-paper px-2 py-1.5 text-[13px] text-forest outline-none placeholder:text-muted focus:border-teal-ink disabled:opacity-60"
				/>
				<Button type="submit" variant="primary" disabled={busy || name.trim().length === 0}>
					{busy ? "Creating…" : "Create project"}
				</Button>
				{error ? <Notice tone="error">{error}</Notice> : null}
			</form>
		</section>
	);
}

function ProjectPicker({
	projects,
	selectedId,
	onSelect,
	onCreate,
}: {
	projects: Project[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onCreate: (name: string) => Promise<Project>;
}) {
	const { name, setName, error, busy, submit } = useProjectCreator(onCreate);

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
										? "border-forest bg-forest text-cream dark:border-cream dark:bg-cream dark:text-forest"
										: "border-line-strong text-forest hover:bg-shell dark:border-night-line dark:text-night-text dark:hover:bg-night-raised",
								)}
							>
								{item.name}
							</button>
						))}
					</div>
				)}

				<form onSubmit={submit} className="flex flex-wrap items-end gap-2">
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
