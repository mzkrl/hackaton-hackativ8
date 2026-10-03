import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";

import "./globals.css";

/*
 * Fonts are self-hosted at build time -- no request leaves the browser for
 * Google. `variable` puts the family on a CSS variable so globals.css can hand it
 * to Tailwind and the whole app inherits it from one place.
 *
 * One family. Nunito, at exactly the four weights the brief names:
 *
 *   400  body copy
 *   600  the composer's placeholder, and emphasis inside a paragraph
 *   700  the sidebar title, the logo, the Login button
 *   800  the home headline
 *
 * They are listed explicitly rather than left variable. Nunito ships a full
 * weight axis, and asking for it wholesale would put every weight the design
 * never uses into the self-hosted subset -- roughly a hundred kilobytes of font
 * for four faces. `weight` also makes the brief's hierarchy greppable: if a
 * weight is not in this list, it is not available to use.
 *
 * No mono family is loaded. A sequence is the one place the OS monospace is
 * already the right answer, and the brief asks for a single sans.
 */
const nunito = Nunito({
	subsets: ["latin"],
	weight: ["400", "600", "700", "800"],
	variable: "--font-nunito",
	display: "swap",
});

export const metadata: Metadata = {
	metadataBase: new URL("https://gene-pilot.pages.dev"),
	title: {
		default: "Gene Pilot — Research Tool",
		template: "%s · Gene Pilot",
	},
	description:
		"Upload a FASTA file and ask for a specific analysis. An agent works out which tools the request needs, runs them deterministically, and explains the result in plain language. For research and education.",
	applicationName: "Gene Pilot",
	keywords: [
		"bioinformatics",
		"genomics",
		"FASTA",
		"GenBank",
		"GC content",
		"ORF",
		"BLAST",
		"sequence analysis",
	],
	authors: [{ name: "Gene Pilot" }],
	openGraph: {
		type: "website",
		title: "Gene Pilot — Research Tool",
		description:
			"An agentic bioinformatics assistant that shows its working. Deterministic computation first, explanation second.",
		siteName: "Gene Pilot",
	},
	twitter: {
		card: "summary_large_image",
		title: "Gene Pilot — Research Tool",
		description:
			"An agentic bioinformatics assistant that shows its working. Deterministic computation first, explanation second.",
	},
	robots: { index: true, follow: true },
};

export const viewport: Viewport = {
	// Cream, unconditionally. The app is light-only, so there is no dark entry to
	// declare -- a `prefers-color-scheme: dark` value here would paint a phone's
	// browser chrome the one colour this app never uses.
	themeColor: "#FFEBCB",
	colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		/*
		 * `min-h-full` with `h-full` on <html> is what lets the shell reach the
		 * viewport exactly. The font variable is on <body> rather than <html>
		 * because it is the body that sets `font-family`, and one hop is fewer
		 * than one too many.
		 *
		 * No `antialiased` here: Nunito is loaded with `display: swap` and its
		 * own metrics do the work. Smoothing a rounded face on a low-dpi screen
		 * thins its stroke weights, and 700 is already the logo's weight.
		 */
		<html lang="en" className="h-full">
			<body className={`${nunito.variable} flex min-h-full flex-col`}>
				{children}
			</body>
		</html>
	);
}