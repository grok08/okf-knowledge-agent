import { createHash } from "node:crypto";
import { z } from "zod";

export const conceptTypes = [
  "Organization",
  "Service",
  "Solution",
  "Industry",
  "Technology",
  "Capability",
  "CaseStudy",
  "Insight",
  "Outcome",
] as const;

export type ConceptType = (typeof conceptTypes)[number];
export type Category =
  | "company"
  | "services"
  | "solutions"
  | "industries"
  | "technologies"
  | "capabilities"
  | "case-studies"
  | "insights";

export type Evidence = {
  source: string;
  quote: string;
};

export const relationKinds = ["supports", "uses", "serves", "demonstrated_by", "demonstrates", "discusses", "references"] as const;
export type RelationKind = (typeof relationKinds)[number];

export type Relation = {
  kind: RelationKind;
  target: string;
  evidence: Evidence;
};

export type Concept = {
  path: string;
  type: ConceptType;
  title: string;
  description: string;
  resource: string;
  tags: string[];
  evidence: Evidence;
  relations: Relation[];
};

export type SitePage = {
  url: string;
  title: string;
  headings: string[];
  text: string;
  internalLinks: Array<{ url: string; text: string }>;
  externalLinks: string[];
  metadata: Record<string, string>;
  contentHash: string;
  stale: boolean;
};

const sitePageSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  headings: z.array(z.string()),
  text: z.string(),
  internalLinks: z.array(z.object({ url: z.string().url(), text: z.string() })),
  externalLinks: z.array(z.string().url()),
  metadata: z.record(z.string(), z.string()),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  stale: z.boolean(),
});

export const inventorySchema = z.object({
  version: z.literal(1),
  site: z.string().url(),
  complete: z.boolean(),
  pages: z.array(sitePageSchema),
});

export type Inventory = z.infer<typeof inventorySchema>;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseInventory(input: unknown): Inventory {
  return inventorySchema.parse(input);
}

export function inferConceptType(url: URL): ConceptType | null {
  const path = url.pathname.toLowerCase();
  if (/^\/infomagnus-services\/[^/]+$/.test(path)) return "Service";
  if (/^\/infomagnus-solutions\/[^/]+$/.test(path)) return "Solution";
  if (/^\/infomagnus-partners\/[^/]+$/.test(path)) return "Organization";
  if (/^\/perspectives-and-insights\/[^/]+$/.test(path)) return "Insight";
  if (/^\/content-collection\/[^/]+$/.test(path)) return "Insight";
  if (path === "/" || path === "/about-us/about-infomagnus") return "Organization";
  return null;
}

export function categoryFor(type: ConceptType): Category {
  switch (type) {
    case "Organization": return "company";
    case "Service": return "services";
    case "Solution": return "solutions";
    case "Industry": return "industries";
    case "Technology": return "technologies";
    case "Capability": return "capabilities";
    case "CaseStudy": return "case-studies";
    case "Insight": return "insights";
    case "Outcome": return "capabilities";
  }
}

export function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
