"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { LogInIcon, PlusIcon, Wordmark } from "./brand";
import { cx } from "./primitives";

/*
 * The application shell.
 *
 * A 274px sidebar down the left and a main area beside it, both on cream. There
 * is no frame around them and no second surface: the brief's page background is
 * `#FFEBCB`, so the whole app is one plane and the sidebar is separated from the
 * main area by a single hairline rather than by a change of colour.
 *
 * Three layout facts that are load-bearing and easy to break:
 *
 *   1. `md:h-screen` + `md:overflow-hidden` on the row, and `overflow-y-auto` on
 *      <main>. The sidebar is pinned to the viewport at `h-screen` and the main
 *      area scrolls inside it. Neither of those is decoration: if <main> scrolls
 *      the page instead, a long analysis list scrolls the sidebar's Settings row
 *      off the bottom of the screen, which is the one thing a sidebar must not do.
 *   2. `overflow-hidden` on the sidebar. Its own `Recent` block scrolls, so
 *      nothing should ever reach the sidebar's edge -- this is the backstop that
 *      turns "it overflowed" into "it is clipped" rather than into a horizontal
 *      scrollbar across the whole app.
 *   3. `min-w-0` on every flex child. A flex item defaults to `min-width: auto`
 *      and refuses to shrink below its content, so one long unbroken string in
 *      the main area would push the sidebar off the left edge instead of
 *      wrapping. This is the class that makes requirement "no horizontal
 *      overflow" true rather than nearly true.
 *
 * The dividers are direct children of the <aside> with no padding, while the
 * content they separate sits in its own padded block. That is what makes a rule
 * span the full 274px instead of stopping at the text column.
 *
 * The sidebar does not collapse into a disclosure on mobile. A phone already
 * spends its width on the content, and a menu that has to be opened before
 * anything can be reached costs more than the space it saves. What does not fit
 * in the top bar goes below it, visible without interaction.
 *
 * Presentational throughout: navigation and actions arrive as props, so the
 * shell holds the signed-out, loading and signed-in states without knowing which
 * is which.
 */

export type NavItem = {
	href: string;
	label: string;
	icon: ReactNode;
	active?: boolean;
};

type Action = {
	label: string;
	href?: string;
	onClick?: () => void;
	icon?: ReactNode;
	/**
	 * Present but not wired. `href` and `onClick` are both still supplied --
	 * usually as a no-op -- so the row renders and announces as unavailable
	 * rather than looking live and silently doing nothing when pressed.
	 */
	disabled?: boolean;
	/** Shown on hover, so a disabled row can explain itself. */
	note?: string;
};

type AppShellProps = {
	children: ReactNode;
	nav?: NavItem[];
	/** The action under the logo - "+ New analysis". */
	action?: Action;
	/**
	 * The middle of the sidebar: the Recent section. A slot rather than a prop
	 * because its contents differ by session -- saved analyses when signed in, a
	 * login call and a line explaining why when not.
	 */
	recent?: ReactNode;
	/** The bottom-most row -- Settings in the design. */
	settings?: Action;
	/** Signed out only. Replaced by the account block when there is a user. */
	login?: { label?: string; href: string };
	/** Signed-in identity, rendered in the sidebar footer and under the mobile bar. */
	account?: {
		name: string;
		detail?: string;
		action: { label: string; onClick: () => void; icon: ReactNode };
	};
};

