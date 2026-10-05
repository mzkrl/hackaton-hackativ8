import postgres from "postgres";

/**
 * Tests run against the real VPS PostgreSQL, so this client is intentionally
 * read-mostly: it verifies that rows the API claims to have written actually
 * landed. Nothing here truncates tables, because the database is not a
 * throwaway fixture.
 */
const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

export const db = sql;

export const countRows = async (table: "projects" | "sequences" | "analyses" | "conversations" | "users") => {
	const rows = await sql.unsafe<{ count: number }[]>(`select count(*)::int as count from ${table}`);

	return rows[0]!.count;
};

export const projectCounts = async (projectId: string) => {
	const rows = await sql`
		select
			(select count(*)::int from projects where id = ${projectId}) as projects,
			(select count(*)::int from sequences where project_id = ${projectId}) as sequences,
			(select count(*)::int from conversations where project_id = ${projectId}) as conversations
	`;

	return rows[0]! as { projects: number; sequences: number; conversations: number };
};

export const sequenceById = (id: string) => sql`select * from sequences where id = ${id}`;

/**
 * The owner columns of a project. Both are read, because the interesting
 * assertion after a claim is not "user_id is set" but "user_id is set *and*
 * guest_id was cleared" — a half-migrated row would satisfy the first alone.
 */
export const projectOwnership = async (projectId: string) => {
	const rows = await sql`
		select user_id as "userId", guest_id as "guestId" from projects where id = ${projectId}
	`;

	return rows[0]! as { userId: string | null; guestId: string | null };
};

export const guestSessionExists = async (guestId: string) => {
	const rows = await sql`select 1 from guest_sessions where id = ${guestId}`;

	return rows.length > 0;
};

export const analysisById = (id: string) => sql`select * from analyses where id = ${id}`;

export const userByEmail = (email: string) => sql`select * from users where email = ${email}`;
