// Anything that caches partner data (key lookups, the CORS origin list) registers here, and
// the portal's /partners/sync clears all of it after every write. So a revoke, a suspend or a
// removed website applies straight away; the caches only save reads between changes.
const clearers: Array<() => void> = [];

export function onPartnersChanged(clear: () => void): void {
  clearers.push(clear);
}

export function partnersChanged(): void {
  for (const clear of clearers) clear();
}
