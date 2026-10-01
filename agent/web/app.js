import { marked } from "./vendor/marked.js";
import DOMPurify from "./vendor/purify.es.mjs";

/** @typedef {'light' | 'dark'} Theme */
/** @typedef {{kind: 'pending', id: string, question: string} | {kind: 'answered', id: string, question: string, run: object} | {kind: 'failed', id: string, question: string, message: string}} Turn */
/** @typedef {{turns: Turn[], draft: string, pending: boolean}} ChatState */
/** @type {ChatState} */
const state = { turns: [], draft: "", pending: false };
const conversation = document.querySelector("#conversation");
const turnList = document.querySelector("#turn-list");
const welcome = document.querySelector("#welcome");
const composer = document.querySelector("#composer");
const questionField = document.querySelector("#question");
const sendButton = document.querySelector("#send");
const composerError = document.querySelector("#composer-error");
const themeToggle = document.querySelector("#theme-toggle");
const themeLabel = themeToggle.querySelector(".theme-label");
setTheme(window.okfTheme.current, window.okfTheme.explicit);

function setTheme(theme, explicit) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.okfTheme.current = theme;
  window.okfTheme.explicit = explicit;
  themeLabel.textContent = theme === "dark" ? "Light" : "Dark";
  themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} appearance`);
  try {
    if (explicit) localStorage.setItem(window.okfTheme.key, theme);
    else localStorage.removeItem(window.okfTheme.key);
  } catch {
    // The selected appearance still applies for this page when storage is unavailable.
  }
}

themeToggle.addEventListener("click", () => {
  setTheme(window.okfTheme.current === "dark" ? "light" : "dark", true);
});

function textElement(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function renderMarkdown(markdown) {
  const answer = document.createElement("div");
  answer.className = "answer-text";
  answer.innerHTML = DOMPurify.sanitize(marked.parse(markdown), { FORBID_TAGS: ["img"] });
  for (const link of answer.querySelectorAll("a")) {
    try {
      const url = new URL(link.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        link.replaceWith(document.createTextNode(link.textContent ?? link.href));
        continue;
      }
      link.target = "_blank";
      link.rel = "noreferrer noopener";
    } catch {
      link.replaceWith(document.createTextNode(link.textContent ?? link.href));
    }
  }
  return answer;
}

function addSources(parent, sources) {
  if (!sources.length) return;
  const section = document.createElement("section");
  section.className = "sources-section";
  section.append(textElement("h3", "section-label", "Sources"));
  const list = document.createElement("ul");
  list.className = "source-list";
  for (const source of sources) {
    const item = document.createElement("li");
    try {
      const url = new URL(source);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported source URL");
      const link = document.createElement("a");
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = source;
      item.append(link);
    } catch {
      item.append(textElement("span", "source-text", source));
    }
    list.append(item);
  }
  section.append(list);
  parent.append(section);
}

function addDetails(parent, run) {
  const details = document.createElement("details");
  details.className = "run-details";
  details.append(textElement("summary", "", "Run details"));
  const content = document.createElement("dl");
  content.className = "metadata-list";
  const entries = [
    ["Model", run.model],
    ["Time", `${run.latencyMs} ms`],
    ["Tool calls", String(run.toolCalls.length)],
    ["Concepts discovered", run.conceptsDiscovered.join(", ") || "None"],
    ["Concepts read", run.conceptsRead.join(", ") || "None"],
    ["Relationships followed", String(run.linksFollowed)],
    ["Tokens", `Input ${run.inputTokens ?? "unavailable"}, output ${run.outputTokens ?? "unavailable"}`],
    ["Stopped", run.stop],
  ];
  for (const [label, value] of entries) {
    content.append(textElement("dt", "", label), textElement("dd", "", value));
  }
  details.append(content);
  if (run.unsupportedCitations.length) {
    const warning = document.createElement("p");
    warning.className = "citation-warning";
    warning.append(textElement("strong", "", "Unverified citations: "));
    warning.append(document.createTextNode(run.unsupportedCitations.join(", ")));
    details.append(warning);
  }
  parent.append(details);
}

function renderTurn(turn) {
  const article = document.createElement("article");
  article.className = `turn turn-${turn.kind}`;
  article.dataset.turnId = turn.id;
  article.append(textElement("p", "question-bubble", turn.question));
  if (turn.kind === "pending") {
    const status = textElement("p", "pending-message", "Finding an answer...");
    status.setAttribute("role", "status");
    article.append(status);
  } else if (turn.kind === "failed") {
    const failure = document.createElement("div");
    failure.className = "failure-card";
    failure.append(textElement("p", "", turn.message));
    const retry = textElement("button", "retry-button", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => {
      questionField.value = turn.question;
      state.draft = turn.question;
      void submitQuestion(turn.question);
    });
    failure.append(retry);
    article.append(failure);
  } else {
    article.append(renderMarkdown(turn.run.answer));
    addSources(article, turn.run.sources);
    addDetails(article, turn.run);
  }
  return article;
}

function render() {
  welcome.hidden = state.turns.length > 0;
  turnList.replaceChildren(...state.turns.map(renderTurn));
  sendButton.disabled = state.pending || !questionField.value.trim();
  questionField.disabled = state.pending;
  sendButton.querySelector("span").textContent = state.pending ? "Sending" : "Send";
  conversation.scrollTop = conversation.scrollHeight;
}

function parseRun(value) {
  if (typeof value !== "object" || value === null) throw new Error("The server returned an invalid answer. Please try again.");
  const run = value;
  if (typeof run.question !== "string" || typeof run.answer !== "string"
    || typeof run.model !== "string" || typeof run.latencyMs !== "number"
    || !Array.isArray(run.sources) || !run.sources.every((item) => typeof item === "string")
    || !Array.isArray(run.unsupportedCitations) || !run.unsupportedCitations.every((item) => typeof item === "string")
    || !Array.isArray(run.toolCalls) || !Array.isArray(run.conceptsDiscovered)
    || !run.conceptsDiscovered.every((item) => typeof item === "string")
    || !Array.isArray(run.conceptsRead) || !run.conceptsRead.every((item) => typeof item === "string")
    || typeof run.linksFollowed !== "number" || (run.stop !== "completed" && run.stop !== "step-limit")) {
    throw new Error("The server returned an invalid answer. Please try again.");
  }
  if ((run.inputTokens !== null && typeof run.inputTokens !== "number")
    || (run.outputTokens !== null && typeof run.outputTokens !== "number")) {
    throw new Error("The server returned an invalid answer. Please try again.");
  }
  return run;
}

async function submitQuestion(rawQuestion) {
  if (state.pending) return;
  const question = rawQuestion.trim();
  if (!question) {
    questionField.focus();
    return;
  }
  state.draft = question;
  state.pending = true;
  composerError.hidden = true;
  const id = crypto.randomUUID();
  state.turns.push({ kind: "pending", id, question });
  questionField.value = "";
  render();
  try {
    const response = await fetch(`${window.okfApiBase ?? ""}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The answer could not be generated. Please try again.");
    state.turns[state.turns.length - 1] = { kind: "answered", id, question, run: parseRun(payload.run) };
    state.draft = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "The answer could not be generated. Please try again.";
    state.turns[state.turns.length - 1] = { kind: "failed", id, question, message };
    state.draft = question;
    questionField.value = question;
    composerError.textContent = "Your question is still here. Edit it or try again.";
    composerError.hidden = false;
  } finally {
    state.pending = false;
    render();
    if (state.draft) questionField.focus();
  }
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitQuestion(questionField.value);
});

questionField.addEventListener("input", () => {
  state.draft = questionField.value;
  sendButton.disabled = state.pending || !questionField.value.trim();
});

document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    questionField.value = button.textContent;
    state.draft = questionField.value;
    composer.requestSubmit();
  });
});

render();
