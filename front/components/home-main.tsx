"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ChatBar } from "./chat-bar";
import { UploadTarget } from "./upload-target";

/*
 * The main column of the signed-out home screen.
 *
 * Client for two reasons, and only two. The composer needs someone to own what
 * has been typed, and the drop zone needs a router. Neither is application
 * logic: there is no session, no project and no analysis here yet.
 *
 * Everything here is in normal document flow. Nothing is absolutely positioned
 * and nothing is offset with a negative margin, so the four blocks cannot overlap
 * and cannot escape the box they are in -- which is what the drop zone's caption
 * used to do. Each gap between blocks is a `margin-*` on the block below it, so
 * the whole stack's geometry is readable off this one file top to bottom:
 *
 *     headline        34px / 800, then 22px of air
 *     drop zone       500 x 238
 *     "or type"       13px, then 12px of air
 *     composer        558 x 46, then 28px of air
 *
 * `justify-center-safe` centres that stack in the main area, which is what makes the
 * page read as one composed screen rather than as a column that happens to start at
 * the top. `safe` is not decoration: on a phone the chrome above <main> is around
 * 175px, so on a 640px-tall screen there is less room than the stack needs, and plain
 * `center` would push the top of the headline above the scroll origin where it cannot
 * be reached. `safe` centres when it fits and starts at the top when it does not.
 *
 * The two fixed widths carry `max-w-full`. At 1440 the main area is 1166px after
 * the 274px sidebar, so 500 and 558 both fit with room to spare and the numbers
 * are exactly the brief's. Below that they give way, and `max-w-full` is what
 * stops a 500px box being 500px wide inside a 360px phone.
 */

export function HomeMain() {
	const router = useRouter();
	const [ask, setAsk] = useState("");

	return (
		<div className="flex flex-1 flex-col items-center justify-center-safe px-6 py-10">
			<h1 className="mb-[22px] text-center text-[34px] font-extrabold leading-tight text-balance text-forest">
				What&rsquo;s cooking, good lookin&rsquo;?
			</h1>

			<UploadTarget
				className="h-[238px] w-[500px] max-w-full"
				accept=".fasta,.fa,.fna,.ffn,.faa,.frn,.seq"
				// No project exists yet, so there is nowhere for the bytes to go.
				// Sending the visitor to the workspace is the honest outcome -- it
				// is where a project can be created and the file imported.
				onFiles={() => router.push("/workspace")}
			/>

			<p className="mt-[12px] text-[13px] font-semibold text-forest">
				Or you can start by typing
			</p>

			<ChatBar
				variant="filled"
				className="mt-[28px] w-[558px] max-w-full"
				value={ask}
				onChange={setAsk}
				label="Ask what to analyse"
			/>
		</div>
	);
}
