# 安全说明（给想自己验证的人）

跑团模拟器是一个**纯前端 PWA**，没有任何后端服务器。所有逻辑都跑在你的浏览器里。

## 你的 API Key 去了哪里？

1. **只存在你自己的浏览器里。** API Key 写入 `localStorage`（键名 `trpg.config`），不会上传到任何第三方、也不会上传给本应用的作者或任何服务器。
   - 代码位置：`src/ui/store.ts` 的 `setConfig()` → `localStorage.setItem('trpg.config', ...)`。
2. **只在你点「开始对话」时，通过标准 `Authorization: Bearer <key>` 头，发往你自己在「设置 → 模型与接口」里填的 `API 地址`（baseUrl）。**
   - 默认预设是硅基流动 `https://api.siliconflow.cn/v1`，你也可以换成 DeepSeek / 智谱 / 通义 / 豆包 / OpenAI / 本地 Ollama。
   - 代码位置：`src/providers/model.ts` 的 `streamChat()`，请求只发往 `${baseUrl}/chat/completions`。
3. **没有遥测、没有上报、没有后门。** 全仓库除了模型请求本身、PWA 版本检测（只请求同源 `version.json`，不含任何密钥）、剪贴板复制，没有任何向外发送数据的逻辑。

## 怎么自己验证

任何人都可以 clone 后直接读这两处：
- `src/providers/model.ts` —— 看网络请求发往哪里；
- `src/ui/store.ts` —— 看配置（含 Key）如何持久化。

搜一下 `fetch(`、`XMLHttpRequest`、`telemetry`、`sendBeacon`、`analytics` 即可确认没有其它数据出口。

## 给使用者的建议

- 在服务商处**用一个额度很小的 Key**（或子账户 / 限流 Key）来试玩，即使泄露损失也极小。
- Key 存在本机浏览器，**换设备 / 清缓存 / 卸载 PWA 都会丢失**，需要重新填写。
- 本应用不收集你的任何信息；但调用大模型时，你输入的对局内容会按常规发给你所选的大模型服务商（这是对话功能本身需要的）。
