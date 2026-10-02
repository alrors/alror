// UI preferences shared by server and client code. Keep this module free of
// "use client" so the server reads the real string values.

/** Cookie holding the sidebar state ("collapsed" | "expanded"), read by the layout on first paint. */
export const SIDEBAR_COOKIE = "alror_sidebar";

/** Cookie holding the environment the console filters by (an environment name; absent = all). */
export const ENV_COOKIE = "alror_env";

/** Cookie mirroring the Overview density ("compact" | absent), so the server can size the activity page. */
export const OVERVIEW_DENSITY_COOKIE = "alror_ov_density";
