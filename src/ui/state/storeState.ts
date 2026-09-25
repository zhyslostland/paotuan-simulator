/**
 * **应用状态形状**（`useStore` 的 state 部分，不含 action）。
 *
 * 从这里搬出来的原因：`ui/store.ts` 一度 14 万字符，看"这个应用有哪些状态"
 * 得先翻过几千行实现。状态形状是**最常被查的东西**，单独成文件。
 *
 * ⚠️ **本文件只放 state 字段与初值，不放任何 action**（E 档 E1）。
 *    action 仍在 `ui/store.ts` 的 `interface Store extends StoreState` 里。
 *    初值在 `ui/state/initialState.ts`（loader 在 `ui/state/loaders.ts`）。
 *
 * 这些字段的**持久化真源**是 `localStorage`（键名 `trpg.*`），
 * 读侧见 `loaders.ts`，写侧仍在 `store.ts`（`saveJson` / `saveJsonNow`）。
 */
import type {
  ApiConfig,
  CharacterProfile,
  ChronicleEntry,
  Message,
  Module,
  PendingCheck,
  StateChangeNotice,
  ThemeName,
  TurnSnapshot,
  Typography,
  WorldbookEntry,
} from '../../core/types.js';
import type { AchievementDef, Career } from '../../core/career.js';
import type { Companion, GameState } from '../../core/state/gameState.js';
import type { Genre } from '../../core/genres.js';
import type { GmVoice } from '../../core/voices.js';
import type { World } from '../../core/campaign.js';
import type { ArchivedCharacter } from '../archive.js';
import type { AudioConfig } from '../audio.js';
import type { ImageJob } from '../imageJobs.js';

export interface StoreState {
  messages: Message[];
  gameState: GameState;
  config: ApiConfig;
  character: CharacterProfile;
  /** 模组（团）：这一局讲的是什么故事 */
  module: Module;
  rulesetId: string;
  /** 题材预设：决定守密人写法、画风、模组与队友倾向（与规则包正交） */
  genreId: string;
  /** 自建/导入的题材（内置题材之外） */
  customGenres: Genre[];
  streaming: boolean;
  panel: 'chat' | 'character' | 'world';
  theme: ThemeName;
  worldbook: WorldbookEntry[];
  chronicle: ChronicleEntry[];
  /** 远期剧情压缩后的段落，摘要层 */
  summary: string;
  /** 回合快照表：玩家消息 id → 回合开始时的状态 */
  snapshots: Record<string, TurnSnapshot>;
  /** 「模组包」生成的队友候选，等玩家挑谁入队 */
  companionCandidates: Companion[];
  /** 场景立绘：地点 → 图片（存 IndexedDB，避免 localStorage 超配额丢图） */
  sceneImages: Record<string, string>;
  /** 剧情消息上的动作小图：消息 id → 图片（同样存 IndexedDB） */
  messageImages: Record<string, string>;
  /** 地图总览图（data URI，存 IndexedDB） */
  mapImage: string;
  /**
   * 生图队列（R40）。**应用级后台任务** —— 切页签不影响它继续跑。
   *
   * 落盘（`trpg.imageJobs`）：应用关掉之后再打开，你还看得见"上次没画完的那两张"。
   * 成功即出队（图已经在它该在的位置了）；失败留在队列里，带一句人话 + 重试。
   */
  imageJobs: ImageJob[];
  /**
   * 守密人要求的、等待玩家掷骰的检定。
   *
   * 为什么是队列：一轮里守密人可能同时要求多个检定（如"潜行"与"聆听"）。
   * 早期只取 `dice_requests[0]`，后面的请求会被整个丢掉——玩家永远掷不到。
   */
  pendingChecks: PendingCheck[];
  /** 最近一轮的状态变化摘要，主页面用它弹提示 */
  lastChanges: StateChangeNotice | null;
  /**
   * 待注入的「濒死施救引导」——**一次性**：下一次发给守密人时带上，带完即清。
   *
   * 为什么不在提示词里常驻：常驻等于每一轮都在提醒"你要死了"，
   * 血没见底时也占着上下文。只在濒死那一轮说一次，才叫引导而不是唠叨。
   * 纯运行时字段，**不进存档**（刷新页面丢失也不影响，死亡结算照旧）。
   */
  dyingNote: string | null;
  /**
   * 后台发生的事，要浮一句给玩家看（P2-3）。
   *
   * 为什么不能只靠组件里的浮字：**生图是后台任务** —— 它可能在玩家翻着设置页、
   * 看着角色卡的时候落盘。组件里那句 `setToast` 根本不在场，
   * 玩家就会错过"这张图只有临时链接"这种**必须当场知道**的消息。
   * 所以要让 store 自己也有一句话的出口，App 取走即清（一次性）。
   */
  uiNotice: string | null;
  /** 正文排版设置 */
  typography: Typography;
  /** 守密人口吻（R8）。只改"怎么说"，不改任何规则 */
  gmVoice: GmVoice;
  /**
   * 带图战报的**总开关**：关键节点（回溯锚点）自动配一张图。
   *
   * **默认关**：它会真的花钱（每张图一次生图调用），默认开着等于替主人决定支出。
   * 想开就在设置里打开，或随时对单条消息手动生成。
   */
  autoIllustrate: boolean;
  /** 跨局的生涯记录与成就（R13/R30）。**独立于单局存档**，开新团不清 */
  career: Career;
  /** 刚刚这一次结档**新解锁**的成就（结档页高亮用）。不落盘，只是过路信息 */
  lastUnlocked: AchievementDef[];
  /**
   * 世界层（Phase 2）：世界的留档，键＝`worldKey(名字)`。
   * **独立于单局存档**（`trpg.worlds`）—— 开新团时要读它，混在一起就是自己吃自己。
   */
  worlds: Record<string, World>;
  /** 这一局属于哪个世界（玩家可改）。空＝跟着模组名走 */
  worldName: string;
  /**
   * 开新团时要不要**接着上一次跑**（把那四样灌进来）。
   *
   * 默认**开**：这个世界有留档就说明玩家跑过它，接着跑正是这东西存在的理由；
   * 准备页会明写"会带什么过去"，并且随时可以关掉。没有留档时这个开关不起作用。
   */
  carryWorld: boolean;
  /** 角色档案库（Phase 2）。**独立于单局存档**，换团不丢人设 */
  characterArchive: ArchivedCharacter[];
  /** 音频设置（氛围音 / 自配 BGM / 判定音效） */
  audio: AudioConfig;
}
