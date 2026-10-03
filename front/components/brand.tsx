/**
 * Brand marks and the icon set.
 *
 * A Server Component: nothing here has state or handlers, so it renders to
 * markup and costs no client JavaScript.
 *
 * Every icon takes a `size` prop that becomes literal `width` and `height`
 * attributes on the `<svg>`, and every one of them also carries `shrink-0`.
 * Those two things together are the whole reason an icon in this app cannot end
 * up squashed or stretched: the attribute fixes the intrinsic box, and
 * `shrink-0` stops flex from compressing it. The alternative -- sizing with a
 * `size-*` class and a `viewBox` alone -- lets a row of labels decide how big the
 * icon next to them ends up.
 *
 * `className` is still accepted, and it wins: it is applied after the size, so a
 * caller can override with a `size-*` utility if it needs to. Nothing does.
 *
 * Nothing here imports `cx` from `primitives.tsx`. That file is a client module,
 * so importing a function out of it would turn this file's exports into client
 * references and put the brand mark in the client bundle for nothing.
 */

/* ------------------------------------------------------------------ base --- */

type IconProps = {
	/** Rendered width in px, and the height unless the drawing is not square. */
	size?: number;
	/** Merged after `shrink-0`. May override it, and may override the size. */
	className?: string;
};

const join = (...values: Array<string | false | null | undefined>) =>
	values.filter(Boolean).join(" ");

/**
 * The shared attribute set. Stroke drawings on `currentColor`, so an icon takes
 * the colour of the text beside it.
 */
const svg = (
	size: number,
	className?: string,
	viewBox = "0 0 24 24",
	strokeWidth = 1.5,
) => ({
	width: size,
	height: size,
	viewBox,
	fill: "none" as const,
	"aria-hidden": true as const,
	stroke: "currentColor",
	strokeWidth,
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
	className: join("shrink-0", className),
});

/* ------------------------------------------------------------------- mark -- */

/**
 * The logo: a green ring around a double helix.
 *
 * Two-tone on purpose. The ring is the brand green `#21A179` and the strands are
 * its darker sibling, so at 48px in a 274px sidebar the mark reads as a ring
 * first and a helix second rather than dissolving into one green shape. The ring
 * is `r=26` on a 64-unit box with a 3-unit stroke, so its outer edge lands at
 * 27.5 of the 32 available -- inside the viewBox with room to spare, which is
 * the difference between a ring and a ring with a bite out of it.
 */
export const DnaIcon = ({ size = 48, className }: IconProps) => (
	<svg {...svg(size, className, "0 0 64 64", 3)}>
		<circle cx="32" cy="32" r="26" stroke="var(--color-teal)" />
		{/* Strand A: centre, bulges right, centre, bulges left, centre. */}
		<path d="M32 13C44 19 44 27 32 32C20 37 20 45 32 51" stroke="var(--color-teal-ink)" />
		{/* Strand B: the same curve mirrored. */}
		<path d="M32 13C20 19 20 27 32 32C44 37 44 45 32 51" stroke="var(--color-teal-ink)" />
		{/* Rungs, widest where the strands are furthest apart. */}
		<path
			d="M25 20h14M22 27h20M22 37h20M25 44h14"
			stroke="var(--color-teal-ink)"
			strokeWidth="2"
			opacity="0.45"
		/>
	</svg>
);

/**
 * The wordmark lockup: mark, name, category. Centred, because in a sidebar the
 * name is the widest of the three and anything left-aligned against it reads as
 * three unrelated objects.
 *
 * `tracking` is wide rather than tight. Nunito is a rounded face with generous
 * counters, and at 20px weight 700 the letters close up without the air -- the
 * `.wordmark` utility carries the value.
 */
export const Wordmark = ({
	compact = false,
	className,
}: {
	/** Drops the "Research Tool" line, for tight horizontal space. */
	compact?: boolean;
	className?: string;
}) => (
	<span className={`flex flex-col items-center text-center ${className ?? ""}`}>
		<DnaIcon size={48} />

		<span className="wordmark mt-3 block text-[20px] leading-none text-forest">
			Gene Pilot
		</span>

		{compact ? null : (
			<span className="mt-2 block text-[7px] font-semibold uppercase tracking-[0.35em] text-forest">
				Research Tool
			</span>
		)}
	</span>
);

/* ------------------------------------------------------------------ icons -- */

export const PlusIcon = ({ size = 14, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M12 5v14M5 12h14" />
	</svg>
);

export const UploadIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
		<path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" />
	</svg>
);

