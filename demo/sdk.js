import { createDummySdk } from "./demo.sdk.js";

/**
 * Resolves the Engine SDK to use for the demo.
 *
 * To use this template in another repository:
 * 1. Modify this file to import your engine's SDK:
 *    import sdk from "../src/index.js"; // or "../dist/index.js"
 *    export async function getSdk() { return sdk; }
 *
 * 2. Or attach window.SDK before demo.js boots:
 *    window.SDK = myEngineSdk;
 */
export async function getSdk() {
  if (typeof window !== "undefined" && window.SDK) {
    return window.SDK;
  }
  return createDummySdk();
}
