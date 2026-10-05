import { HomeScreen } from "../components/home-screen";

/**
 * The home screen.
 *
 * `/` was a Server Component hardcoded to the signed-out layout, which meant it
 * told a signed-in visitor they needed to log in. It now resolves the session and
 * renders either state.
 *
 * The split is here so this file stays a Server Component: `HomeScreen` owns the
 * session round trip, and because `AppShell` is already a client component the
 * markup is still prerendered -- the session only affects the sidebar, and it is
 * read on hydration.
 */

export default function Home() {
	return <HomeScreen />;
}