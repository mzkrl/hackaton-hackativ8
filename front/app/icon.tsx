import { ImageResponse } from "next/og";

/**
 * The app icon, generated rather than shipped as a binary.
 *
 * Two reasons. The obvious one is that a Next.js favicon has no business on a
 * genomics product. The better one is that this file *is* the mark: the helix
 * paths here and `DnaIcon` in `components/brand.tsx` are the same drawing, so
 * there is one shape in the repo instead of an SVG and a PNG that drift apart
 * the first time someone nudges a curve.
 *
 * `favicon.ico` was deleted rather than left in place. Next emits a link tag for
 * each file it finds, so leaving both means two icons in the tab and the browser
 * picks between them.
 *
 * Inline styles only -- this renders through satori, which has no Tailwind and
 * no stylesheet.
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					// The palette's background. Opaque on purpose: a transparent
					// favicon disappears against a light browser chrome.
					background: "#FFEBCB",
					borderRadius: 7,
				}}
			>
				<svg
					width={22}
					height={22}
					viewBox="0 0 24 24"
					fill="none"
					strokeLinecap="round"
				>
					{/* Two mirrored strands. No rungs: at 32px they are sub-pixel. The
					    second strand is `#157F5A`, which is `--color-teal-ink` in
					    globals.css -- spelled out because satori has no stylesheet
					    and cannot read a custom property. */}
					<path d="M12 3C18 5 18 10 12 12C6 14 6 19 12 21" stroke="#21A179" strokeWidth="2.4" />
					<path d="M12 3C6 5 6 10 12 12C18 14 18 19 12 21" stroke="#157F5A" strokeWidth="2.4" />
				</svg>
			</div>
		),
		{ ...size },
	);
}