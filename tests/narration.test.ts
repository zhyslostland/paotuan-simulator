import { describe, expect, it } from 'vitest';
import {
  verifyNarration,
  NARRATION_RETRY_NOTE,
  type VerdictLike,
} from '../src/orchestrator/narration.js';

/**
 * 「玩家操作必须被尊重」这一层的判据。
 *
 * 起因：用户 2026-09-30 亲报三条 ——
 * 「守密人帮玩家做决定」「我说我要开枪、检定通过，他说我打歪了」「禁止我做某些事」。
 * 提示词里**已有六条红线**（不能替玩家说话 / 不得替他发起新动作 / 绝不写"你决定前往" /
 * 绝不替他做重大决策 / 绝不替他出招 / 绝不替他编造自己），
 * 但**没有任何东西核**——所以这里补的是判据，不是又一条规则。
 *
 * ⚠️ 这组用例的一半篇幅在证**不误报**：判据一旦爱假红，人就会绕过它（本项目栽过）。
 */

const ok = (skill: string): VerdictLike => ({ skill, success: true });
const fail = (skill: string): VerdictLike => ({ skill, success: false });

describe('裁决被推翻：引擎说成功，正文却写成没打中', () => {
  it('抓典型的"检定通过却说打歪了"', () => {
    const hits = verifyNarration('你扣下扳机，子弹却打歪了，只擦到墙皮。', '我要开枪', [ok('射击（手枪）')]);
    expect(hits.map((h) => h.kind)).toContain('verdict-contradicted');
    expect(hits[0]!.evidence).toContain('射击（手枪）');
  });

  it('抓"被躲开 / 落空 / 没能"这一族的说法', () => {
    for (const body of [
      '它一闪身，你这一下落了空。',
      '巨影被躲开了你的攻击。',
      '你没能伤到它分毫。',
      '这一击只擦到它的肩头。',
    ]) {
      const hits = verifyNarration(body, '我开枪', [ok('射击（手枪）')]);
      expect(hits.length, `应当抓到：${body}`).toBeGreaterThan(0);
    }
  });

  it('引擎裁决**失败**时，写"没打中"是**对的** —— 不许误报', () => {
    const hits = verifyNarration('你扣下扳机，子弹却打歪了，只擦到墙皮。', '我要开枪', [fail('射击（手枪）')]);
    expect(hits).toEqual([]);
  });

  it('这一轮**没有裁决**时，任何"没打中"都不该被当成推翻 —— 不许误报', () => {
    const hits = verifyNarration('你扑了个空，它已经不在原地。', '我扑上去', []);
    expect(hits).toEqual([]);
  });

  it('成功的叙述（见血/推进）不算违规', () => {
    const hits = verifyNarration('枪声在仓库里炸开，巨影的肩头绽出一团黑血。', '我要开枪', [ok('射击（手枪）')]);
    expect(hits).toEqual([]);
  });
});

describe('玩家的动作被掉包', () => {
  it('抓"你犹豫了 / 你放弃了 / 你决定不去"', () => {
    for (const body of [
      '你犹豫了一下，最终没有扣下扳机。',
      '你放弃了这个念头，转身离开。',
      '你决定不进去了。',
      '你默默收起了枪。',
    ]) {
      const hits = verifyNarration(body, '我要开枪', []);
      expect(hits.map((h) => h.kind), `应当抓到：${body}`).toContain('action-overridden');
    }
  });

  it('NPC 自己的动作不算掉包（"它躲开了"说的是敌人）', () => {
    const hits = verifyNarration('它闪身避开，退回阴影里。', '我开枪', [fail('射击（手枪）')]);
    expect(hits).toEqual([]);
  });

  it('这一轮没有玩家声明时（例如开场白）不查掉包 —— 不许误报', () => {
    const hits = verifyNarration('你犹豫着推开了门。', null, []);
    expect(hits).toEqual([]);
  });
});

describe('禁止 / 说教 / 菜单', () => {
  it('抓"你不能这么做 / 作为 AI / 你可以选择"', () => {
    for (const body of [
      '你不能这么做。',
      '作为一个人工智能，我无法继续这个场景。',
      '你可以选择：1. 谈判 2. 逃跑',
    ]) {
      const hits = verifyNarration(body, '我要开枪', []);
      expect(hits.map((h) => h.kind), `应当抓到：${body}`).toContain('forbidden-or-preachy');
    }
  });

  it('叙境内的"做不到"（机制原因写成事实）**不该**被当成禁止', () => {
    const hits = verifyNarration('你摸向腰间 —— 枪套是空的，备用弹匣留在了车上。', '我要开枪', []);
    expect(hits).toEqual([]);
  });
});

describe('纠正指令必须说清"哪里错、怎么改"', () => {
  it('三条底线与"写成事实"的做法都在指令里', () => {
    expect(NARRATION_RETRY_NOTE).toContain('玩家声明要做什么，就是他在做什么');
    expect(NARRATION_RETRY_NOTE).toContain('不许在正文里写成失败');
    expect(NARRATION_RETRY_NOTE).toContain('不要宣布玩家不能行动');
    // 与既有 RETRY_NOTE / CHECK_RETRY_NOTE 同族：都要给"改成什么"的例子
    expect(NARRATION_RETRY_NOTE).toContain('枪套是空的');
  });
});
