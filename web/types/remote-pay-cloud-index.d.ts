// Ambient declaration for the exact subpath types/remote-pay-cloud-shim.ts
// imports directly (bypassing the package's own broken "types" field --
// see that file's comment). A bodyless `declare module` is enough: it
// tells TypeScript this specifier exists and every export from it is `any`.
declare module "remote-pay-cloud/index.js";
