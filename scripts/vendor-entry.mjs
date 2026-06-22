import { Buffer } from "buffer";
import process from "process/browser.js";
globalThis.Buffer ??= Buffer;
globalThis.process ??= process;
export * from "isomorphic-git";
