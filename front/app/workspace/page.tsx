import type { Metadata } from "next";

import { Workspace } from "../../components/workspace";

export const metadata: Metadata = {
	// No suffix here: the layout's title template appends "· Genomic Insight".
	title: "Workspace",
	description: "Import sequences, queue analyses, and keep notes per project.",
};

/**
 * The interactive half of the app, moved off `/` so the landing page can stay a
 * static Server Component.
 *
 * `/workspace` is client-rendered on purpose. The session is an HttpOnly cookie,
 * so "am I signed in" cannot be answered during a server render — it has to be
 * asked of the API from the browser. Prerendering this route would only produce
 * markup that is discarded the moment the client resolves the session.
 */
export default function WorkspacePage() {
	return <Workspace />;
}
