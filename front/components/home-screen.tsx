"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { isApiConfigured } from "../lib/api";
import {
	getMe,
	listProjects,
	logout as endSession,
	type Principal,
	type Project,
} from "../lib/genomics";
import { AppShell } from "./app-shell";
import { GearIcon, LogOutIcon, PlusIcon } from "./brand";
import { HomeMain } from "./home-main";

/*
 * The home screen, in both of the states it can be in.
 *
 * This used to be a Server Component hardcoded to the signed-out layout, so the
 * Recent slot always read "You need to login first to save your recent analysis"
 * and always showed a Login pill -- even when the visitor arrived with a valid
 * session cookie. Being told to log in when you already are is worse than either
 * alternative: it reads as the app having lost the session.
 *
 * Session-aware without giving up the prerender. `AppShell` is itself a client
 * component, so Next was already shipping this whole subtree as client JS and
 * prerendering it to HTML; adding one client boundary above it costs no extra
 * first-paint work. The session round trip only runs on hydration, and until it
 * resolves the signed-out layout is what renders -- which is byte-for-byte the
 * prerendered markup, so the page does not visibly reflow when the answer
 * arrives.
 *
 * While loading, the signed-out layout is deliberately *not* a spinner: it is
 * the markup already in the HTML. A visitor paints the landing page immediately
 * and the identity-specific parts fill in under them.
 */

type State =
	| { state: "loading" }
	| { state: "anonymous" }
	| { state: "ready"; principal: Principal };

export function HomeScreen() {
	const [session, setSession] = useState<State>(() =>
		isApiConfigured ? { state: "loading" } : { state: "anonymous" },
	);
	const [projects, setProjects] = useState<Project[]>([]);

	useEffect(() => {
		if (!isApiConfigured) return;

		/*
		 * A failure here falls back to the signed-out layout rather than an error.
		 * That is a deliberate asymmetry with /workspace, which does surface a dead
		 * API: this page is the entry point and its whole signed-out state is a
		 * working landing page, so refusing to render it would turn a backend
		 * outage into a blank screen. Nothing here is hidden by the fallback -- the
		 * Login pill leads to /workspace, where an unreachable API is reported
		 * honestly.
		 */
		getMe()
			.then((principal) => setSession({ state: "ready", principal }))
			.catch(() => setSession({ state: "anonymous" }));
	}, []);

	const principal = session.state === "ready" ? session.principal : null;

	useEffect(() => {
		if (!principal) return;
		let cancelled = false;
		void listProjects()
			.then((data) => {
				if (!cancelled) setProjects(data);
			})
			.catch(() => {
				// A failed project list degrades the sidebar to "no projects", which is
				// what a signed-out visitor sees anyway. It must not blank the page.
			});
		return () => {
			cancelled = true;
		};
	}, [principal]);

	const signOut = async () => {
		try {
			await endSession();
		} finally {
			// Reset even when the request failed, so a flaky sign-out still lands on
			// the signed-out screen rather than stranding the user in a dead state.
			setSession({ state: "anonymous" });
			setProjects([]);
		}
	};

	return (
		<AppShell
			action={{
				label: "New analysis",
				href: "/workspace",
				icon: <PlusIcon size={14} />,
			}}
			recent={
				principal ? (
					<SignedInRecent projects={projects} />
				) : (
					<Recent />
				)
			}
			account={
				principal?.kind === "user"
					? {
							name: principal.user.name || principal.user.email,
							detail: principal.user.email,
							action: {
								label: "Sign out",
								onClick: () => void signOut(),
								icon: <LogOutIcon size={14} />,
							},
						}
					: principal?.kind === "guest"
						? {
								name: "Guest",
								detail: "Work is saved on this device",
								action: {
									label: "Sign out",
									onClick: () => void signOut(),
									icon: <LogOutIcon size={14} />,
								},
							}
						: undefined
			}
			settings={{
				label: "Settings",
				icon: <GearIcon size={14} />,
				// Settings is in the design and there is no settings route. It is
				// rendered `aria-disabled` with a note, rather than left as a
				// live-looking control that silently swallows the click.
				disabled: true,
				note: "Settings are not part of this prototype",
			}}
		>
			<a
				href="#main"
				className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-30 focus:rounded focus:bg-forest focus:px-3 focus:py-2 focus:text-xs focus:text-cream"
			>
				Skip to content
			</a>

			<HomeMain />
		</AppShell>
	);
}

/**
 * The Recent section, signed out.
 *
 * Empty in truth -- there is no session, so there is nothing to have been
 * recent. The slot exists anyway because the state it will hold is part of the
 * design, and because "you need to login first" is the honest description of
 * what this app is: usable now, remembered later.
 *
 * Order is the brief's: caption, then the sentence explaining why, then the
 * button. Putting the explanation above the pill is unusual and is right here
 * --
 * the sentence is the reason the button is there, and in a 226px column
 * reading the button first would make it look like the whole feature.
 *
 * The pill is forest rather than teal. `#023436` with cream text measures
 * 11.63:1, and it is the brief's own hex for it. It is `w-full` and `h-[41px]`
 * rather than a fixed width, so it fills this column and cannot be clipped by a
 * future change to the sidebar's padding.
 */
function Recent() {
	return (
		<div className="min-w-0">
			<p className="min-w-0 text-[11px] font-semibold text-forest">Recent</p>

			<p className="mt-2.5 min-w-0 text-[12px] leading-relaxed text-muted">
				You need to login first to save your recent analysis
			</p>

			<Link
				href="/workspace"
				className="mt-3 flex h-[41px] w-full items-center justify-center rounded-full bg-forest text-[13px] font-semibold text-cream transition-opacity hover:opacity-90"
			>
				Login
			</Link>
		</div>
	);
}

/**
 * The Recent section, signed in: the projects that actually exist.
 *
 * Read-only on purpose. Creating and switching projects is the workspace's job
 * and this list links there; the alternative is a second create form that would
 * need its own refresh path and would leave the visitor on a landing page with
 * nothing to see.
 *
 * `aria-current` on the rows is decorative here since nothing on `/` is the
 * "current" page, so it is left off.
 */
function SignedInRecent({ projects }: { projects: Project[] }) {
	return (
		<div className="min-w-0">
			<p className="min-w-0 text-[11px] font-semibold text-forest">Recent</p>

			{projects.length === 0 ? (
				<>
					<p className="mt-2.5 min-w-0 text-[12px] leading-relaxed text-muted">
						No saved projects yet.
					</p>
					<Link
						href="/workspace"
						className="mt-3 flex h-[41px] w-full items-center justify-center rounded-full bg-forest text-[13px] font-semibold text-cream transition-opacity hover:opacity-90"
					>
						New analysis
					</Link>
				</>
			) : (
				<ul className="mt-2.5 flex min-w-0 flex-col gap-1">
					{projects.map((project) => (
						<li key={project.id} className="min-w-0">
							<Link
								href="/workspace"
								className="flex min-w-0 items-center rounded-lg px-2 py-1.5 text-[13px] text-muted transition-colors hover:bg-forest/5 hover:text-forest"
							>
								<span className="min-w-0 truncate">{project.name}</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}