export function AppShell({
	children,
	nav = [],
	action,
	recent,
	settings,
	login,
	account,
}: AppShellProps) {
	return (
		<div className="flex min-h-full min-w-0 flex-1 flex-col md:h-screen md:flex-row md:overflow-hidden">
			{/* ----------------------------------------------------- sidebar -- */}
			{/*
			 * `hidden md:flex` rather than a toggleable drawer. On desktop this is
			 * always the navigation, and a sidebar that can be collapsed is one more
			 * piece of state to get wrong for no benefit.
			 */}
			<aside className="hidden h-screen w-[274px] min-w-0 shrink-0 flex-col overflow-hidden border-r border-rule md:flex">
				{/*
				 * 190px, as the brief specifies. It is a tall block for three small
				 * things, and that is the point: it is the one place the app gets to
				 * look like itself rather than like a list.
				 */}
				<Link
					href="/"
					className="flex h-[190px] min-w-0 shrink-0 items-center justify-center px-6"
				>
					<Wordmark />
				</Link>

				{/* Full-bleed rule: no padding, so it spans all 274px. */}
				<div className="h-px w-full shrink-0 bg-line" />

				{action ? (
					<div className="min-w-0 shrink-0 px-6 py-5">
						<ShellAction action={action} />
					</div>
				) : null}

				<div className="h-px w-full shrink-0 bg-line" />

				{nav.length > 0 ? (
					<nav className="flex min-w-0 shrink-0 flex-col gap-1 px-6 py-5">
						{nav.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								aria-current={item.active ? "page" : undefined}
								className={cx(
									"flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors",
									item.active
										? "bg-forest/10 font-semibold text-forest"
										: "text-muted hover:bg-forest/5 hover:text-forest",
								)}
							>
								{item.icon}
								<span className="min-w-0 truncate">{item.label}</span>
							</Link>
						))}
					</nav>
				) : null}

				{/*
				 * Grows to fill, so the Settings row below is pushed to the bottom of
				 * the 100vh column. `min-w-0` is what keeps a long Recent label from
				 * widening the sidebar; `overflow-y-auto` keeps a long list inside it.
				 */}
				<div className="min-w-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-slim">
					{recent}
				</div>

				<div className="min-w-0 shrink-0 px-6 pb-6 pt-3">
					{settings ? <ShellRow action={settings} /> : null}

					{account ? (
						<div className={settings ? "mt-4" : undefined}>
							<Footer account={account} login={login} />
						</div>
					) : login ? (
						<div className={settings ? "mt-4" : undefined}>
							<Footer login={login} />
						</div>
					) : null}
				</div>
			</aside>

			{/* ------------------------------------------------------- main -- */}
			{/*
			 * `min-w-0` here rather than on <main>: this is the flex item whose
			 * intrinsic width comes from the page's widest table, and it is the one
			 * that has to be allowed to shrink.
			 */}
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4 md:hidden">
					<Link href="/" className="min-w-0">
						<Wordmark compact />
					</Link>

					{action ? (
						<ShellAction action={action} size="sm" />
					) : login ? (
						<LoginLink login={login} size="sm" />
					) : null}
				</header>

				{/*
				 * The sidebar footer again, on mobile. The sidebar above is `hidden`
				 * below `md`, so without this there would be no Settings and no
				 * sign-out on a phone -- every action has to exist on each layout that
				 * renders one.
				 */}
				{settings || account || login ? (
					<div className="shrink-0 border-b border-line px-5 py-4 md:hidden">
						{settings ? <ShellRow action={settings} /> : null}
						{account ? (
							<div className={settings ? "mt-4" : undefined}>
								<Footer account={account} login={login} />
							</div>
						) : login ? (
							<div className={settings ? "mt-4" : undefined}>
								<Footer login={login} />
							</div>
						) : null}
					</div>
				) : null}

				{/*
				 * `id="main"` is the skip-link target. It lives here rather than in
				 * each page so every route gets it, and so the skip link cannot point
				 * at an element a page forgot to add.
				 */}
				<main
					id="main"
					className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scrollbar-slim"
				>
					{children}
				</main>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------- fragments --- */

/*
 * The action under the logo.
 *
 * A menu row, not a filled button: a filled forest button in a 226px content
 * column is a wall, and the brief's sidebar is a list of things rather than a
 * stack of buttons. Forest on cream, 11.63:1.
 */
