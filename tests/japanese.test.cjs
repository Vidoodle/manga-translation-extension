"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { segments, WordHelp } = require("../src/shared/japanese.js");
const { harness } = require("./reader-harness.cjs");

const vocabulary = [
  { surface: "帰ら", reading: "かえら", meaning: "return (stem)" },
  { surface: "帰らなきゃ", reading: "かえらなきゃ", meaning: "have to go home" },
  { surface: "もう", reading: "もう", meaning: "already; now" },
];

function fixture(t, view = { width: 320, height: 200 }, closedShadow = false) {
  const env = harness();
  const create = env.doc.createElement;
  env.doc.createElement = (tag) => {
    const node = create(tag);
    node.removeAttribute = (name) => delete node.attributes[name];
    if (tag === "div") node.box = { x: 0, y: 0, width: 280, height: 84 };
    return node;
  };
  let portal = env.doc.documentElement;
  if (closedShadow) {
    const host = env.doc.createElement("div");
    env.doc.documentElement.append(host);
    portal = host.attachShadow({ mode: "closed" });
  }
  const help = new WordHelp({
    doc: env.doc,
    portal,
    viewport: () => view,
  });
  t.after(() => help.destroy());
  return { ...env, help, view, portal };
}

test("word segmentation preserves punctuation, repeats and exact source with longest matches", () => {
  const source = "「もう帰らなきゃ…」\nもう帰らなきゃ！🙂";
  const parts = segments(source, [
    ...vocabulary,
    { surface: "帰る", reading: "かえる", meaning: "go home" },
    { surface: "", reading: "", meaning: "" },
    null,
  ]);
  assert.equal(parts.map((part) => part.text).join(""), source);
  assert.deepEqual(
    parts.filter((part) => part.word).map((part) => part.text),
    ["もう", "帰らなきゃ", "もう", "帰らなきゃ"],
  );
  assert.deepEqual(segments("。\n🙂", vocabulary), [{ text: "。\n🙂" }]);
});

test("Japanese text and hostile vocabulary render as text without interpreting HTML", (t) => {
  const { help, doc } = fixture(t);
  const source = '帰らなきゃ。<img src=x onerror="evil()">';
  const word = {
    surface: "帰らなきゃ",
    reading: "<script>evil()</script>",
    meaning: "<b>home</b>",
  };
  const paragraph = help.render(source, [word]);
  doc.documentElement.append(paragraph);
  assert.equal(paragraph.children.map((node) => node.textContent).join(""), source);
  const button = paragraph.querySelector("button");
  assert.equal(button.className, "jp-word");
  assert.equal(button.type, "button");
  button.dispatch("pointerenter");
  assert.deepEqual(
    help.tip.children.map((node) => node.textContent),
    [word.surface, word.reading, word.meaning],
  );
  assert.equal(doc.documentElement.querySelectorAll("script,img,b").length, 0);
});

test("trusted hover, focus and click show local word help while synthetic events do nothing", (t) => {
  const { help, doc, calls } = fixture(t);
  const paragraph = help.render("もう帰らなきゃ。", vocabulary);
  doc.documentElement.append(paragraph);
  const [first, second] = paragraph.querySelectorAll("button");
  for (const event of ["pointerenter", "focus", "click"]) {
    first.dispatch(event, { isTrusted: false });
    assert.equal(help.tip, undefined);
  }
  first.dispatch("pointerenter");
  assert.equal(help.anchor, first);
  assert.equal(first.attributes["aria-describedby"], help.tip.id);
  assert.equal(help.tip.attributes.role, "tooltip");
  second.dispatch("focus");
  assert.equal(help.anchor, second);
  assert.equal(first.attributes["aria-describedby"], undefined);
  assert.equal(second.attributes["aria-describedby"], help.tip.id);
  help.clear();
  first.dispatch("click");
  assert.equal(help.anchor, first);
  assert.equal(calls.length, 0);
});

test("word help stays inside the viewport and flips above a word near the bottom", (t) => {
  const { help, doc, view } = fixture(t);
  const paragraph = help.render("もう", vocabulary);
  doc.documentElement.append(paragraph);
  const anchor = paragraph.querySelector("button");
  for (const box of [
    { x: 0, y: 0, width: 35, height: 20 },
    { x: 290, y: 165, width: 30, height: 22 },
  ]) {
    anchor.box = box;
    anchor.dispatch("pointerenter");
    const left = parseFloat(help.tip.style.left);
    const top = parseFloat(help.tip.style.top);
    assert.ok(left >= 12 && left + parseFloat(help.tip.style.width) <= view.width - 12);
    assert.ok(top >= 12 && top + 84 <= view.height - 12);
    if (box.y > 100) assert.ok(top + 84 < box.y);
    help.clear();
  }
  Object.assign(view, { width: 160, height: 120 });
  anchor.box = { x: 130, y: 100, width: 30, height: 20 };
  anchor.dispatch("focus");
  assert.equal(help.tip.style.width, "136px");
  assert.equal(help.tip.style.maxHeight, "96px");
  assert.equal(help.tip.style.left, "12px");
  assert.ok(parseFloat(help.tip.style.top) + 84 <= 108);
});

