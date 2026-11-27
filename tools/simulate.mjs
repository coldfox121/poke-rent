/* 模拟测试：验证首版可通关但不稳赢，覆盖核心规则 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
globalThis.PR = {};
require('../js/data.js');
const E = require('../js/engine.js');
const D = globalThis.PR.data;
const ITEMS = D.ITEMS, TOKENS = D.TOKENS;

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL ' + msg); }
  else console.log('PASS ' + msg);
}

// ---- 规则单测 ----
console.log('== 规则单测 ==');
{
  const grid = new Array(20).fill(4);
  grid[0] = 1; grid[2] = 1; grid[5] = 1; // 小火龙(index1) 3 个草邻居
  check(E.cellGain(4, grid, 1) === 6, '小火龙 3 个被克制邻居 = 6');
  const d = E.cellDetail(4, grid, 1);
  check(d.gain === 6 && d.count === 3 && d.types.join('/') === '草', 'cellDetail 返回克制来源：克草 ×3');
}
{
  const g = E.createGame(7);
  const grid = new Array(20).fill(null);
  grid[6] = 4;
  const r = E.settleGrid(g, grid);
  check(r.info[6].gain === 1 && r.bySpecies['4'] === 1, '结算返回逐格明细与按物种贡献');
  E.spin(g);
  const total = Object.keys(g.contrib).reduce((s, k) => s + g.contrib[k], 0);
  check(total > 0, 'spin 写入本局贡献累计');
}
// 卡池每种符号每转各上屏一次（原作逻辑），卡池超过 20 时随机抽 20
{
  const g = E.createGame(11);
  check(g.pool.length === 6, '起始卡池 6 只');
  const filled = E.rollGrid(g).filter(x => x !== null);
  check(filled.length === 6, '卡池 6 只 → 上屏 6 只');
  check(new Set(filled).size === 6, '上屏的 6 只各出现一次（无重复）');
  g.pool = [1, 2, 43, 4, 5, 37, 7, 8, 54, 25, 26, 81, 50, 51, 95, 86, 87, 361, 1, 4]; // 18 种 + 2 重复
  const full = E.rollGrid(g).filter(x => x !== null);
  check(full.length === 20, '卡池 20 只 → 上屏 20 格满格');
  check(new Set(full).size === 18, '卡池中重复物种照原作重复上屏');
  check(E.rollGrid(g).length === 20, '网格始终 20 格');
}
{
  const grid = new Array(20).fill(4);
  check(E.cellGain(4, grid, 10) === 1, '无克制邻居 = 基础 1');
  const grid2 = new Array(20).fill(1);
  grid2[6] = 4; // index6 是内部格，8 个邻居全是草
  check(E.cellGain(4, grid2, 6) === 16, '8 邻居满配 = 16');
}
check(E.neighbors(0).length === 3, '角落 3 邻居');
check(E.neighbors(6).length === 8, '内部 8 邻居');
check(E.neighbors(1).length === 5, '边中 5 邻居');
{
  const g = E.createGame(1);
  for (let i = 0; i < 4; i++) E.applyEvolution(g, new Array(20).fill(4));
  check(g.pool.includes(5) && !g.pool.includes(4), '累计 4 次上屏触发进化并替换卡池');
}

// ---- 稀有度 ----
{
  const g = E.createGame(31);
  g.rentIndex = 0;
  let w = E.rarityWeights(g);
  check(w.common === 100 && w.uncommon === 0 && w.rare === 0, '第 1 次交租前只出普通');
  g.rentIndex = 2;
  w = E.rarityWeights(g);
  check(Math.abs(w.common - 68.5) < 1e-9 && Math.abs(w.uncommon - 30) < 1e-9 && Math.abs(w.rare - 1.5) < 1e-9,
    '1.0x 权重 = 普通68.5 / 非凡30 / 稀有1.5（非常稀有的0.5并入普通）');
  g.items.push('contract');
  w = E.rarityWeights(g);
  check(Math.abs(w.uncommon - 36) < 1e-9 && Math.abs(w.rare - 1.8) < 1e-9, '坂木的契约：稀有度倍率 ×1.2');
  g.postRentOffer = true;
  w = E.rarityWeights(g);
  check(w.common === 0, '交租后首次三选一强制非凡以上');
}
{
  const g = E.createGame(97);
  g.rentIndex = 0;
  let allCommon = true;
  for (let i = 0; i < 120; i++) {
    E.rollOffer(g).forEach(id => { if (D.POKEMON[id].rarity !== 'common') allCommon = false; });
  }
  check(allCommon, '前期 120 次三选一全部为普通档');
  g.rentIndex = 2;
  g.postRentOffer = true;
  let forcedOk = true;
  for (let i = 0; i < 240; i++) {
    E.rollOffer(g).forEach(id => { if (D.POKEMON[id].rarity === 'common') forcedOk = false; });
  }
  check(forcedOk, '交租后 240 次三选一无普通档');
}

// ---- 策略模拟 ----
console.log('== 策略模拟（每种策略 200 局）==');
function runGame(seed, strategy) {
  const g = E.createGame(seed);
  let guard = 0;
  while (g.phase !== 'gameover' && g.phase !== 'win' && guard < 400) {
    guard++;
    if (g.phase === 'spinning') {
      E.spin(g);
    } else if (g.phase === 'choosing') {
      let pick = null;
      if (strategy === 'greedy') {
        // 贪心：选基础产出最高的
        pick = g.offer.reduce((a, b) => D.POKEMON[b].base > D.POKEMON[a].base ? b : a);
      } else if (strategy === 'random') {
        pick = g.offer[Math.floor(Math.random() * g.offer.length)];
      } else if (strategy === 'skip') {
        pick = null;
      }
      E.choose(g, pick);
    } else if (g.phase === 'rentDue') {
      const r = E.payRent(g);
      if (!r.ok) break;
    } else if (g.phase === 'rentReward') {
      E.takeItem(g, g.itemOffer);
    }
  }
  return { win: g.phase === 'win', floors: g.rentIndex, coins: g.coins, spins: g.totalSpins };
}

for (const strategy of ['greedy', 'random', 'skip']) {
  let wins = 0, floors = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    const r = runGame(i + 1, strategy);
    if (r.win) wins++;
    floors += r.floors;
  }
  const rate = (wins / N * 100).toFixed(1);
  console.log(`${strategy}: 通关率 ${rate}% (${wins}/${N}), 平均交租 ${(floors / N).toFixed(1)}/12`);
  if (strategy === 'skip') check(wins / N < 0.70, '全跳过通关率应 <70%（不能稳赢）');
  if (strategy === 'greedy') check(wins / N < 0.95, '贪心策略不应通关率过高（<95%）');
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
