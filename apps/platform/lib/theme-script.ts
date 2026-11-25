// Shared by the server layout (inline <head> script) and lib/theme.ts. Not a
// client module, so the server gets the plain string.

export const THEME_KEY = "forktime-theme";

/** Runs in <head> before paint. Kept tiny and dependency-free. */
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("${THEME_KEY}")||"system";var d=c==="dark"||(c==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
