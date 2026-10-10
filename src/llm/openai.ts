import { requestUrl } from "obsidian";
import type { CompletionRequest, CompletionResult, LLMClient } from "./types.ts";
import { textOf } from "./types.ts";
import { t } from "../i18n.ts";

export type MaxTokensParam = "max_tokens" | "max_completion_tokens" | "none";

export interface OpenAIOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokensParam: MaxTokensParam;
}

/** OpenAI Chat Completions 兼容接口（OpenAI、通义千问、Gemini 兼容端点、OpenRouter 等） */
export class OpenAICompatibleClient implements LLMClient {
  readonly provider = "openai";

  constructor(private opts: OpenAIOptions) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const messages: unknown[] = [{ role: "system", content: req.system }];
    for (const t of req.turns) {
      if (t.role === "assistant") {
        messages.push({ role: "assistant", content: textOf(t.parts) });
        continue;
      }
      messages.push({
        role: "user",
        content: t.parts.map((p) =>
          p.type === "text"
            ? { type: "text", text: p.text }
            : { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data}` } },
        ),
      });
    }
    const body: Record<string, unknown> = { model: this.opts.model, messages };
    if (this.opts.maxTokensParam !== "none") body[this.opts.maxTokensParam] = req.maxTokens;

    const url = `${this.opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const res = await requestUrl({
      url,
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify(body),
      throw: false,
    });
    if (res.status >= 400) {
      throw new Error(t("error.http", { status: res.status, body: res.text.slice(0, 500) }));
    }
    const choice = res.json?.choices?.[0];
    const content = choice?.message?.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((c: { text?: string }) => c.text ?? "").join("")
        : "";
    if (!text && choice?.finish_reason === "content_filter") throw new Error(t("error.contentFilter"));
    return {
      text: text.trim(),
      raw: { provider: this.provider, content },
      truncated: choice?.finish_reason === "length",
    };
  }
}
