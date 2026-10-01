import matter from "gray-matter";
import { readFile, readdir, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import { createHash } from "node:crypto";
import { categoryFor, conceptTypes, inferConceptType, relationKinds, slugify, type Concept, type ConceptType, type Inventory } from "./types.js";

const categories = ["company", "services", "solutions", "industries", "technologies", "capabilities", "case-studies", "insights"] as const;
const frontmatterSchema = z.object({
  type: z.enum(conceptTypes),
  title: z.string(),
  description: z.string(),
  resource: z.string().url(),
  tags: z.array(z.string()).optional(),
  evidence: z.object({ resource: z.string().url(), quote: z.string() }),
  relations: z.array(z.object({ kind: z.enum(relationKinds), target: z.string(), title: z.string().optional(), evidence: z.object({ resource: z.string().url(), quote: z.string() }) })).optional(),
}).passthrough();

export type ValidationIssue = { path: string; code: string; message: string };
export type SearchHit = { path: string; title: string; type: ConceptType; score: number; matchedFields: string[] };

function safePath(root: string, path: string): string {
  const absolute = resolve(root, path);
  const relativePath = relative(resolve(root), absolute);
  if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || resolve(root) === absolute) {
    throw new Error(`Invalid bundle path: ${path}`);
  }
  return absolute;
}

