"use client";

import { useState } from "react";

import { describeError, isUnauthorized } from "../lib/api";
import { login, register, type User } from "../lib/genomics";
import { Button, Field, Notice, cx } from "./primitives";

type Mode = "login" | "register";

/**
 * Sign-in and sign-up.
 *
 * The session is an HttpOnly cookie, so there is no token in JS to read, store
 * or clear — every successful call below just hands control back to the parent,
 * which re-reads `/auth/me` as the single source of truth for "am I signed in".
 */
export function AuthView({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
	const [mode, setMode] = useState<Mode>("login");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const isRegister = mode === "register";

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setBusy(true);

		try {
			const user = isRegister
				? await register({ name: name.trim(), email: email.trim(), password })
				: await login({ email: email.trim(), password });
			onAuthenticated(user);
		} catch (caught) {
			// A 401 on the login form is the expected outcome of a typo, not a
			// fault, so it reads differently from every other failure.
			setError(
				isUnauthorized(caught) && !isRegister
					? "Email or password is incorrect."
					: describeError(caught),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="mx-auto flex w-full max-w-sm flex-col gap-5 py-10">
			<div className="text-center">
				<h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
					Genomic Insight
				</h1>
				<p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
					{isRegister ? "Create an account to start a project." : "Sign in to your projects."}
				</p>
			</div>

			<form onSubmit={submit} className="flex flex-col gap-3">
				{isRegister ? (
					<Field
						label="Name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						autoComplete="name"
						required
						minLength={1}
						maxLength={120}
					/>
				) : null}

				<Field
					label="Email"
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					autoComplete="email"
					required
				/>

				<Field
					label="Password"
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					autoComplete={isRegister ? "new-password" : "current-password"}
					required
					minLength={8}
					hint={isRegister ? "At least 8 characters." : undefined}
				/>

				{error ? <Notice tone="error">{error}</Notice> : null}

				<Button type="submit" variant="primary" disabled={busy} className="w-full">
					{busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
				</Button>
			</form>

			<p className="text-center text-xs text-zinc-500">
				{isRegister ? "Already have an account?" : "No account yet?"}{" "}
				<button
					type="button"
					onClick={() => {
						setMode(isRegister ? "login" : "register");
						setError(null);
					}}
					className={cx(
						"font-medium text-zinc-900 underline underline-offset-2",
						"hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300",
					)}
				>
					{isRegister ? "Sign in" : "Create one"}
				</button>
			</p>
		</div>
	);
}
