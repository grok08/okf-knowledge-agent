import assert from "node:assert/strict";
import { OkfBundle } from "../agent/src/bundle.ts";
import { startGui } from "../agent/src/gui.ts";

const question = "Show Markdown rendering";
const markdown = `## A heading

**Bold text** and *italic text* with \`inline code\`.

- first item
- second item

| Name | Result |
| --- | --- |
| Safe | **Rendered** |

[Safe link](https://example.com) [unsafe link](javascript:alert(1))

<script>window.markdownXss = true</script>

![remote pixel](https://example.com/pixel.png)`;
let receivedQuestion;
const server = await startGui(await OkfBundle.open(), {
  port: 0,
  ask: async (value) => {
    receivedQuestion = value;
    return {
      question: value,
      answer: markdown,
      toolCalls: [], conceptsDiscovered: [], conceptsRead: [], linksFollowed: 0,
      sources: [], unsupportedCitations: [], latencyMs: 1,
      inputTokens: null, outputTokens: null, stop: "completed", model: "test-model",
    };
  },
});
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}/`;
const pages = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = pages.find((candidate) => candidate.url.startsWith("http://127.0.0.1:"));
if (!page) throw new Error("Headless Edge GUI tab not found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let id = 0;
const pending = new Map();
const browserErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.text);
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") browserErrors.push(message.params.entry.text);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const command = (method, params = {}) => new Promise((resolve) => {
  const requestId = ++id;
  pending.set(requestId, resolve);
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true })).result.result.value;
try {
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Log.enable");
  await command("Page.navigate", { url });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const initial = JSON.parse(await evaluate(`JSON.stringify({
    title:document.title,
    composerTag:document.querySelector('#question').tagName,
    composerType:document.querySelector('#question').type,
    composerLength:document.querySelector('#question').getAttribute('maxlength'),
    scrollbar:getComputedStyle(document.querySelector('#conversation')).scrollbarWidth,
    webkitScrollbar:getComputedStyle(document.querySelector('#conversation'),'::-webkit-scrollbar').display,
    vendorStatus:performance.getEntriesByType('resource').filter(x=>x.name.includes('/vendor/')).map(x=>x.responseStatus),
    viewport:innerWidth,
    pageWidth:document.documentElement.scrollWidth
  })`));
  assert.equal(initial.title, "InfoMagnus OKF Chat");
  assert.equal(initial.composerTag, "INPUT");
  assert.equal(initial.composerType, "text");
  assert.equal(initial.composerLength, "4000");
  assert.equal(initial.scrollbar, "none");
  assert.equal(initial.webkitScrollbar, "none");
  assert.ok(initial.vendorStatus.every((status) => status === 200), `vendor modules loaded: ${initial.vendorStatus}`);

  await command("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  const mobileWidth = JSON.parse(await evaluate("JSON.stringify({viewport:innerWidth,page:document.documentElement.scrollWidth,conversation:document.querySelector('#conversation').scrollWidth,client:document.querySelector('#conversation').clientWidth})"));
  assert.ok(mobileWidth.page <= mobileWidth.viewport, `mobile page width ${mobileWidth.page} fits viewport ${mobileWidth.viewport}`);
  const errorsBeforeSubmit = browserErrors.length;
  await evaluate(`(() => { const e=document.querySelector('#question'); e.focus(); e.value=${JSON.stringify(question)}; e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await evaluate("document.querySelector('#composer').requestSubmit()");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const submissionState = await evaluate(`JSON.stringify({
    value:document.querySelector('#question').value,
    disabled:document.querySelector('#question').disabled,
    sendDisabled:document.querySelector('#send').disabled,
    turnList:document.querySelector('#turn-list').innerText,
    form:document.querySelector('#composer').outerHTML
  })`);
  if (!receivedQuestion) console.log(JSON.stringify({ submissionState:JSON.parse(submissionState), browserErrors }, null, 2));
  assert.equal(receivedQuestion, question, "Submitting the single-line field forwards the typed question");
  assert.deepEqual(browserErrors.slice(errorsBeforeSubmit), [], "chat module and Markdown renderer produce no browser errors");
  const rendered = JSON.parse(await evaluate(`JSON.stringify({
    html:document.querySelector('.answer-text').innerHTML,
    heading:document.querySelector('.answer-text h2')?.textContent,
    bold:document.querySelector('.answer-text strong')?.textContent,
    italic:document.querySelector('.answer-text em')?.textContent,
    code:document.querySelector('.answer-text code')?.textContent,
    listItems:document.querySelectorAll('.answer-text li').length,
    table:!!document.querySelector('.answer-text table'),
    safeLink:(()=>{const a=document.querySelector('.answer-text a');return a?{href:a.href,target:a.target,rel:a.rel}:null})(),
    script:!!document.querySelector('.answer-text script'),
    xss:window.markdownXss===true,
    image:!!document.querySelector('.answer-text img'),
    horizontalOverflow:document.documentElement.scrollWidth>innerWidth
  })`));
  if (rendered.heading !== "A heading") console.log(JSON.stringify({ rendered, browserErrors }, null, 2));
  assert.equal(rendered.heading, "A heading");
  assert.equal(rendered.bold, "Bold text");
  assert.equal(rendered.italic, "italic text");
  assert.equal(rendered.code, "inline code");
  assert.equal(rendered.listItems, 2);
  assert.equal(rendered.table, true);
  assert.deepEqual(rendered.safeLink, { href: "https://example.com/", target: "_blank", rel: "noreferrer noopener" });
  assert.equal(rendered.script, false);
  assert.equal(rendered.xss, false);
  assert.equal(rendered.image, false);
  assert.equal(rendered.horizontalOverflow, false);
  console.log(JSON.stringify({ initial, rendered }, null, 2));
} finally {
  await command("Emulation.clearDeviceMetricsOverride");
  socket.close();
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
