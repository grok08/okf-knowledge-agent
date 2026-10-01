import "dotenv/config";
import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { answerQuestion } from "./agent.js";
import { OkfBundle, type ValidationIssue } from "./bundle.js";
import { convertInventory } from "./bundle.js";
import { crawlSite } from "./crawler.js";
import { runEvaluation } from "./evaluation.js";
import { startGui } from "./gui.js";
import { parseInventory } from "./types.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function printIssues(issues: ValidationIssue[]): void {
  if (issues.length === 0) {
    console.log("OKF validation passed");
    return;
  }
  for (const issue of issues) console.error(`${issue.path}: ${issue.code}: ${issue.message}`);
}

async function main(): Promise<void> {
  const [command = "chat", ...args] = process.argv.slice(2);
  if (command === "crawl") {
    const site = option(args, "--site") ?? "https://www.infomagnus.com/";
    const limit = Number(option(args, "--limit") ?? "100");
    if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
    if (!new URL(site).hostname.toLowerCase().endsWith("infomagnus.com")) throw new Error("Crawl site must be infomagnus.com or one of its subdomains.");
    const report = await crawlSite({ site, limit, inventoryPath: "site-inventory.json" });
    console.log(`Crawl ${report.inventory.complete ? "complete" : "partial"}. Pages: ${report.inventory.pages.length}. Changed: ${report.changed}. Unchanged: ${report.unchanged}. Rejected: ${report.rejected}.`);
    return;
  }
  if (command === "convert") {
    const inventory = parseInventory(JSON.parse(await readFile("site-inventory.json", "utf8")));
    console.log(`Generated ${await convertInventory(inventory)} concepts from ${inventory.pages.length} captured pages.`);
    return;
  }
  const bundle = await OkfBundle.open();
  if (command === "chat") {
    const port = Number(option(args, "--port") ?? "4317");
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be between 0 and 65535.");
    const server = await startGui(bundle, { port });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not determine GUI server address.");
    const url = `http://127.0.0.1:${address.port}`;
    console.log(`InfoMagnus OKF Chat is running at ${url}`);
    if (process.env.BROWSER !== "none") {
      const { execFile } = await import("node:child_process");
      if (process.platform === "win32") {
        execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url], (error) => {
          if (error) console.error(`Open this address in your browser: ${url}`);
        });
      } else {
        execFile(process.platform === "darwin" ? "open" : "xdg-open", [url], (error) => {
          if (error) console.error(`Open this address in your browser: ${url}`);
        });
      }
    }
    const close = (): void => { server.close(() => process.exit(0)); };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    return;
  }
  if (command === "validate") {
    const issues = await bundle.validate();
    printIssues(issues);
    if (issues.length) process.exitCode = 1;
    return;
  }
  if (command === "list") {
    for (const concept of bundle.list()) console.log(`${concept.type}\t${concept.title}\t${relative(bundle.root, concept.path).split(sep).join("/")}`);
    return;
  }
  if (command === "search") {
    const query = args.join(" ").trim();
    if (!query) throw new Error("Pass a search query.");
    for (const hit of bundle.search(query)) console.log(`${hit.score}\t${hit.type}\t${hit.title}\t${hit.path}`);
    return;
  }
  if (command === "ask") {
    const question = args.join(" ").trim();
    if (!question) throw new Error("Pass a question.");
    const run = await answerQuestion(bundle, question, {
      maxSteps: Number(process.env.MAX_AGENT_STEPS ?? "10"),
      ...(process.env.GROQ_MODEL ? { model: process.env.GROQ_MODEL } : {}),
    });
    console.log(`Question: ${run.question}`);
    console.log(`Model: ${run.model}`);
    console.log("Tool calls:");
    for (const call of run.toolCalls) console.log(`  ${call.name} ${JSON.stringify(call.arguments)}`);
    console.log(`Concepts discovered: ${run.conceptsDiscovered.join(", ") || "none"}`);
    console.log(`Concepts read: ${run.conceptsRead.join(", ") || "none"}`);
    console.log(`Relationships followed: ${run.linksFollowed}`);
    console.log(`Sources: ${run.sources.join(", ") || "none"}`);
    if (run.unsupportedCitations.length) console.log(`Unverified citations: ${run.unsupportedCitations.join(", ")}`);
    console.log(`Answer: ${run.answer}`);
    console.log(`Latency: ${run.latencyMs} ms`);
    console.log(`Tokens: input ${run.inputTokens ?? "unavailable"}, output ${run.outputTokens ?? "unavailable"}`);
    return;
  }
  if (command === "eval") {
    const records = await runEvaluation(bundle, undefined, undefined, process.env.GROQ_MODEL);
    console.log(`Evaluation complete. Recorded ${records.length} answers in evaluation/results/okf-results.json.`);
    return;
  }
  console.log("Commands: chat, crawl, convert, validate, list, search, ask, eval");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command failed.");
  process.exitCode = 1;
});
