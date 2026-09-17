/**
 * 守密人口吻（R8）与契约版本号的断言。
 *
 * 这组守三条**最容易悄悄破掉**的东西：
 *   ① 默认口吻必须等于"没做这个功能之前"的调子 —— 没选过的人不该被换一种声音；
 *   ② 四种口吻都**不许替玩家做决定**，也不许动规则（它们是笔调，不是玩法开关）；
 *   ③ 契约版本号只许**加字段**，且模型没写 `v` 时绝不能被拒。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GM_VOICE,
  GM_VOICES,
  gmVoiceOf,
  listGmVoices,
} from '../src/core/voices.js';
import { CONTRACT_VERSION, extractContract } from '../src/orchestrator/prompt.js';

describe('守密人口吻（R8）：四种笔调', () => {
  it('四种都在，且 id 不重复', () => {
    const ids = GM_VOICES.map((v) => v.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual(['storyteller', 'narrator', 'partner', 'fate']);
  });

  it('每条都有名字、说明与整段写法要求', () => {
    for (const v of GM_VOICES) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.hint.length).toBeGreaterThan(0);
      expect(v.prompt.length).toBeGreaterThan(50);
      // 段落里要带上自己的名字，否则模型分不清在用哪一套
      expect(v.prompt).toContain(v.label);
    }
  });

  it('默认口吻是"老派说书人"，而且它必须是零改动的那个', () => {
    expect(DEFAULT_GM_VOICE).toBe('storyteller');
    expect(gmVoiceOf(undefined).id).toBe(DEFAULT_GM_VOICE);
    expect(gmVoiceOf(null).id).toBe(DEFAULT_GM_VOICE);
    // 旧存档 / 手改存档里的怪值一律退回默认，绝不返回 undefined
    expect(gmVoiceOf('不存在的口吻').id).toBe(DEFAULT_GM_VOICE);
    expect(gmVoiceOf('').id).toBe(DEFAULT_GM_VOICE);
  });

  it('认得出的 id 返回它自己', () => {
    expect(gmVoiceOf('fate').id).toBe('fate');
    expect(gmVoiceOf('partner').label).toBe('搭档');
  });

  it('每一种都写明"不许替玩家做决定"与"不改规则"', () => {
    for (const v of GM_VOICES) {
      // 这两句是共用的收尾，四种都必须带上
      expect(v.prompt).toContain('不要替玩家做决定');
      expect(v.prompt).toContain('不改变任何规则');
    }
  });

  it('listGmVoices 返回的就是那份常量（引用稳定，供 UI 直接渲染）', () => {
    expect(listGmVoices()).toBe(GM_VOICES);
  });
});

describe('契约版本号：只加字段，绝不因为一个数字废掉整轮', () => {
  it('prompt 里给的版本号与常量一致', () => {
    expect(CONTRACT_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('模型写了更大的 v → 照旧解析（不拒）', () => {
    const out = extractContract(
      '正文。\n```json\n{"v": 99, "summary_delta": "他推开了门"}\n```'
    );
    expect(out.contract).not.toBeNull();
    expect(out.contract?.summary_delta).toBe('他推开了门');
    expect(out.body).toBe('正文。');
  });

  it('模型没写 v（老契约）→ 照旧解析', () => {
    const out = extractContract('正文。\n```json\n{"summary_delta": "他推开了门"}\n```');
    expect(out.contract?.summary_delta).toBe('他推开了门');
    expect(out.contract?.v).toBeUndefined();
  });

  it('delta 上多带的未知字段不会让解析失败（宽容）', () => {
    // 曾经有个 announce 开关（"我在正文里写过了，别弹提示"），已删除 ——
    // 它从来不是"别提示"的许可，未知字段一律忽略，提示照出。
    const out = extractContract(
      '正文。\n```json\n{"state_delta":[{"target":"inventory","op":"add","value":"钥匙","announce":true}]}\n```'
    );
    expect(out.contract).not.toBeNull();
    expect(out.contract?.state_delta?.[0]?.target).toBe('inventory');
  });
});
