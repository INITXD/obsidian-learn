export type Part =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string };

export interface Turn {
  role: "user" | "assistant";
  parts: Part[];
  /** 提供方原生的助手消息内容（Claude 的 thinking 块需原样回传） */
  raw?: { provider: string; content: unknown };
}

export interface CompletionRequest {
  system: string;
  turns: Turn[];
  maxTokens: number;
  /** 对第一条用户消息（资料）启用提示缓存，多轮对话时节省费用 */
  cacheFirstTurn?: boolean;
}

export interface CompletionResult {
  text: string;
  raw: { provider: string; content: unknown };
  /** 输出因 max_tokens 被截断 */
  truncated: boolean;
}

export interface LLMClient {
  readonly provider: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export function textOf(parts: Part[]): string {
  return parts.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text").map((p) => p.text).join("\n");
}
