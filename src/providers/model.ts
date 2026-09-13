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
    throw new ModelError(
      `无法连接到 ${url}。若是浏览器直连，请确认该服务允许跨域（CORS）；本地 Ollama 需要设置 OLLAMA_ORIGINS=*`
    );
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
 * 生图接口（占位实现）
 *
 * 用户要求"看看速度行不行"——接口先留好，接哪家取决于速度实测。
 * 目前支持 OpenAI 兼容的 /images/generations，以及通用的图床返回格式。
 */
export interface ImageGenConfig extends ModelConfig {
  size?: string;
}

export async function generateImage(
  prompt: string,
  cfg: ImageGenConfig
): Promise<string | null> {
  if (!cfg.apiKey) throw new ModelError('生图未配置 API Key');
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/images/generations`;
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
    }),
  });
  if (!res.ok) {
    throw new ModelError(`生图失败 ${res.status}：${(await res.text()).slice(0, 200)}`, res.status);
  }
  const json = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
  const first = json.data?.[0];
  if (!first) return null;
  return first.url ?? (first.b64_json ? `data:image/png;base64,${first.b64_json}` : null);
}
