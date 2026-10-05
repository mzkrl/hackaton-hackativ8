"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

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

	const trackedIds = useMemo(
		() => (selectedId ? (tracked[selectedId] ?? []) : []),
		[selectedId, tracked],
	);
	const activeId = selectedId ?? projects[0]?.id ?? null;
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

	const reloadSequences = useCallback(async () => {
		setSequences(activeId ? await listSequences(activeId) : []);
	}, [activeId]);

	const reloadMessages = useCallback(async () => {
		setMessages(activeId ? await listConversations(activeId) : []);
	}, [activeId]);

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
		reloadSequences,
		reloadMessages,
		track,
		onAnalysisQueued,
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
		activeId,
		project,
		sequenceLabels,
	} = data;

	/**
	 * Signing out has to clear the server session, not just the local state.
	 *
	 * Resetting state alone would leave the cookie in place, and the next
	 * `getMe()` would hand the same account straight back — which reads as the
	 * button not working. The local reset happens either way, so a failed request
	 * still leaves a usable logged-out screen.
	 */
	const signOut = async () => {
		try {
			await endSession();
		} finally {
			onSignOut?.();
		}
	};

	return (
		<AppShell
			action={{ label: "New Analysis", href: "#new-analysis", icon: <PlusIcon className="size-4" /> }}
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
					onCreated={refresh}
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

						<AnalysisBoard analyses={analyses} sequenceLabels={sequenceLabels} onRefresh={refresh} />

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
										? "border-forest bg-forest text-cream dark:border-cream dark:bg-cream dark:text-forest"
										: "border-line-strong text-forest hover:bg-shell dark:border-night-line dark:text-night-text dark:hover:bg-night-raised",
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
