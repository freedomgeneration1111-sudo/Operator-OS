import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const operationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const localState = path.join(operationsDirectory,".wrangler","state");
if (!localState.startsWith(`${operationsDirectory}${path.sep}`)) throw new Error("Refusing to remove a path outside operations/");
await rm(localState,{ recursive:true,force:true });
console.log("Removed operations/.wrangler/state; migrations and synthetic seed will be reapplied.");
