import { relative, sep } from "node:path";
import type { OkfBundle } from "./bundle.js";
import { parseKnowledgeCatalog, type KnowledgeCatalog } from "./catalog.js";

export function exportKnowledgeCatalog(bundle: OkfBundle): KnowledgeCatalog {
  return parseKnowledgeCatalog({
    version: 1,
    concepts: bundle.concepts.map((concept) => ({
      ...concept,
      path: relative(bundle.root, concept.path).split(sep).join("/"),
      relations: concept.relations.map((relation) => ({
        ...relation,
        target: relative(bundle.root, relation.target).split(sep).join("/"),
      })),
    })),
  });
}