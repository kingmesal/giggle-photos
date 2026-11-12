// @hutch cli=0.29.0 cottontail=0.7.3
// Electrobun 2.x toolchain pins (see rfds/RFD-001). Exact versions only: Hutch
// does not accept semver ranges. Bun stays the package manager so bun.lock
// remains the single lockfile (no hutch.lock).
export default {
  electrobun: { version: "2.0.6" },
  packageManager: "bun",
};
