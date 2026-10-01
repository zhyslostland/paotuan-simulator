/**
 * 模型接入层（Provider）
 *
 * 只实现 OpenAI 兼容协议 —— 它事实上是行业标准：
 * DeepSeek、通义、豆包、Kimi、智谱、Ollama、vLLM、OneAPI 全都吃得下。
 * 用户在设置里填 baseUrl + key + model 就能换任意一家。
 */

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** 采样参数 top_p（0-1；不填则用服务商默认） */
  topP?: number;
  /** 是否开启思考模式（DeepSeek 的 enable_thinking）。跑团叙事默认关掉，开了只会拖慢并烧 token */
  thinking?: boolean;
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/**
 * 「连不上」时给玩家的提示（P4-2）。
 *
 * ## 为什么不能一律提 Ollama
 * 早先这句是写死的：
 * > 无法连接到 X。若是浏览器直连，请确认该服务允许跨域（CORS）；本地 Ollama 需要设置 OLLAMA_ORIGINS=*
 *
 * 可**绝大多数玩家用的不是 Ollama**（硅基流动 / DeepSeek / 通义…）。
 * 一个连不上云服务的玩家，被告知去设 `OLLAMA_ORIGINS` 环境变量 ——
 * 那是**指错路**：他既没有 Ollama，也没法照做，只能更困惑。
 *
 * 所以按 baseUrl 分流：**只有真指向本机时才提 Ollama**。
 * `localhost` / `127.0.0.1` / `[::1]` 三种写法都认（IPv6 的方括号也算）。
 */
export function connectHint(url: string): string {
  const isLocal = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(url);
  const tail = isLocal
    ? '本地 Ollama 需要设置 OLLAMA_ORIGINS=* 并重启服务。'
    : '请确认地址与 Key 是否填对、网络是否可达；若服务商要求白名单，把你的域名加进去。';
  return `无法连接到 ${url}。若是浏览器直连，请确认该服务允许跨域（CORS）；${tail}`;
}

/**
 * 网络层重试：弱网 / 切后台再回来时，连接建立失败很常见。
 * 对"连不上"重试一次，4xx/5xx 这类服务端明确拒绝则不重试（重试也没用）。
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 2
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

/** 流式对话，逐段产出文本 */
export async function* streamChat(
  messages: ChatTurn[],
  cfg: ModelConfig,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  if (!cfg.apiKey) {
    throw new ModelError('尚未配置 API Key，请在设置中填写');
  }

  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let res: Response;
  try {
    res = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        ...(typeof cfg.topP === 'number' ? { top_p: cfg.topP } : {}),
        max_tokens: cfg.maxTokens,
        stream: true,
        // 硅基流动的 DeepSeek 支持思考模式。跑团叙事不需要深度推理，
        // 开启只会拖慢首字延迟并多烧 token —— 默认关掉，用户可手动开。
        enable_thinking: cfg.thinking === true,
      }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ModelError(connectHint(url));
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new ModelError(`模型返回错误 ${res.status}：${detail.slice(0, 300)}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') return;
        if (!data) continue;
        try {
          const json = JSON.parse(data);
          // 只取 content。若上游开启了思考模式，推理内容会走 reasoning_content
          // 字段，绝不混进正文，否则玩家会看到模型的自言自语。
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) yield delta;
        } catch {
          // 忽略心跳等非法分片
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** 非流式，用于生成摘要等后台任务 */
export async function chat(
  messages: ChatTurn[],
  cfg: ModelConfig,
  signal?: AbortSignal
): Promise<string> {
  let out = '';
  for await (const chunk of streamChat(messages, { ...cfg }, signal)) out += chunk;
  return out;
}

/**
 * 生图接口。
 *
 * 走 OpenAI 兼容的 `/images/generations`。两条与"图存哪儿"有关的口径：
 *
 * 1. **优先要 `b64_json`**（图进响应体）—— 我们要的是图，不是一个过两天就失效的链接。
 * 2. 只拿到 `url` 时返回链接，由调用方决定要不要 `fetchImageAsLocal()` 抓回来。
 *    **返回值不保证自包含**，判据统一放 `core/imageData.ts`（只有一处说法）。
 *
 * 用户要求"看看速度行不行"——接口先留好，接哪家取决于速度实测。
 */
export interface ImageGenConfig extends ModelConfig {
  size?: string;
  /**
   * 超时/取消用的中止信号。
   *
   * 没有它，一个"连上了但永远不回"的请求会**无限挂住** ——
   * 调用方那一条任务就永远停在"正在画"，占着并发槽，后面排队的图一张也开不了工
   * （主人 2026-09-27 真机撞到的正是这个）。
   */
  signal?: AbortSignal;
}

export async function generateImage(
  prompt: string,
  cfg: ImageGenConfig
): Promise<string | null> {
  if (!cfg.apiKey) throw new ModelError('生图未配置 API Key');
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/images/generations`;
  /*
   * **要 base64，不要链接**（P2-3）。
   *
   * 服务商给的 url 是**临时的** —— 存下来当时能看，隔天就是一张裂图，
   * 而导出战报还傻乎乎地写着"图片已内嵌、本文件自包含"。
   * 所以优先要 `b64_json`（图直接进响应体，拿到即拥有）。
   *
   * 兼容性：有些服务商不认这个参数、直接忽略并仍然返回 url —— 那就走下面的
   * `fetchImageAsLocal()` 再抓一次；两条路都走不通才降级成"临时链接"。
   */
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      prompt,
      size: cfg.size ?? '1024x1024',
      n: 1,
      response_format: 'b64_json',
    }),
    // 超时由调用方通过 `signal` 掐掉（见 `ImageGenConfig.signal`）
    signal: cfg.signal,
  });
  if (!res.ok) {
    throw new ModelError(`生图失败 ${res.status}：${(await res.text()).slice(0, 200)}`, res.status);
  }
  const json = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
  const first = json.data?.[0];
  if (!first) return null;
  // 有的服务商返回 `data:image/png;base64,xxx` 整串，有的只给裸 base64 —— 两种都要认
  if (first.b64_json) {
    const b = first.b64_json.trim();
    return /^data:/i.test(b) ? b : `data:image/png;base64,${b}`;
  }
  return first.url ?? null;
}

/**
 * 把一张远端图片抓回本地，转成 data URI（P2-3）。
 *
 * 生图接口只给链接时走这里。**失败不重试、不绕代理**：
 * 跨源 `fetch` 被 CORS 挡掉是很正常的，那不是"错误"，
 * 而是一种需要如实告诉玩家的结果（→ `{ kind: 'remote' }`，界面与导出改说"临时链接"）。
 */
export async function fetchImageAsLocal(
  url: string
): Promise<{ kind: 'self'; value: string } | { kind: 'remote'; value: string } | { kind: 'fail'; reason: string }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { kind: 'remote', value: url };
    const blob = await res.blob();
    if (!blob.size) return { kind: 'remote', value: url };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { toDataUri } = await import('../core/imageData.js');
    return { kind: 'self', value: toDataUri(blob.type, bytes) };
  } catch (e) {
    // 跨源被挡（CORS）会走到这里；这不是故障，是"这张图只能留链接"
    return { kind: 'remote', value: url };
  }
}
