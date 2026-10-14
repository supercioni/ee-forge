/**
 * What to say when a 3D asset will not load.
 *
 * Written because a missing mesh used to take the whole editor down:
 * `useGLTF` throws on a 404, `<Suspense>` catches suspensions and not
 * errors, and with nothing to stop it the throw unmounted the React root.
 * Clicking a ship whose `.glb` was never produced looked like a crash.
 *
 * The boundary is the fix; this is the part worth testing. A loader error
 * is a wall of internal text, and the one thing an author needs from it is
 * **which file is missing**, said in the terms they can act on — a path
 * under `assets/`, not an absolute URL into the bridge.
 */

/** Turn the bridge's asset URL back into the repo path an author edits. */
export function assetPathOf(url: string): string {
  const at = url.indexOf("/assets/");
  const path = at === -1 ? url : url.slice(at + "/assets/".length);
  // The engine and cache-epoch the editor adds to a URL are not part of the file an author looks for.
  const query = path.indexOf("?");
  return query === -1 ? path : path.slice(0, query);
}

export function describeAssetFailure(error: unknown, url: string): string {
  const path = assetPathOf(url);
  const text = error instanceof Error ? error.message : String(error);

  // drei/three report a failed fetch with the status in the message. 404
  // is the case worth naming: the manifest promised a file the repo does
  // not have, which is a content gap, not a bug in the page.
  if (/\b404\b|not found/i.test(text)) {
    return `assets/${path} is missing — the manifest names it, but the file is not in the repo.`;
  }
  if (/\b(4\d\d|5\d\d)\b/.test(text)) {
    return `assets/${path} could not be fetched: ${text}`;
  }
  return `assets/${path} could not be read as glTF: ${text}`;
}
