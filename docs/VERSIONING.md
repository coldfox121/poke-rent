# 版本与缓存约定（poke-rent）

## 缓存版本号 `?v=N`

所有静态资源引用必须带 `?v=N`，且 `index.html` 与 JS 内部动态拼接的版本号必须一致：

- `index.html` 中 `style.css?v=3`、`js/data.js?v=3`、`js/engine.js?v=3`、`js/ui.js?v=3`
- `js/ui.js` 中 `CACHE_V = D.CONFIG.cacheVersion`，与上面保持同步
- `js/data.js` 中 `CONFIG.cacheVersion = 3`

**改任何静态文件必须同步递增所有 `?v=N`**，否则浏览器缓存会导致用户看到旧版本。

## 存档版本 `SAVE_VERSION`

`js/data.js` 中 `CONFIG.saveVersion`，当前为 2（v1.1.0 新增 `contrib` 按物种贡献字段）。

升级规则：

- 只有**存档结构真的改变**才 +1（新增/删除字段、字段类型变化）
- 纯 UI/CSS 修复不升级
- 升级时必须写**纯加法迁移**：`js/ui.js` 的 `migrate()` 先原样继承旧档所有字段（含未知字段），再补齐缺失字段
- 禁止 DROP、清空、不兼容字段改名
- 每次升级必须跑 `node tools/migrate-test.mjs` 验证旧档可迁移

## 发版流程

1. `git pull --ff-only origin main` 记基线提交
2. 改动完成后跑全部测试：`node tools/simulate.mjs`、`node tools/migrate-test.mjs`、`node tools/e2e.mjs`（需 puppeteer-core）
3. 测试全绿后 commit + push
4. 等 Cloudflare Pages 部署完成
5. 线上打开验证
6. 如需 git 仓库：`gh repo create coldfox121/poke-rent --public --source=. --remote=origin --push`