export const PaperclipIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.4 3.4 0 014.8 4.8l-8.5 8.5a1.8 1.8 0 01-2.5-2.5l7.8-7.8" />
	</svg>
);

export const SendIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M4.5 12h15M12.5 5l7 7-7 7" />
	</svg>
);

export const ChatIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M20 14.5a2 2 0 01-2 2H8l-4 3.5v-15A2 2 0 016 5h12a2 2 0 012 2z" />
		<path d="M8.5 9.5h7M8.5 12.5h4" />
	</svg>
);

export const FolderIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M3.5 7.5A1.5 1.5 0 015 6h4l2 2.5h8a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119 19.5H5A1.5 1.5 0 013.5 18z" />
	</svg>
);

export const SparkIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z" />
	</svg>
);

export const LogInIcon = ({ size = 14, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M14 4.5h4A1.5 1.5 0 0119.5 6v12a1.5 1.5 0 01-1.5 1.5h-4" />
		<path d="M10 8l-4 4 4 4M6 12h9" />
	</svg>
);

export const LogOutIcon = ({ size = 14, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M10 4.5H6A1.5 1.5 0 004.5 6v12A1.5 1.5 0 006 19.5h4" />
		<path d="M14 8l4 4-4 4M18 12H9" />
	</svg>
);

export const SearchIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<circle cx="10.5" cy="10.5" r="6" />
		<path d="M15 15l4.5 4.5" />
	</svg>
);

export const CheckIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M5 12.5l4.5 4.5L19 7.5" />
	</svg>
);

export const AlertIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 8v4.5M12 15.6v0.2" />
	</svg>
);

export const InfoIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 11v5M12 7.9v0.2" />
	</svg>
);

export const TrashIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0111 4h2a1.5 1.5 0 011.5 1.5V7" />
		<path d="M6.5 7l.8 11.1A1.5 1.5 0 008.8 19.5h6.4a1.5 1.5 0 001.5-1.4L17.5 7" />
	</svg>
);

export const ChevronIcon = ({ size = 20, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<path d="M8 10l4 4 4-4" />
	</svg>
);

/**
 * The send arrow: a diagonal, not a vertical.
 *
 * A straight up-arrow on a circle reads as "scroll to top". The diagonal points
 * out of the corner of the circle it sits in, which is what a send button means.
 * Drawn so the shaft stops at the corner and the two arms meet it there, rather
 * than the usual chevron floating above the line.
 */
export const ArrowUpRightIcon = ({ size = 18, className }: IconProps) => (
	<svg {...svg(size, className, "0 0 24 24", 2)}>
		<path d="M6.5 17.5L17 7" />
		<path d="M9 7h8v8" />
	</svg>
);

/**
 * The gear, as eight short teeth around a ring. Drawn at 1.5 like the rest of
 * the set rather than at the heavier weight a gear usually gets, because the
 * icons sit next to 12px labels and a thick gear reads as a separate tier.
 */
export const GearIcon = ({ size = 14, className }: IconProps) => (
	<svg {...svg(size, className)}>
		<circle cx="12" cy="12" r="3.2" />
		<path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8" />
		<path d="M5.35 5.35l1.98 1.98M16.67 16.67l1.98 1.98M18.65 5.35l-1.98 1.98M7.33 16.67l-1.98 1.98" />
	</svg>
);

/**
 * An open cardboard box, in line art, and the drop zone's only illustration.
 *
 * Four strokes and no fill: the standing back flap, the opening dipping into the
 * box, the tapered body, and the two side flaps folded outward. The flaps are
 * there and not just a cube because a cube reads as "package" -- and this is the
 * one control on the page that takes a file.
 *
 * Drawn on an 80x72 box, not a square one, because a box drawn on a square box
 * is a box with a lid on it. The aspect is carried through to the attributes: at
 * `size={76}` that is `width="76" height="68"`, and the stroke stays 2.4 units
 * thick either way, so the line does not get heavier as the icon grows.
 */
export const BoxIcon = ({ size = 76, className }: IconProps) => (
	<svg
		{...svg(size, className, "0 0 80 72", 2.4)}
		height={Math.round((size * 72) / 80)}
	>
		{/* the flap standing up behind the box */}
		<path d="M24 27V11h32v16" />
		{/* the opening, dipping down into the box */}
		<path d="M14 28l26 10 26-10" />
		{/* the body, tapering for perspective */}
		<path d="M14 28l6 36h40l6-36" />
		{/* side flaps folded outward */}
		<path d="M14 28L6 37M66 28l8 9" />
	</svg>
);
