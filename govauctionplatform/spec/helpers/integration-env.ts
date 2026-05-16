/**
 * Additional setup for integration tests — loaded BEFORE any module code runs.
 *
 * Problem: some services transitively import src/index.ts, which imports
 * src/pre-start/index.ts, which calls commandLineArgs() on process.argv.
 * Jest passes flags like --config, --runInBand, --no-coverage that
 * commandLineArgs doesn't recognise, causing an UNKNOWN_OPTION crash.
 *
 * Fix: strip process.argv down to [node, script] so commandLineArgs sees
 * no flags and exits cleanly.  NODE_ENV and all other variables are already
 * set correctly by spec/helpers/env.ts (which is listed first in setupFiles).
 */
process.argv = process.argv.slice(0, 2);
