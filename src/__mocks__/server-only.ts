// Vitest stub for the Next.js `server-only` sentinel package.
//
// The real `server-only` (https://www.npmjs.com/package/server-only) is a
// build-time marker: importing it from a file destined for the client bundle
// throws at compile time, guaranteeing server-only code never ships to the
// browser. Under Vitest (node environment) there is no client/server split,
// so the sentinel is unnecessary — we alias it to this empty module via
// `resolve.alias` in vitest.config.ts.
//
// Side effect: none.
export {};
