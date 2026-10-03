import Link from "next/link";

import { AppShell } from "../components/app-shell";
import { GearIcon, PlusIcon } from "../components/brand";
import { HomeMain } from "../components/home-main";

/**
 * The home screen, signed out.
 *
 * This layout is specified down to the pixel, so it is followed literally: a
 * 274px sidebar holding the logo, "+ New analysis", the Recent section and
 * Settings, then one centred column in the main area -- the headline, the drop
 * zone, the "Or you can start by typing" line and the composer.
 *
 * There is no footer. An earlier version carried a research-and-education line
 * here; the brief does not specify one, so it is gone rather than moved.
 *
 * It stays a Server Component. `HomeMain` is the only client component in the
 * tree, and it is client for two reasons that are both about owning a control's
 * own state rather than about data. So `/` still prerenders and a visitor paints
 * from the build rather than from a session round trip.
 */

/**
 * The Recent section, signed out.
 *
 * Empty in truth -- there is no session, so there is nothing to have been
 * recent. The slot exists anyway because the state it will hold is part of the
 * design, and because "you need to login first" is the honest description of
 * what this app is: usable now, remembered later.
 *
 * Order is the brief's: caption, then the sentence explaining why, then the
 * button. Putting the explanation above the pill is unusual and it is right here
 * -- the sentence is the reason the button is there, and in a 226px column
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

export default function Home() {
	return (
		<AppShell
			action={{
				label: "New analysis",
				href: "/workspace",
				icon: <PlusIcon size={14} />,
			}}
			recent={<Recent />}
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
