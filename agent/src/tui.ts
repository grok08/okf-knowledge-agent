import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { answerQuestion, type AgentRun } from "./agent.js";
import type { OkfBundle } from "./bundle.js";

type AskQuestion = (bundle: OkfBundle, question: string) => Promise<AgentRun>;
type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: { marker: string; text: string }[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lines: string[] };

function removeInternalPathFragments(text: string): string {
  return text.replace(/\s*\{\s*"path"\s*:\s*"[^"]+"\s*\}/g, "");
}

function style(text: string, code: number, terminal: boolean): string {
  return terminal ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function writeHeader(bundle: OkfBundle, output: Writable, terminal: boolean, terminalWidth?: number): void {
  output.write(`\n  ${style("InfoMagnus OKF Chat", 1, terminal)}\n`);
  output.write(`  ${style("────────────────────", 90, terminal)}\n`);
  const detail = `${bundle.concepts.length} concepts  ·  ${process.env.GROQ_MODEL ?? "openai/gpt-oss-120b"}`;
  const detailLines = terminalWidth === undefined ? [`  ${detail}`] : wrapText(detail, Math.max(20, terminalWidth - 2), "  ", "  ");
  output.write(`${detailLines.join("\n")}\n`);
  const hint = "Ask about the knowledge base. Type /help for commands.";
  const hintLines = terminalWidth === undefined ? [`  ${hint}`] : wrapText(hint, Math.max(20, terminalWidth - 2), "  ", "  ");
  output.write(`${hintLines.join("\n")}\n`);
}

function printHelp(output: Writable, terminalWidth?: number): void {
  output.write("\n");
  const commands: [string, string][] = [["/compose", "Write a multiline question"], ["/help", "Show available commands"], ["/clear", "Clear the screen"], ["/quit", "End this chat"], ["/exit", "End this chat"]];
  for (const [command, description] of commands) {
    const line = `  ${command.padEnd(10)}${description}`;
    const lines = terminalWidth === undefined ? [line] : wrapText(line, terminalWidth, "  ", "  ");
    output.write(`${lines.join("\n")}\n`);
  }
}

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  for (let index = 0; index < lines.length;) {
    const rawLine = lines[index] ?? "";
    if (!rawLine.trim()) {
      index += 1;
      continue;
    }
    const fence = rawLine.match(/^\s*(```+|~~~+)/)?.[1];
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${fence[0]}{${fence.length},}`).test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", lines: code });
      continue;
    }
    const line = removeInternalPathFragments(rawLine);
    const heading = line.match(/^\s*(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      index += 1;
      continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
        quote.push(removeInternalPathFragments(lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: quote.join(" ") });
      continue;
    }
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) {
      const items: { marker: string; text: string }[] = [];
      while (index < lines.length) {
        const item = removeInternalPathFragments(lines[index] ?? "").match(/^\s*((?:[-*+]|\d+[.)])\s+)(.*)$/);
        if (item) {
          const sourceMarker = item[1] ?? "- ";
          items.push({ marker: /^\d/.test(sourceMarker) ? sourceMarker : "• ", text: item[2] ?? "" });
          index += 1;
          while (index < lines.length && /^\s{2,}\S/.test(lines[index] ?? "")) {
            const continuation = lines[index]?.trim();
            if (continuation) items[items.length - 1]!.text += ` ${continuation}`;
            index += 1;
          }
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() && !/^\s*(?:#{1,3}\s|```|~~~|>|[-*+]\s+|\d+[.)]\s+)/.test(lines[index] ?? "")) {
      paragraph.push(removeInternalPathFragments(lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

function inlineMarkdown(text: string, terminal: boolean): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*(.+?)\*\*/g, (_match, value: string) => style(value, 1, terminal))
    .replace(/__(.+?)__/g, (_match, value: string) => style(value, 1, terminal))
    .replace(/`([^`]+)`/g, (_match, value: string) => style(value, 90, terminal))
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_match, value: string) => style(value, 3, terminal))
    .replace(/(?<!_)_([^_]+)_(?!_)/g, (_match, value: string) => style(value, 3, terminal));
}

function stripTerminalStyles(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function wrapText(text: string, width: number, firstIndent = "", continuationIndent = firstIndent): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [firstIndent.trimEnd()];
  const lines: string[] = [];
  let line = firstIndent;
  for (const word of words) {
    const separator = visibleWidth(stripTerminalStyles(line)) > visibleWidth(firstIndent) ? " " : "";
    if (visibleWidth(stripTerminalStyles(line)) + visibleWidth(separator + word) <= width) {
      line += `${separator}${word}`;
      continue;
    }

    if (stripTerminalStyles(line).trim()) lines.push(line.trimEnd());
    line = continuationIndent;
    let remainder = [...word];
    while (visibleWidth(remainder.join("")) > Math.max(1, width - visibleWidth(stripTerminalStyles(line)))) {
      let available = 0;
      let usedWidth = 0;
      while (available < remainder.length && usedWidth + visibleWidth(remainder[available] ?? "") <= Math.max(1, width - visibleWidth(stripTerminalStyles(line)))) {
        usedWidth += visibleWidth(remainder[available] ?? "");
        available += 1;
      }
      lines.push(`${line}${remainder.slice(0, available).join("")}`);
      remainder = remainder.slice(available);
      line = continuationIndent;
    }
    line += remainder.join("");
  }
  if (stripTerminalStyles(line).trim() || lines.length === 0) lines.push(line.trimEnd());
  return lines;
}

function visibleWidth(text: string): number {
  return [...text].reduce((width, character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const wide = codePoint >= 0x1100 && (
      codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) || (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) || (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) || (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) || (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    );
    return width + (wide ? 2 : 1);
  }, 0);
}

function wrapInline(text: string, width: number, terminal: boolean, firstIndent = "", continuationIndent = firstIndent): string[] {
  const words = text.match(/\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*.+?\*\*|__.+?__|`[^`]+`|(?<!\*)\*[^*]+\*(?!\*)|(?<!_)_[^_]+_(?!_)|\S+/g) ?? [];
  const lines: string[] = [];
  let line = firstIndent;
  let measured = visibleWidth(firstIndent);
  for (const word of words) {
    const rendered = inlineMarkdown(word, terminal);
    const wordWidth = visibleWidth(rendered);
    if (measured + (measured > visibleWidth(firstIndent) ? 1 : 0) + wordWidth > width && measured > visibleWidth(firstIndent)) {
      lines.push(line);
      line = continuationIndent;
      measured = visibleWidth(continuationIndent);
    } else if (measured > visibleWidth(firstIndent)) {
      line += " ";
      measured += 1;
    }
    if (wordWidth + measured > width && measured === visibleWidth(continuationIndent)) {
      const fragments = wrapText(stripTerminalStyles(rendered), width, "", continuationIndent);
      lines.push(...fragments.slice(0, -1));
      line += fragments[fragments.length - 1] ?? "";
      measured += visibleWidth(fragments[fragments.length - 1] ?? "");
    } else {
      line += rendered;
      measured += wordWidth;
    }
  }
  if (line.trim() || lines.length === 0) lines.push(line);
  return lines;
}

function renderMarkdown(markdown: string, width: number | undefined, terminal: boolean): string[] {
  const lines: string[] = [];
  for (const block of parseMarkdown(markdown)) {
    if (lines.length) lines.push("");
    const wrap = (text: string, firstIndent = "", continuationIndent = firstIndent) =>
      width === undefined ? [`${firstIndent}${inlineMarkdown(text, terminal)}`] : wrapInline(text, width, terminal, firstIndent, continuationIndent);
    switch (block.kind) {
      case "heading":
        lines.push(...wrap(block.text).map((line) => style(line, block.level === 1 ? 1 : 36, terminal)));
        break;
      case "paragraph":
        lines.push(...wrap(block.text));
        break;
      case "list":
        for (const item of block.items) {
          lines.push(...wrap(item.text, item.marker, " ".repeat([...item.marker].length)));
        }
        break;
      case "quote":
        lines.push(...wrap(block.text, "│ ", "│ ").map((line) => style(line, 90, terminal)));
        break;
      case "code":
        lines.push(...block.lines.flatMap((line) => width === undefined ? [`  ${line}`] : wrapText(line, Math.max(1, width - 2), "  ", "  ")).map((line) => style(line, 90, terminal)));
        break;
    }
  }
  return lines;
}

function printAnswer(run: AgentRun, output: Writable, terminal: boolean, terminalWidth: number | undefined): void {
  output.write(`\n  ${style("InfoMagnus", 36, terminal)}\n\n`);
  const contentWidth = terminalWidth === undefined ? undefined : Math.max(20, terminalWidth - 2);
  for (const line of renderMarkdown(run.answer, contentWidth, terminal)) output.write(`${line ? `  ${line}` : ""}\n`);
  if (run.sources.length) {
    output.write(`\n  ${style("Sources", 2, terminal)}\n`);
    for (const source of run.sources) {
      const sourceLines = contentWidth === undefined ? [`• ${source}`] : wrapText(`• ${source}`, contentWidth, "", "  ");
      output.write(`${sourceLines.map((line) => `  ${line}`).join("\n")}\n`);
    }
  }
  if (run.unsupportedCitations.length) {
    output.write(`\n  ${style("Unverified citations", 33, terminal)}\n`);
    for (const citation of run.unsupportedCitations) {
      const citationLines = contentWidth === undefined ? [citation] : wrapText(citation, contentWidth, "", "  ");
      output.write(`${citationLines.map((line) => `  ${line}`).join("\n")}\n`);
    }
  }
  const toolCount = `${run.toolCalls.length} tool ${run.toolCalls.length === 1 ? "call" : "calls"}`;
  const metrics = `${toolCount}  ·  ${run.latencyMs} ms`;
  const metadata = `${run.model}  ·  ${metrics}`;
  const metadataLines = contentWidth === undefined ? [metadata] : wrapText(metadata, contentWidth, "", "  ");
  output.write(`\n${metadataLines.map((line) => `  ${style(line, 90, terminal)}`).join("\n")}\n`);
  if (run.inputTokens !== null || run.outputTokens !== null) {
    const tokens = `${run.inputTokens ?? "?"} in / ${run.outputTokens ?? "?"} out`;
    const tokenLines = contentWidth === undefined ? [tokens] : wrapText(tokens, contentWidth, "", "  ");
    output.write(`${tokenLines.map((line) => `  ${style(line, 90, terminal)}`).join("\n")}\n`);
  }
}

export async function runTui(
  bundle: OkfBundle,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  ask: AskQuestion = (knowledge, question) => answerQuestion(knowledge, question, {
    maxSteps: Number(process.env.MAX_AGENT_STEPS ?? "10"),
    ...(process.env.GROQ_MODEL ? { model: process.env.GROQ_MODEL } : {}),
  }),
  terminal = input === process.stdin && output === process.stdout && Boolean(process.stdin.isTTY && process.stdout.isTTY),
): Promise<void> {
  const readline = createInterface({ input, output, terminal, prompt: "", historySize: 0 });
  const lines = readline[Symbol.asyncIterator]();
  const terminalWidth = terminal && "columns" in output && typeof output.columns === "number" ? output.columns : undefined;
  writeHeader(bundle, output, terminal, terminalWidth);
  try {
    for (;;) {
      const rawLine = await askLine(lines, output, `${style("›", 36, terminal)} `);
      if (rawLine === null) break;
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      if (line === "/quit" || line === "/exit") {
        output.write("\nGoodbye.\n");
        return;
      }
      if (line === "/help") {
        printHelp(output, terminalWidth);
        continue;
      }
      if (line === "/compose") {
        const result = await composeQuestion(lines, output, terminal);
        if (result.kind === "closed") return;
        if (result.kind === "cancelled") continue;
        await answer(result.question);
        continue;
      }
      if (line === "/clear") {
        if (terminal) output.write("\u001b[2J\u001b[H");
        writeHeader(bundle, output, terminal, terminalWidth);
        continue;
      }
      if (line.startsWith("/")) {
        output.write(`\n  Unknown command: ${line}. Type /help for commands.`);
        continue;
      }

      await answer(line);
    }
  } finally {
    readline.close();
  }

  async function answer(question: string): Promise<void> {
    if (!terminal) output.write(`\n  ${style("You", 1, terminal)}\n  ${question.split("\n").join("\n  ")}\n`);
    try {
      const run = await ask(bundle, question);
      printAnswer(run, output, terminal, terminalWidth);
    } catch (error) {
      output.write(`\n  ${style("Could not answer", 31, terminal)}: ${error instanceof Error ? error.message : "request failed"}\n`);
    }
  }
}

type ComposerResult = { kind: "submitted"; question: string } | { kind: "cancelled" } | { kind: "closed" };

async function askLine(lines: AsyncIterator<string>, output: Writable, prompt: string): Promise<string | null> {
  output.write(prompt);
  const next = await lines.next();
  return next.done ? null : next.value;
}

async function composeQuestion(
  lines: AsyncIterator<string>,
  output: Writable,
  terminal: boolean,
): Promise<ComposerResult> {
  const question: string[] = [];
  output.write(`\n  ${style("Multiline question", 36, terminal)}\n`);
  output.write(`  ${style("Enter /send to ask, or /cancel to return.", 90, terminal)}\n`);
  for (;;) {
    const line = await askLine(lines, output, `  ${style("│", 90, terminal)} `);
    if (line === null) return { kind: "closed" };
    if (line.trim() === "/cancel") {
      output.write("\n  Composition cancelled.\n");
      return { kind: "cancelled" };
    }
    if (line.trim() === "/send") {
      const text = question.join("\n").trim();
      if (!text) {
        output.write("\n  Empty question. Composition cancelled.\n");
        return { kind: "cancelled" };
      }
      return { kind: "submitted", question: text };
    }
    question.push(line);
  }
}
