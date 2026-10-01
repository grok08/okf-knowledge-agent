import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PagesBuildOptions = { outputDirectory?: string; apiBase?: string };

function normalizeApiBase(value: string): string {
  if (!value.trim()) return "";
  const normalized = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("PUBLIC_API_BASE must be an HTTPS origin.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_API_BASE must be an HTTPS origin.");
  }
  return url.origin;
}

export async function buildPages(options: PagesBuildOptions = {}): Promise<void> {
  const outputDirectory = options.outputDirectory ?? "dist/pages";
  const apiBase = normalizeApiBase(options.apiBase ?? "");
  await rm(outputDirectory, { recursive: true, force: true });
  const files: Array<[string, string]> = [
    ["index.html", "agent/web/index.html"],
    ["app.js", "agent/web/app.js"],
    ["theme.js", "agent/web/theme.js"],
    ["styles.css", "agent/web/styles.css"],
    ["vendor/marked.js", "node_modules/marked/lib/marked.esm.js"],
    ["vendor/purify.es.mjs", "node_modules/dompurify/dist/purify.es.mjs"],
  ];
  for (const [target, source] of files) {
    const destination = join(outputDirectory, target);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await writeFile(join(outputDirectory, "config.js"), `window.okfApiBase = ${JSON.stringify(apiBase)};\n`, "utf8");
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await buildPages({ apiBase: process.env.PUBLIC_API_BASE ?? "" });
  console.log("Built the GitHub Pages site in dist/pages.");
}

export async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? (await listFiles(path)).map((item) => join(entry.name, item).replaceAll("\\", "/"))
      : [entry.name];
  }));
  return nested.flat().sort();
}