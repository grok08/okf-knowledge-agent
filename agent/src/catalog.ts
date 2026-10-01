import { z } from "zod";
import { conceptTypes, relationKinds, type Concept } from "./types.js";

const relativePathSchema = z.string().min(1).refine((path) =>
  !path.startsWith("/")
  && !path.includes("\\")
  && path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
);

const evidenceSchema = z.object({ source: z.string().url(), quote: z.string() });

const relationSchema = z.object({
  kind: z.enum(relationKinds),
  target: relativePathSchema,
  evidence: evidenceSchema,
});

const conceptSchema = z.object({
  path: relativePathSchema,
  type: z.enum(conceptTypes),
  title: z.string(),
  description: z.string(),
  resource: z.string().url(),
  tags: z.array(z.string()),
  evidence: evidenceSchema,
  relations: z.array(relationSchema),
});

export const knowledgeCatalogSchema = z.object({
  version: z.literal(1),
  concepts: z.array(conceptSchema),
}).superRefine((catalog, context) => {
  const paths = new Set<string>();
  for (const [index, concept] of catalog.concepts.entries()) {
    if (paths.has(concept.path)) {
      context.addIssue({ code: "custom", path: ["concepts", index, "path"], message: `Duplicate concept path: ${concept.path}` });
    }
    paths.add(concept.path);
  }
  for (const [index, concept] of catalog.concepts.entries()) {
    for (const [relationIndex, relation] of concept.relations.entries()) {
      if (!paths.has(relation.target)) {
        context.addIssue({ code: "custom", path: ["concepts", index, "relations", relationIndex, "target"], message: `Unknown concept path: ${relation.target}` });
      }
    }
  }
});

export type KnowledgeConcept = Concept;
export type KnowledgeCatalog = z.infer<typeof knowledgeCatalogSchema>;

export function parseKnowledgeCatalog(input: unknown): KnowledgeCatalog {
  return knowledgeCatalogSchema.parse(input);
}