async function markdownFiles(root: string, directory = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(root, path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
}

function parseConcept(path: string, content: string): Concept | null {
  const parsed = matter(content);
  const result = frontmatterSchema.safeParse(parsed.data);
  if (!result.success) return null;
  const fields = result.data;
  const relations = (fields.relations ?? []).map((relation) => ({
    target: resolve(dirname(path), relation.target),
    kind: relation.kind,
    evidence: { source: relation.evidence.resource, quote: relation.evidence.quote },
  }));
  return {
    path,
    type: fields.type,
    title: fields.title,
    description: fields.description,
    resource: fields.resource,
    tags: fields.tags ?? [],
    evidence: { source: fields.evidence.resource, quote: fields.evidence.quote },
    relations,
  };
}

export class OkfBundle {
  readonly concepts: readonly Concept[];

  private constructor(readonly root: string, concepts: Concept[]) {
    this.concepts = concepts;
  }

  static async open(root = "okf"): Promise<OkfBundle> {
    const files = await markdownFiles(resolve(root));
    const concepts: Concept[] = [];
    for (const path of files) {
      if (path.endsWith(`${sep}index.md`) || path.endsWith(`${sep}log.md`) || path === resolve(root, "index.md")) continue;
      const concept = parseConcept(path, await readFile(path, "utf8"));
      if (concept) concepts.push(concept);
    }
    return new OkfBundle(resolve(root), concepts);
  }

  list(type?: ConceptType): readonly Concept[] {
    return this.concepts.filter((concept) => type === undefined || concept.type === type);
  }

  read(path: string): Concept | undefined {
    return this.concepts.find((concept) => concept.path === safePath(this.root, path));
  }

  follow(path: string): readonly Concept[] {
    const concept = this.read(path);
    if (!concept) return [];
    return concept.relations.map((relation) => this.concepts.find((item) => item.path === relation.target))
      .filter((item): item is Concept => item !== undefined);
  }

  search(query: string, limit = 10): readonly SearchHit[] {
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
    if (terms.length === 0) return [];
    return this.concepts.map((concept) => {
      const fields: Array<[string, string, number]> = [
        ["title", concept.title, 5],
        ["type", concept.type, 3],
        ["description", concept.description, 2],
        ["tags", concept.tags.join(" "), 2],
      ];
      const matchedFields = fields.filter(([, value]) => terms.some((term) => value.toLowerCase().includes(term))).map(([name]) => name);
      const score = fields.reduce((total, [, value, weight]) => total + terms.filter((term) => value.toLowerCase().includes(term)).length * weight, 0);
      return { path: relative(this.root, concept.path).split(sep).join("/"), title: concept.title, type: concept.type, score, matchedFields };
    }).filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
  }

  async validate(): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const rootIndex = join(this.root, "index.md");
    try {
      await readFile(rootIndex, "utf8");
    } catch {
      issues.push({ path: "index.md", code: "missing-root-index", message: "Root index.md is required." });
    }
    for (const category of categories) {
      try {
        await readFile(join(this.root, category, "index.md"), "utf8");
      } catch {
        issues.push({ path: `${category}/index.md`, code: "missing-category-index", message: "Category index.md is required." });
      }
    }
    const byTitle = new Map<string, Concept>();
    const paths = new Set(this.concepts.map((concept) => concept.path));
    const markdownPaths = await markdownFiles(this.root);
    const markdownPathSet = new Set(markdownPaths);
    const sources = await readInventorySources();
    for (const concept of this.concepts) {
      const relativePath = relative(this.root, concept.path).split(sep).join("/");
      const duplicate = byTitle.get(`${concept.type}:${concept.title.toLowerCase()}`);
      if (duplicate) issues.push({ path: relativePath, code: "duplicate-concept", message: `Duplicate concept title also appears at ${relative(this.root, duplicate.path).split(sep).join("/")}.` });
      byTitle.set(`${concept.type}:${concept.title.toLowerCase()}`, concept);
      if (!sources.has(concept.resource)) issues.push({ path: relativePath, code: "invalid-source", message: `Source ${concept.resource} is missing from site-inventory.json.` });
      if (!concept.evidence.quote.trim() || !sources.get(concept.evidence.source)?.some((sourceText) => sourceText.includes(concept.evidence.quote))) {
        issues.push({ path: relativePath, code: "invalid-evidence", message: "Evidence quote must appear in its captured source page." });
      }
      if (concept.evidence.source !== concept.resource) issues.push({ path: relativePath, code: "evidence-source-mismatch", message: "Evidence source must match the concept resource." });
      if (!concept.description.trim()) issues.push({ path: relativePath, code: "missing-description", message: "Description is required." });
      for (const relation of concept.relations) {
        if (!paths.has(relation.target)) issues.push({ path: relativePath, code: "broken-link", message: `Related concept does not exist: ${relative(this.root, relation.target).split(sep).join("/")}.` });
        if (relation.evidence.source !== concept.resource || !sources.get(relation.evidence.source)?.some((sourceText) => sourceText.includes(relation.evidence.quote))) {
          issues.push({ path: relativePath, code: "invalid-relationship-evidence", message: "Relationship evidence must quote the captured source page." });
        }
      }
    }
    for (const path of markdownPaths) {
      if (path === rootIndex || path.endsWith(`${sep}index.md`) || path.endsWith(`${sep}log.md`)) continue;
      const content = await readFile(path, "utf8");
      const relativePath = relative(this.root, path).split(sep).join("/");
      if (!content.startsWith("---\n")) issues.push({ path: relativePath, code: "missing-frontmatter", message: "Concept requires YAML frontmatter." });
      const parsed = matter(content);
      if (!frontmatterSchema.safeParse(parsed.data).success) {
        issues.push({ path: relativePath, code: "missing-required-field", message: "Concept requires type, title, description, and resource fields." });
      }
      const links = [...parsed.content.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)];
      for (const match of links) {
        const destination = match[1];
        if (destination && !destination.includes(":") && !markdownPathSet.has(resolve(dirname(path), destination))) {
          issues.push({ path: relativePath, code: "broken-link", message: `Internal Markdown link does not exist: ${destination}.` });
        }
      }
      const category = relative(this.root, dirname(path)).split(sep)[0];
      if (!categories.some((allowedCategory) => allowedCategory === category)) issues.push({ path: relativePath, code: "invalid-category", message: "Concept must be stored in an OKF category directory." });
    }
    return issues;
  }
}

async function readInventorySources(): Promise<Map<string, string[]>> {
  try {
    const raw: unknown = JSON.parse(await readFile("site-inventory.json", "utf8"));
    if (typeof raw !== "object" || raw === null || !("pages" in raw) || !Array.isArray(raw.pages)) return new Map();
    return new Map(raw.pages.flatMap((page) => {
      if (typeof page !== "object" || page === null || !("url" in page) || !("text" in page) || typeof page.url !== "string" || typeof page.text !== "string") return [];
      const metadata = "metadata" in page && typeof page.metadata === "object" && page.metadata !== null
        ? Object.values(page.metadata).filter((value): value is string => typeof value === "string")
        : [];
      return [[page.url, [page.text, ...metadata]]];
    }));
  } catch {
    return new Map();
  }
}

