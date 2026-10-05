import { requestUrl } from "obsidian";

/**
 * 用 Obsidian 的 requestUrl 实现 fetch：不受 CORS 限制，桌面端和移动端行为一致。
 * 不支持流式响应和 AbortSignal。
 */
export async function obsidianFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    if (key !== "content-length") headers[key] = value;
  });
  let body: string | ArrayBuffer | undefined;
  if (typeof init?.body === "string") body = init.body;
  else if (init?.body != null) body = await new Response(init.body).arrayBuffer();

  const res = await requestUrl({
    url,
    method: init?.method ?? "GET",
    headers,
    body,
    contentType: headers["content-type"],
    throw: false,
  });
  const noBody = res.status === 204 || res.status === 304;
  return new Response(noBody ? null : res.arrayBuffer, { status: res.status, headers: res.headers });
}
