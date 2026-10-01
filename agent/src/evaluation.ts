import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { answerQuestion, type AgentRun } from "./agent.js";
import { OkfBundle } from "./bundle.js";

const evaluationSetSchema = z.array(z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expectedSources: z.array(z.string().url()).default([]),
}));

export type EvaluationCase = z.infer<typeof evaluationSetSchema>[number];
export type EvaluationRecord = { id: string; question: string; expectedSources: string[]; run: AgentRun };

export async function runEvaluation(bundle: OkfBundle, setPath = "evaluation/evaluation-set.json", outputPath = "evaluation/results/okf-results.json", model?: string): Promise<EvaluationRecord[]> {
  const raw: unknown = JSON.parse(await readFile(setPath, "utf8"));
  const cases = evaluationSetSchema.parse(raw);
  const records: EvaluationRecord[] = [];
  for (const evaluationCase of cases) {
    records.push({ ...evaluationCase, run: await answerQuestion(bundle, evaluationCase.question, model ? { model } : {}) });
  }
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ generatedAt: new Date().toISOString(), model: model ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b", records }, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  return records;
}