function safeQuote(pageText: string, fallback: string, headings: readonly string[] = []): string {
  const lines = pageText.split("\n").map((line) => line.trim()).filter((line) => !headings.includes(line));
  return lines.find((line) => line.length >= 60 && line.length <= 360 && /[.!?]/.test(line))
    ?? lines.find((line) => line.length >= 30 && line.length <= 360)
    ?? fallback;
}

function paragraphQuote(pageText: string, fallback: string, headings: readonly string[]): string {
  const headingSet = new Set(headings.map((heading) => heading.trim().toLowerCase()));
  const lines = pageText.split("\n").map((line) => line.trim())
    .filter((line) => line.length >= 60 && !headingSet.has(line.toLowerCase()));
  const best = lines.find((line) => line.length <= 360 && /[.!?]/.test(line) && /\s/.test(line)) ?? lines[0];
  if (!best) return fallback;
  return best.length <= 360 ? best : `${best.slice(0, 357).trimEnd()}...`;
}

export async function convertInventory(inventory: Inventory, root = "okf"): Promise<number> {
  const candidates = inventory.pages.flatMap((page) => {
    const url = new URL(page.url);
    const type = inferConceptType(url);
    if (!type || page.text.length < 40 || !page.title.trim()) return [];
    const metadataDescription = page.metadata.description ?? page.metadata["og:description"];
    const description = metadataDescription && metadataDescription.length >= 60 && metadataDescription.length <= 360
      ? metadataDescription
      : paragraphQuote(page.text, page.text.slice(0, 240), page.headings);
    const category = categoryFor(type);
    const path = `${category}/${slugify(page.title) || slugify(url.pathname) || "page"}.md`;
    return [{ page, type, category, path, description }];
  }).sort((a, b) => a.page.url.localeCompare(b.page.url));
  const seenConcepts = new Set<string>();
  const concepts = candidates.filter((concept) => {
    const key = `${concept.type}:${concept.page.title.toLocaleLowerCase()}`;
    if (seenConcepts.has(key)) return false;
    seenConcepts.add(key);
    return true;
  });
  if (!inventory.complete) throw new Error("Refusing to convert an incomplete site inventory.");
  const sourceByUrl = new Map(inventory.pages.map((page) => [page.url, page.text]));
  const known = new Map(concepts.map((concept) => [concept.page.url, concept]));
  const paths = new Set<string>();
  for (const concept of concepts) {
    if (paths.has(concept.path)) throw new Error(`Two source pages map to the same concept path: ${concept.path}`);
    paths.add(concept.path);
  }
  const files = new Map<string, string>();
  const generatedPaths = new Set<string>();
  for (const concept of concepts) {
    const relations = concept.page.internalLinks.flatMap((link) => {
      const target = known.get(link.url);
      const anchor = link.text.replace(/^explore\s+/i, "").trim();
      if (!target || !anchor || !concept.page.text.toLowerCase().includes(anchor.toLowerCase())) return [];
      const excerpt = concept.page.text.split("\n").find((line) => line.toLowerCase().includes(anchor.toLowerCase()));
      if (!excerpt || !sourceByUrl.get(concept.page.url)?.includes(excerpt)) return [];
      return [{
        kind: "references",
        target: relative(dirname(concept.path), target.path).replaceAll("\\", "/"),
        evidence: { resource: concept.page.url, quote: excerpt },
        title: link.text,
      }];
    });
    const frontmatter = {
      type: concept.type,
      title: concept.page.title,
      description: concept.description,
      resource: concept.page.url,
      sources: [{ resource: concept.page.url }],
      status: concept.page.stale ? "stale" : "current",
      tags: concept.page.headings.slice(0, 8),
      evidence: { resource: concept.page.url, quote: concept.description },
      relations: relations.map(({ kind, target, evidence }) => ({ kind, target, evidence })),
      generated: true,
    };
    const markdown = `---\n${stringify(frontmatter)}---\n\n# ${concept.page.title}\n\n${concept.description}\n\n## Source evidence\n\n> ${concept.description}\n\n[Source page](${concept.page.url})\n${relations.length ? `\n## Related concepts\n\n${relations.map((relation) => `- [${relation.title}](${relation.target})\n  Evidence: "${relation.evidence.quote}"`).join("\n")}\n` : ""}`;
    files.set(concept.path, markdown);
    generatedPaths.add(concept.path);
  }
  await mkdir(root, { recursive: true });
  for (const category of categories) {
    const entries = concepts.filter((concept) => concept.category === category);
    files.set(`${category}/index.md`, `# ${category.replaceAll("-", " ")}\n\n${entries.map((concept) => `- [${concept.page.title}](./${slugify(concept.page.title) || slugify(new URL(concept.page.url).pathname) || "page"}.md)`).join("\n")}\n`);
  }
  files.set("index.md", `# InfoMagnus knowledge base\n\nOpen a category index to browse source-backed concepts.\n\n${categories.map((category) => `- [${category.replaceAll("-", " ")}](./${category}/index.md)`).join("\n")}\n`);
  files.set("log.md", `# Knowledge base log\n\nGenerated from ${inventory.pages.length} captured pages. ${concepts.length} source-backed concepts were written.\n`);
  const manifestPath = resolve(".okf-work", "generated-files.json");
  let generatedState: { files: Record<string, string> } = { files: {} };
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      raw = JSON.parse(await readFile(join(root, ".generated.json"), "utf8"));
    }
    if (typeof raw === "object" && raw !== null && "files" in raw && typeof raw.files === "object" && raw.files !== null && !Array.isArray(raw.files)) {
      const entries = Object.entries(raw.files);
      if (entries.every(([path, hash]) => typeof path === "string" && typeof hash === "string")) {
        generatedState = { files: Object.fromEntries(entries) };
      }
    }
  } catch {
    generatedState = { files: {} };
  }
  const hashes = new Map([...files].map(([path, content]) => [path, createHash("sha256").update(content).digest("hex")]));
  for (const [path, content] of files) {
    if (path.endsWith("/index.md") || path === "index.md" || path === "log.md") continue;
    try {
      const existing = await readFile(safePath(root, path), "utf8");
      const existingHash = createHash("sha256").update(existing).digest("hex");
      const previousHash = generatedState.files[path];
      if (previousHash === undefined && path.endsWith(".md")) {
        const parsed = matter(existing);
        if (parsed.data.generated !== true) continue;
      }
      if (previousHash !== undefined && existingHash !== previousHash && existing !== content) {
        throw new Error(`Refusing to overwrite a file not owned by this conversion or changed by hand: ${path}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Refusing to overwrite")) throw error;
    }
  }
  for (const [oldRelativePath, oldHash] of Object.entries(generatedState.files)) {
    if (generatedPaths.has(oldRelativePath)) continue;
    if (oldRelativePath === "index.md" || oldRelativePath === "log.md" || oldRelativePath.endsWith("/index.md")) continue;
    const oldPath = safePath(root, oldRelativePath);
    try {
      const content = await readFile(oldPath, "utf8");
      const currentHash = createHash("sha256").update(content).digest("hex");
      if (currentHash !== oldHash) throw new Error(`Refusing to delete a generated file changed by hand: ${oldRelativePath}`);
      await rm(oldPath);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Refusing to delete")) throw error;
    }
  }
  for (const [path, content] of files) {
    const destination = safePath(root, path);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, destination);
  }
  const manifest = Object.fromEntries([...hashes].filter(([path]) => generatedPaths.has(path)));
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(`${manifestPath}.tmp`, `${JSON.stringify({ files: manifest }, null, 2)}\n`, "utf8");
  await rename(`${manifestPath}.tmp`, manifestPath);
  const loaded = await OkfBundle.open(root);
  const issues = await loaded.validate();
  if (issues.length) throw new Error(`Generated OKF bundle has ${issues.length} validation issue(s): ${issues[0]?.message ?? "unknown issue"}`);
  return concepts.length;
}
