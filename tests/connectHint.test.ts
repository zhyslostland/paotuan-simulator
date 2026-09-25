import { describe, expect, it } from 'vitest';
import { connectHint } from '../src/providers/model.js';

/*
 * P4-2：连不上的提示不能一律提 Ollama。
 *
 * 病灶：那句提示写死了「本地 Ollama 需要设置 OLLAMA_ORIGINS=*」。
 * 可绝大多数玩家用的是云服务（硅基流动 / DeepSeek / 通义），
 * 他们被告知去设一个自己根本没有的环境变量 —— **指错路**。
 */
describe('connectHint：只在真·本机时才提 Ollama（P4-2）', () => {
  it('本机地址（localhost / 127.0.0.1 / [::1]）才提 OLLAMA_ORIGINS', () => {
    for (const u of [
      'http://localhost:11434/v1/chat/completions',
      'http://127.0.0.1:11434/v1/chat/completions',
      'http://[::1]:11434/v1/chat/completions',
      'https://localhost/v1/chat/completions',
    ]) {
      const msg = connectHint(u);
      expect(msg).toContain('OLLAMA_ORIGINS');
      expect(msg).toContain(u);
    }
  });

  it('云端地址**不许**提 Ollama —— 玩家没有那个东西', () => {
    for (const u of [
      'https://api.siliconflow.cn/v1/chat/completions',
      'https://api.deepseek.com/v1/chat/completions',
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    ]) {
      const msg = connectHint(u);
      expect(msg).not.toContain('OLLAMA_ORIGINS');
      expect(msg).not.toContain('Ollama');
      // 但仍旧要给出这条最通用的排查方向
      expect(msg).toContain('CORS');
    }
  });

  it('长得像但不是本机的域名不许被误判（如 localhost.evil.com）', () => {
    const msg = connectHint('https://localhost.example.com/v1/chat/completions');
    expect(msg).not.toContain('OLLAMA_ORIGINS');
  });
});
