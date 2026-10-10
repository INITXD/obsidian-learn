import { test } from "node:test";
import assert from "node:assert/strict";
import { _strings, format, toLang, tr } from "../src/i18n.ts";
import { materialLabels, materialText, noteText, reviewSystem } from "../src/prompts.ts";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("中英文界面文字的键和占位符一致", () => {
  const zhKeys = Object.keys(_strings.zh).sort();
  assert.deepEqual(Object.keys(_strings.en).sort(), zhKeys);
  for (const k of zhKeys) {
    const key = k as keyof typeof _strings.zh;
    assert.deepEqual(placeholders(_strings.en[key]), placeholders(_strings.zh[key]), k);
  }
});

test("写入笔记和发给模型的模板占位符一致", () => {
  for (const pick of [materialText, noteText] as const) {
    const zh = pick("zh") as Record<string, string>;
    const en = pick("en") as Record<string, string>;
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
    for (const k of Object.keys(zh)) assert.deepEqual(placeholders(en[k]), placeholders(zh[k]), k);
  }
});

test("reviewSystem 引用的资料分组名与 materialLabels 一致", () => {
  for (const lang of ["zh", "en"] as const) {
    const prompt = reviewSystem(lang, "X", "2026-10-05");
    for (const label of Object.values(materialLabels(lang))) assert.ok(prompt.includes(label), `${lang}: ${label}`);
  }
});

test("toLang 把中文变体映射为 zh，其余为 en", () => {
  assert.equal(toLang("zh"), "zh");
  assert.equal(toLang("zh-TW"), "zh");
  assert.equal(toLang("en-GB"), "en");
  assert.equal(toLang("ja"), "en");
  assert.equal(toLang(null), "en");
});

test("format 替换已知占位符，保留未知占位符", () => {
  assert.equal(format("{a} {b}", { a: 1 }), "1 {b}");
  assert.equal(tr("en", "capture.written", { path: "a.md" }), "Saved to a.md");
});
