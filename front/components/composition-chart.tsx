"use client";

import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { BASES, type Composition } from "../lib/result";

/**
 * Base colours follow the convention bioinformatics tools already use
 * (SnapGene, Benchling, the Biopython cookbook): A green, T red, G blue,
 * C amber. Reusing it means a screenshot needs no legend to be read.
 *
 * Deliberately *not* the brand palette. Brand teal is itself a green, so a
 * palette-derived "adenine" would be indistinguishable from a decorative accent
 * -- and a chart where the brand colour carries a base identity is worse than
 * one that clashes. These four are semantics, and they sit beside the brand
 * rather than inside it.
 */
const BASE_COLORS: Record<(typeof BASES)[number], string> = {
	A: "#16a34a",
	T: "#dc2626",
	G: "#2563eb",
	C: "#d97706",
};

/**
 * Recharts takes colours as plain values, so the two chrome colours are
 * literals rather than CSS variables. They match `--color-line` and
 * `--color-shell` in globals.css: a cool grey gridline against a warm cream
 * page reads as dirt, and the chart is the brightest thing on the screen.
 */
const GRID = "#EADCC2";
const CURSOR = "#FFF6E6";

export function CompositionChart({ composition }: { composition: Composition }) {
	const data = BASES.map((base) => ({ base, count: composition?.[base] ?? 0 }));
	const total = data.reduce((sum, point) => sum + point.count, 0);

	if (total === 0) {
		return (
			<p className="py-8 text-center text-xs text-muted">
				No base counts in this result.
			</p>
		);
	}

	return (
		<div className="h-56 w-full">
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
					<CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
					<XAxis dataKey="base" tickLine={false} axisLine={false} fontSize={12} />
					<YAxis
						tickLine={false}
						axisLine={false}
						fontSize={11}
						width={52}
						tickFormatter={(value: number) => value.toLocaleString()}
					/>
					<Tooltip cursor={{ fill: CURSOR }}
						// Recharts types the value as possibly absent, so narrow it
						// before doing arithmetic on it.
						formatter={(value, name) => {
							const count = typeof value === "number" ? value : Number(value ?? 0);
							return [
								`${count.toLocaleString()} (${((count / total) * 100).toFixed(1)}%)`,
								String(name),
							];
						}}
						contentStyle={{ fontSize: 12, borderRadius: 8, fontFamily: "monospace" }}
					/>
					<Bar dataKey="count" name="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
						{data.map((point) => (
							<Cell key={point.base} fill={BASE_COLORS[point.base]} />
						))}
					</Bar>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}
