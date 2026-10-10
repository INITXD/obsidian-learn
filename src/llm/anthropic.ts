import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { t } from "../i18n.ts";
import { obsidianFetch } from "./obsidianFetch.ts";
import type { CompletionRequest, CompletionResult, LLMClient, Turn } from "./types.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  /** 空字符串表示不传 effort（用于不支持 effort 的模型） */
  effort: Effort | "";
  /** 服务端拒答回退（fallbacks: "default"） */
  fallbacks: boolean;
}

export class AnthropicClient implements LLMClient {
  readonly provider = "anthropic";
  private client: Anthropic;

  constructor(private opts: AnthropicOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      // 插件运行在 Electron/移动端 WebView 中，密钥保存在用户本地的插件数据里
      dangerouslyAllowBrowser: true,
      fetch: obsidianFetch,
    });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const messages = req.turns.map((t, i) => this.toMessage(t, i === 0 && !!req.cacheFirstTurn));
    const res = await this.client.beta.messages.create({
      model: this.opts.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages,
      ...(this.opts.effort ? { output_config: { effort: this.opts.effort } } : {}),
      ...(this.opts.fallbacks ? { fallbacks: "default" as const, betas: ["server-side-fallback-2026-07-01"] } : {}),
    });

    if (res.stop_reason === "refusal") {
      const detail = res.stop_details?.explanation ?? res.stop_details?.category ?? "";
      throw new Error(`${t("error.refused")}${detail ? `: ${detail}` : ""}`);
    }
    const text = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    return {
      text,
      raw: { provider: this.provider, content: res.content },
      truncated: res.stop_reason === "max_tokens",
    };
  }

  private toMessage(turn: Turn, cache: boolean): BetaMessageParam {
    if (turn.role === "assistant" && turn.raw?.provider === this.provider) {
      // 原样回传（包括 thinking 块）
      return { role: "assistant", content: turn.raw.content as BetaContentBlockParam[] };
    }
    const content: BetaContentBlockParam[] = turn.parts.map((p) =>
      p.type === "text"
        ? { type: "text", text: p.text }
        : {
            type: "image",
            source: { type: "base64", media_type: p.mediaType as "image/jpeg", data: p.data },
          },
    );
    if (cache && content.length > 0) {
      const last = content[content.length - 1] as { cache_control?: { type: "ephemeral" } };
      last.cache_control = { type: "ephemeral" };
    }
    return { role: turn.role, content };
  }
}
