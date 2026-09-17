// A small handoff spot so js/viewmodel.js (pure, no DOM, no server imports) can resolve a mock
// Drive reference once dev/mock.js has loaded. js/api.js calls setMockPhotoResolver only when
// running against the "mock" backend; production code never touches this file's setter, so
// resolveMockPhoto always answers "" there and real Drive https links remain the only accepted
// photo source outside development.
let resolver = null;

export function setMockPhotoResolver(fn) {
  resolver = fn;
}

export function resolveMockPhoto(ref) {
  return resolver ? resolver(ref) : "";
}