test("outside clicks, Escape, scrolling and destruction clear help and its ARIA link", (t) => {
  const { help, doc } = fixture(t);
  const paragraph = help.render("もう", vocabulary);
  doc.documentElement.append(paragraph);
  const anchor = paragraph.querySelector("button");
  anchor.dispatch("click");
  doc.dispatch("pointerdown", { isTrusted: false });
  assert.ok(help.tip);
  doc.dispatch("pointerdown", { target: anchor, composedPath: () => [anchor, paragraph] });
  assert.ok(help.tip);
  doc.dispatch("pointerdown", { target: help.tip.children[1], composedPath: () => [] });
  assert.ok(help.tip);
  doc.dispatch("pointerdown");
  assert.equal(help.tip, null);
  assert.equal(anchor.attributes["aria-describedby"], undefined);

  anchor.dispatch("focus");
  doc.dispatch("keydown", { key: "Escape", isTrusted: false });
  assert.ok(help.tip);
  const key = doc.dispatch("keydown", { key: "Escape" });
  assert.equal(key.defaultPrevented, true);
  assert.equal(help.tip, null);
  anchor.dispatch("click");
  doc.dispatch("scroll", { target: help.tip });
  assert.ok(help.tip);
  doc.dispatch("scroll", { target: paragraph });
  assert.equal(help.tip, null);

  anchor.dispatch("click");
  const tip = help.tip;
  help.destroy();
  assert.equal(tip.isConnected, false);
  assert.equal(anchor.attributes["aria-describedby"], undefined);
  assert.equal(doc.listeners.get("pointerdown").has(help.onOutside), false);
  assert.equal(doc.listeners.get("keydown").has(help.onKey), false);
  assert.equal(doc.listeners.get("scroll").has(help.onScroll), false);
});

test("moving from a word into its help keeps it open, then leaving closes it", async (t) => {
  const { help, doc } = fixture(t);
  const paragraph = help.render("もう", vocabulary);
  doc.documentElement.append(paragraph);
  const anchor = paragraph.querySelector("button");
  anchor.dispatch("pointerenter");
  anchor.dispatch("pointerleave");
  help.tip.dispatch("pointerenter");
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.ok(help.tip);
  help.tip.dispatch("pointerleave");
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(help.tip, null);
});

test("closed-shadow word help handles internal clicks and scrolling at its portal", (t) => {
  const { help, doc, portal } = fixture(t, undefined, true);
  const paragraph = help.render("もう", vocabulary);
  portal.append(paragraph);
  paragraph.querySelector("button").dispatch("click");
  const tip = help.tip;

  // Outside a closed shadow root, the browser hides the internal event path.
  doc.dispatch("pointerdown", { target: portal.host, composedPath: () => [portal.host, doc] });
  assert.equal(help.tip, tip);
  portal.dispatch("pointerdown", {
    target: tip.children[1],
    composedPath: () => [tip.children[1], tip, portal],
  });
  assert.equal(help.tip, tip);
  // Element scroll events do not cross the shadow boundary.
  portal.dispatch("scroll", { target: paragraph });
  assert.equal(help.tip, null);

  paragraph.querySelector("button").dispatch("focus");
  portal.dispatch("pointerdown", { target: paragraph, composedPath: () => [paragraph, portal] });
  assert.equal(help.tip, null);
  help.destroy();
  assert.equal(portal.listeners.get("pointerdown")?.has(help.onOutside), false);
  assert.equal(portal.listeners.get("scroll")?.has(help.onScroll), false);
});