function ShellAction({
	action,
	size = "md",
	className,
}: {
	action: Action;
	size?: "sm" | "md";
	className?: string;
}) {
	const body = (
		<>
			{action.icon ?? <PlusIcon size={14} />}
			<span className="min-w-0 truncate">{action.label}</span>
		</>
	);

	const classes = cx(
		"flex min-w-0 items-center gap-2 font-semibold text-forest transition-colors hover:text-maroon",
		size === "sm"
			? "shrink-0 rounded-lg px-2 py-1.5 text-[13px]"
			: "w-full rounded-lg px-2 py-1.5 text-[13px]",
		// No hover affordance on a row that will not respond to a press.
		action.disabled && "cursor-not-allowed hover:text-forest",
		className,
	);

	// A link when it navigates, a button when it acts. The distinction matters
	// for the keyboard: `href="#id"` is focusable and announces as a link, while
	// a button announces as an action.
	return action.href ? (
		<Link href={action.href} className={classes}>
			{body}
		</Link>
	) : (
		<button
			type="button"
			onClick={action.disabled ? undefined : action.onClick}
			className={classes}
		>
			{body}
		</button>
	);
}

/**
 * A quiet sidebar row -- Settings, and anything else that is not navigation.
 *
 * Visually a nav item so the sidebar has one row rhythm, but in `--color-forest`
 * rather than the muted grey of navigation, because the brief specifies forest
 * for this row.
 */
function ShellRow({ action }: { action: Action }) {
	const classes = cx(
		"flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-forest transition-colors hover:bg-forest/5",
		// No hover affordance on a row that will not respond to a press.
		action.disabled && "cursor-not-allowed hover:bg-transparent",
	);

	const inner = (
		<>
			{action.icon}
			<span className="min-w-0 truncate">{action.label}</span>
		</>
	);

	// A disabled row is not a link at all -- it has nowhere to go, and `next/link`
	// will not accept an absent `href`. A `<span>` is also the honest element: no
	// pointer, no tab stop, and the note is announced with it rather than only
	// appearing on hover.
	if (action.disabled) {
		return (
			<span title={action.note} aria-disabled className={classes}>
				{inner}
			</span>
		);
	}

	if (action.href) {
		return (
			<Link href={action.href} className={classes}>
				{inner}
			</Link>
		);
	}

	return (
		<button type="button" onClick={action.onClick} className={classes}>
			{inner}
		</button>
	);
}

/**
 * The sidebar's Login pill: forest fill, cream text, 11.63:1.
 *
 * `w-full` with no fixed width, so it fills whatever the sidebar's content column
 * happens to be. The clipped-button bug this replaces came from a hard `w-[120px]`
 * sitting inside a narrower padded column, which is the kind of number that has to
 * be re-checked every time the sidebar width changes.
 */
function LoginLink({
	login,
	size = "md",
}: {
	login: { label?: string; href: string };
	size?: "sm" | "md";
}) {
	return (
		<Link
			href={login.href}
			className={cx(
				"flex items-center justify-center gap-2 rounded-full bg-forest font-semibold text-cream transition-opacity hover:opacity-90",
				size === "sm"
					? "h-[41px] shrink-0 px-4 text-[13px]"
					: "h-[41px] w-full px-4 text-[13px]",
			)}
		>
			<LogInIcon size={14} />
			{login.label ?? "Login"}
		</Link>
	);
}

/** The account block when signed in, the login call when not. */
function Footer({
	account,
	login,
}: {
	account?: AppShellProps["account"];
	login?: AppShellProps["login"];
}) {
	if (account) {
		return (
			<div className="min-w-0 rounded-xl border border-line-strong bg-paper p-3">
				<p className="min-w-0 truncate text-[13px] font-semibold text-forest">
					{account.name}
				</p>
				{account.detail ? (
					<p className="mt-0.5 min-w-0 truncate text-[11px] text-muted">
						{account.detail}
					</p>
				) : null}
				<button
					type="button"
					onClick={account.action.onClick}
					className="mt-2 flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-[13px] font-semibold text-muted transition-colors hover:text-maroon"
				>
					{account.action.icon}
					<span className="min-w-0 truncate">{account.action.label}</span>
				</button>
			</div>
		);
	}

	if (login) return <LoginLink login={login} />;

	return null;
}
