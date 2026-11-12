// Film mode: on for the capture (?capture=1) and for previewing it (?film=1). It pushes out
// the ranges at which full detail is drawn (trees, grass, shrubs) and sharpens shadows and
// foliage textures. Far too heavy for play on an integrated GPU; a film frame can wait.
const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const FILM = !!query && (query.has('capture') || query.has('film'));
