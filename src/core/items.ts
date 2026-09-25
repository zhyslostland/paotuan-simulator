/**
 * 物品的「能不能用、要不要本地扣」判据 —— **全项目只有这一份**。
 *
 * ## 为什么要有它
 * 主人 2026-09-20 拍板（原话）：
 * > 物品分两种。**纯消耗品、只能回血**：没掉血就不能用，数量不减（禁用是对的）。
 * > **实物有自由度**：止血绷带功能是止血，归根到底是一卷绷带，能干什么靠玩家想象。
 *
 * 于是 `kind === 'consumable'` **不再等于**"点击就本地扣 1"。分叉只有这一处：
 * - **纯回血**（药水 / 药剂 / 丹药…）：满血**禁用**、不扣、不发；未满血才本地扣 1。
 * - **实物**（绷带、绳子、灯油…）：按钮永远可点，**永不预扣**——扣不扣看本轮契约的
 *   `inventory dec`（协作方第 17 版 B/D）。玩家写「把绷带铺在地上」也算用掉，这是引擎猜不出来的。
 *
 * ## 判据为什么只看名字、不看说明
 * `desc` 里常写着"生命 +1d4"，**绷带也这么写**——拿说明判会把绷带误判成纯回血。
 * 主人分的是"它**是什么东西**"，不是"它**写了什么效果**"。所以只认名字里的药类词。
 */
const HEAL_ONLY_NAME_RE = /(药|血瓶|针剂|注射|回复剂|治疗剂)/;

/**
 * 物品最小形状（只取判据要用的字段，避免 core 依赖 ui 的完整类型）。
 * `desc` 收进来**只是为了在测试里写反例**（"说明里写了生命 +1d4 的绷带"）——
 * 判据本身**不看它**。
 */
type ItemLike = { name?: string; kind?: string; desc?: string } | undefined | null;

/**
 * 是不是「只能回血」的纯消耗品。
 * 只对 `kind === 'consumable'` 生效——武器、道具、线索都不走这条。
 */
export function isHealOnlyConsumable(it: ItemLike): boolean {
  if (!it) return false;
  if (it.kind !== 'consumable') return false;
  return HEAL_ONLY_NAME_RE.test(it.name ?? '');
}

/**
 * 玩家这一句里**点到了**哪些背包物品。
 *
 * 判据是**全名出现**，刻意**不做动词表**（拿出 / 铺开 / 交给…）——
 * 协作方第 17 版 C：「看看绷带上的字」不能扣，动词表就得越写越长；
 * 而且"铺在地上"这种用法谁也枚举不完。这里只回答"这句话点到了谁"，
 * **扣不扣交给守密人**：提示词收到这份名单后自己判断该不该 `inventory dec`。
 */
export function itemsMentionedIn(text: string, items: ItemLike[]): string[] {
  const t = text ?? '';
  if (!t.trim()) return [];
  const hit: string[] = [];
  for (const it of items) {
    const name = it?.name?.trim();
    if (!name) continue;
    if (t.includes(name) && !hit.includes(name)) hit.push(name);
  }
  return hit;
}
