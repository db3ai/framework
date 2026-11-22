/**
 * Browser script that reloads the page once when a lazy chunk from an older build is gone.
 *
 * A tab (or an iOS home screen web app) opened before a deploy keeps the old entry script, which
 * asks for the old build's hashed chunks; the new build no longer serves them, so Safari reports
 * "Importing a module script failed". Vite fires `vite:preloadError` for that failure. Reloading
 * fetches the new `index.html` and its chunks. The build id stored for the session stops a loop
 * when a chunk is missing from the current build too: that error is left to surface.
 */
export function staleBuildReloadScript(buildId: string): string {
	return `addEventListener('vite:preloadError',function(e){try{var k='db3:reloaded-for-build',b=${JSON.stringify(buildId)};if(sessionStorage.getItem(k)===b)return;sessionStorage.setItem(k,b);e.preventDefault();location.reload()}catch(_){}});`;
}
