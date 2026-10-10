/**
 * Arguments for a db3 console script (`queue:work`, `scheduler:work`).
 *
 * `npm run queue` usually runs `tsx server/queue.ts`, which needs the command as
 * its first argument; without it the console only prints help. If the script body
 * already names the command, repeating it would be read as a queue name, so it is
 * left out.
 *
 * @param scriptBody - The package.json script text.
 * @param args - Arguments starting with the console command.
 * @returns Arguments to pass after `--`.
 */
export function consoleArgs(scriptBody: string, args: string[]): string[] {
	const [command, ...rest] = args;
	if (command && new RegExp(`(^|\\s)${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(scriptBody)) return rest;
	return args;
}
