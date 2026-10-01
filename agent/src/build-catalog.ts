import { mkdir, readFile, writeFile } from "node:fs/promises";
import { OkfBundle } from "./bundle.js";
import { exportKnowledgeCatalog } from "./catalog-export.js";

const bundle = await OkfBundle.open("okf");
const catalog = exportKnowledgeCatalog(bundle);
const outputDirectory = "dist/worker-assets";
await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/knowledge-catalog.json`, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
await writeFile(`${outputDirectory}/system-prompt.md`, await readFile("agent/prompts/system.md", "utf8"), "utf8");
console.log(`Exported ${catalog.concepts.length} concepts and the shared system prompt to ${outputDirectory}.`);