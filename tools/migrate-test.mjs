/* 存档迁移测试：验证旧档/缺字段/未知字段都能被安全继承 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
globalThis.PR = {};
require('../js/data.js');
const E = require('../js/engine.js');

let failures = 0;
function check(c, m) { if (!c) { failures++; console.error('FAIL ' + m); } else console.log('PASS ' + m); }

// 直接复用 ui.js 的迁移逻辑测试（用 vm 提取函数）
import fs from 'fs';
import vm from 'vm';
const uiSrc = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const migrateMatch = uiSrc.match(/function migrate\(raw\) \{[\s\S]*?\n  \}/);
check(!!migrateMatch, '提取到 migrate 函数');

// 构造保存的接口
const sandbox = {
  window: { PR: globalThis.PR }, document: {}, localStorage: {},
  console, setTimeout, alert: () => {}, confirm: () => true,
  E: E, D: globalThis.PR.data
};
vm.createContext(sandbox);
// 注入测试钩子：把 migrate 暴露出来
const hook = migrateMatch[0] + '\nglobalThis.__migrate = migrate;';
vm.runInContext(hook, sandbox);
const migrate = sandbox.__migrate;

// 测试1：空档返回 null
check(migrate(null) === null, '空档返回 null');
check(migrate({}) !== null, '空对象可迁移');

// 测试2：旧档缺字段自动补齐
const old = { seed: 999, coins: 100, pool: [1, 4, 7], rentIndex: 3 };
const migrated = migrate(old);
check(migrated.coins === 100, '保留旧档金币');
check(migrated.pool.length === 3, '保留旧档卡池');
check(migrated.rentIndex === 3, '保留旧档进度');
check(migrated.tokens && migrated.tokens.pokeBall === 0, '补齐 tokens 字段');
check(Array.isArray(migrated.items) && migrated.items.length === 0, '补齐 items 字段');
check(typeof migrated.evolveCount === 'object', '补齐 evolveCount 字段');
check(migrated.contrib && Object.keys(migrated.contrib).length === 0, '旧档补齐 contrib 空对象');
check(migrated.phase === 'spinning', '旧档 choosing/rentReward 状态回退到 spinning');

// 测试3：未知字段原样保留
const withUnknown = { seed: 1, coins: 5, pool: [1], futureField: { a: 1 }, legacyData: 'xyz' };
const m2 = migrate(withUnknown);
check(m2.futureField && m2.futureField.a === 1, '未知对象字段原样保留');
check(m2.legacyData === 'xyz', '未知字符串字段原样保留');

// 测试3b：已有贡献榜原样保留
const withContrib = { seed: 1, coins: 3, contrib: { '4': 12, '7': 5 } };
const m4 = migrate(withContrib);
check(m4.contrib['4'] === 12 && m4.contrib['7'] === 5, '已有 contrib 原样保留');

// 测试4：损坏数据回退
const broken = { seed: 1, pool: [], tokens: { pokeBall: undefined } };
const m3 = migrate(broken);
check(m3.pool.length === 6, '空卡池回退到起始 6 只');
check(m3.tokens.pokeBall === 0, 'undefined 代币补 0');

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