const miningContext = {
  runId: "r1",
  regionIndex: 0,
  japanese: "もう帰らなきゃ。",
  translation: "I have to go.",
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("mining requires an explicit click and keeps the pending/result state across word popups", async (t) => {
  const { help, doc } = fixture(t);
  let finish;
  const calls = [];
  help.mine = (context, edits) => {
    calls.push({ context, edits });
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const paragraph = help.render(miningContext.japanese, vocabulary, miningContext);
  doc.documentElement.append(paragraph);
  const anchor = paragraph.querySelectorAll("button")[1];
  anchor.dispatch("pointerenter");
  assert.equal(calls.length, 0);
  const add = help.tip.querySelectorAll("button")[0];
  add.dispatch("click", { isTrusted: false });
  assert.equal(calls.length, 0);
  add.dispatch("click");
  add.dispatch("click");
  assert.equal(calls.length, 1);
  assert.equal(add.disabled, true);
  assert.deepEqual(calls[0].context, { runId: "r1", regionIndex: 0, wordIndex: 1 });
  assert.equal(calls[0].edits.japanese, miningContext.japanese);
  assert.equal(calls[0].edits.translation, miningContext.translation);
  help.clear();
  anchor.dispatch("click");
  assert.equal(help.tip.querySelectorAll("button")[0].disabled, true);
  finish({ deck: "Japanese" });
  await flush();
  assert.equal(help.tip.querySelectorAll("button")[0].attributes["aria-label"], "Added to Anki");
  assert.equal(
    help.tip.querySelectorAll("p").find((node) => node.className === "jp-status").textContent,
    "Added to Japanese.",
  );
});

test("Anki edits survive closing word help and uncertain outcomes disable repeated submission", async (t) => {
  const { help, doc } = fixture(t);
  const calls = [];
  help.mine = async (context, edits) => {
    calls.push(edits);
    throw Object.assign(new Error("Check Anki before trying again."), { code: "anki-unknown" });
  };
  const paragraph = help.render(miningContext.japanese, vocabulary, miningContext);
  doc.documentElement.append(paragraph);
  const anchor = paragraph.querySelector("button");
  anchor.dispatch("click");
  help.tip.querySelectorAll("button")[1].dispatch("click");
  const meaning = help.tip.querySelectorAll("textarea")[0];
  meaning.value = "edited gloss";
  meaning.dispatch("input");
  const [submit, edit] = help.tip.querySelectorAll("button");
  assert.equal(edit.hidden, true, "no separate Done action while editing");
  assert.equal(doc.activeElement, help.tip.querySelectorAll("input")[0]);
  assert.equal(submit.children[0].textContent, "Add to Anki");
  assert.equal(calls.length, 0, "editing alone does not add a note");
  help.clear();
  anchor.dispatch("click");
  const add = help.tip.querySelectorAll("button")[0];
  add.dispatch("click");
  await flush();
  assert.equal(calls[0].meaning, "edited gloss");
  assert.equal(add.disabled, true);
  assert.match(
    help.tip.querySelectorAll("p").find((node) => node.className === "jp-status").textContent,
    /Check Anki/,
  );
});

test("click pins the existing word popup across hover, focus and leave until explicit dismissal", async (t) => {
  const { help, doc, portal } = fixture(t, undefined, true);
  const paragraph = help.render(miningContext.japanese, vocabulary);
  portal.append(paragraph);
  const [first, second] = paragraph.querySelectorAll("button");
  first.dispatch("pointerenter");
  const tip = help.tip;
  first.dispatch("click");
  assert.equal(help.tip, tip, "pinning preserves the current popup");
  assert.equal(first.attributes["data-pinned"], "");
  first.dispatch("pointerleave");
  first.dispatch("blur");
  second.dispatch("pointerenter");
  second.dispatch("focus");
  second.dispatch("click", { isTrusted: false });
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(help.anchor, first);
  assert.equal(help.tip, tip);
  doc.dispatch("keydown", { key: "Escape" });
  assert.equal(help.tip, null);
  assert.equal(first.attributes["data-pinned"], undefined);
  second.dispatch("pointerenter");
  assert.equal(help.anchor, second, "dismissal restores hover previews");
  second.dispatch("click");
  first.dispatch("click");
  assert.equal(help.anchor, first, "another explicit word click changes the pinned word");
  assert.equal(second.attributes["data-pinned"], undefined);
  portal.dispatch("pointerdown", { target: paragraph, composedPath: () => [paragraph, portal] });
  assert.equal(help.tip, null);
  assert.equal(first.attributes["data-pinned"], undefined);
});

test("crossing another word while reaching Anki actions keeps the chosen word and edits", async (t) => {
  const { help, doc } = fixture(t);
  const calls = [];
  help.mine = async (context, edits) => {
    calls.push({ context, edits });
    return { deck: "Japanese" };
  };
  const paragraph = help.render(miningContext.japanese, vocabulary, miningContext);
  doc.documentElement.append(paragraph);
  const [first, second] = paragraph.querySelectorAll("button");
  first.dispatch("pointerenter");
  first.dispatch("click");
  second.dispatch("pointerenter");
  const tip = help.tip;
  tip.querySelectorAll("button")[1].dispatch("click");
  const meaning = tip.querySelectorAll("textarea")[0];
  meaning.value = "edited first word";
  meaning.dispatch("input");
  second.dispatch("pointerenter");
  assert.equal(help.tip, tip);
  tip.querySelectorAll("button")[0].dispatch("click");
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.wordIndex, 2);
  assert.equal(calls[0].edits.word, "もう");
  assert.equal(calls[0].edits.meaning, "edited first word");
  assert.equal(tip.querySelectorAll("button")[0].attributes["aria-label"], "Added to Anki");
  assert.equal(
    tip.querySelectorAll("textarea")[0].parent.parent.hidden,
    true,
    "successful add closes the editor",
  );
  assert.equal(tip.children[2].textContent, "edited first word");
});
