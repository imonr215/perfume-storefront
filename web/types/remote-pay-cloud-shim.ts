/**
 * Shim for `remote-pay-cloud`, wired in via tsconfig.json's "paths" mapping.
 *
 * The package's own published `types/index.d.ts` re-exports directly from
 * its raw, uncompiled `.ts` source tree (`export {X} from "../src/..."`) --
 * confirmed by inspecting the installed package -- rather than from
 * compiled declaration files. That source tree doesn't satisfy this
 * project's strict-mode TypeScript settings (implicit-any errors deep in
 * files this project never touches), which breaks `npm run build` the
 * moment anything imports the package at all.
 *
 * IMPORTANT: this file must be a genuine runtime re-export, not just a type
 * declaration -- confirmed live that Next's bundler (Turbopack) honors
 * tsconfig's `paths` for actual module resolution too, not only the
 * type-checker. An earlier version of this file used a type-only
 * `declare const cloverSdk: any`, which compiles fine but produces no real
 * JS value, and threw `ReferenceError: cloverSdk is not defined` at runtime
 * the moment anything imported "remote-pay-cloud" and actually got this
 * file instead. Importing the package's real entry point via an explicit
 * subpath (bypassing its broken "types" field, which only the bare
 * specifier consults) is what makes both the real runtime code AND the
 * type-checker happy at once.
 *
 * The real shape this SDK actually has, verified live against the
 * installed package's runtime source rather than its types, is documented
 * and used in lib/clover-connector.ts.
 */
import realCloverSdk from "remote-pay-cloud/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cloverSdk: any = realCloverSdk;
export default cloverSdk;
