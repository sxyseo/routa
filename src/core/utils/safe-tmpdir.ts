/**
 * Safe temporary directory — cross-platform os.tmpdir() wrapper.
 *
 * On some Windows machines, `os.tmpdir()` (and `process.env.TEMP`)
 * include a trailing `\r` character, causing ENOENT on mkdir/mkdtemp.
 * This utility strips that, memoizes the result, and syncs the cleaned
 * value back to process.env so all child processes inherit a valid path.
 */
import * as os from "os";

let _cached: string | undefined;

export function safeTmpdir(): string {
  if (_cached === undefined) {
    _cached = os.tmpdir().replace(/[\r\n]+$/g, "");
    // Sync to global env so os.tmpdir() and child processes see the clean value
    if (process.env.TEMP !== _cached) process.env.TEMP = _cached;
    if (process.env.TMP !== _cached) process.env.TMP = _cached;
  }
  return _cached;
}
