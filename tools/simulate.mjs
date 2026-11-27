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
  check(E.cellGain(4, grid, 1) === 9, '小火龙 3 个被克制邻居 = 6 + 火苗 3');
  const d = E.cellDetail(4, grid, 1);
  check(d.gain === 9 && d.count === 3 && d.types.join('/') === '草', 'cellDetail 返回克制来源：克草 ×3');
  check(d.links.filter(x => x.kind === 'counter').length === 3,
    '返回逐条联动目标，供 UI 多次跳动');
  check(d.links.some(x => x.kind === 'ability' && x.label === '火苗'), '能力收益也写入联动记录');
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
  check(g.lastContrib && Object.keys(g.lastContrib).length > 0, 'spin 写入上一转贡献');
}
// 卡池每种符号每转各上屏一次（原作逻辑），卡池超过 20 时随机抽 20
{
  const g = E.createGame(11);
  check(g.pool.length === 3, '起始卡池御三家 3 只');
  check([1, 4, 7].every(id => g.pool.includes(id)), '起始为妙蛙种子/小火龙/杰尼龟');
  const filled = E.rollGrid(g).filter(x => x !== null);
  check(filled.length === 3, '卡池 3 只 → 上屏 3 只');
  check(new Set(filled).size === 3, '上屏的 3 只各出现一次（无重复）');
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
  check(E.cellGain(4, grid2, 6) === 19, '8 邻居满配 = 16 + 火苗 3');
}
check(E.neighbors(0).length === 3, '角落 3 邻居');
check(E.neighbors(6).length === 8, '内部 8 邻居');
check(E.neighbors(1).length === 5, '边中 5 邻居');
{
  const g = E.createGame(1);
  let ev = null;
  for (let i = 0; i < 4; i++) ev = E.applyEvolution(g, new Array(20).fill(4));
  check(g.pool.includes(4), '累计 4 次上屏后不自动进化，卡池仍为一阶');
  check(Array.isArray(ev) && ev.length === 1 && ev[0].from === 4 && ev[0].to === 5,
    'applyEvolution 返回待确认进化列表');
  check(Array.isArray(ev[0].positions) && ev[0].positions.length === 20, '待确认信息含全部位置');
  check(E.canEvolve(g, 4) === true, 'canEvolve 判定为可确认进化');
  const r = E.evolve(g, 4);
  check(r.ok && g.pool.includes(5) && !g.pool.includes(4), '玩家确认后卡池替换为二阶形态');
  check(E.canEvolve(g, 4) === false, '进化后不再可进化');
}
{
  const g = E.createGame(12);
  const grid = new Array(20).fill(null);
  grid[0] = 4;
  for (let i = 0; i < 4; i++) E.applyEvolution(g, grid);
  check(grid[0] === 4, '未确认时本转形态保持一阶');
  E.evolve(g, 4);
  check(g.pool.includes(5), '确认后卡池同步为进化形态');
}
// ---- 特殊能力 ----
{
  const corner = new Array(20).fill(null); corner[0] = 50;
  check(E.cellGain(50, corner, 0) === 4, '地鼠在角落 +3');
  const bottom = new Array(20).fill(null); bottom[15] = 43;
  check(E.cellGain(43, bottom, 15) === 4, '走路草在底行 +3');
  const aura = new Array(20).fill(null); aura[0] = 37; aura[1] = 4;
  check(E.cellGain(4, aura, 1) === 2, '暖炉给相邻火属性 +1');
  const suppress = new Array(20).fill(null); suppress[0] = 86; suppress[1] = 1;
  check(E.cellGain(1, suppress, 1) === 0, '冰息压制被自己克制的邻居');
  check(E.cellGain(86, suppress, 0) === 3, '冰息自身：克制 2 + 能力 1');
  const ice3 = new Array(20).fill(null); ice3[0] = 86; ice3[1] = 87; ice3[2] = 361;
  check(E.cellGain(361, ice3, 2) === 4, '雪隐在场上 3 只冰属性时 +3');
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

// ---- 7 轮 / 道具 3 选 1 / 代币 / 叠加效果 ----
{
  check(D.RENT.length === 7, '租金改为 7 轮');
  check(D.RENT.every(r => r.spins === 5), '每轮固定 5 转');
  const g = E.createGame(3);
  g.rentIndex = 2;
  const offers = E.rollItemOffer(g);
  check(offers.length === 3 && new Set(offers).size === 3, '交租后道具 3 选 1');
  check(offers.every(id => ITEMS[id] && ITEMS[id].rarity), '道具奖励带稀有度');
  g.items = Object.keys(ITEMS);
  check(E.rollItemOffer(g).length === 3, '道具全拿过后仍能给出 3 个可叠加选项');
  const g2 = E.createGame(5);
  g2.coins = 9999;
  g2.phase = 'rentDue';
  const before = { c: g2.tokens.centerPass, p: g2.tokens.pokeBall };
  g2.rentIndex = 2;
  E.payRent(g2);
  check(g2.tokens.centerPass === before.c + 2 && g2.tokens.pokeBall === before.p + 1,
    '每次交租发 2 张删除券 + 1 个精灵球');
  check(Array.isArray(g2.itemOffer) && g2.itemOffer.length === 3, '交租后 itemOffer 为 3 元素数组');
}
{
  // 交租轮顺序：第 5 转 → 收租 → 领道具 → 才选宝可梦
  const g = E.createGame(42);
  g.coins = 9999; g.spinsLeft = 1; g.phase = 'spinning';
  const spin = E.spin(g);
  check(spin.ok && g.phase === 'rentDue' && g.offer.length === 0, '交租轮最后一转不弹三选一，直接进入收租');
  const pay = E.payRent(g);
  check(pay.ok && g.phase === 'rentReward', '收租后进入道具奖励');
  const take = E.takeItem(g, g.itemOffer[0]);
  check(g.phase === 'choosing' && g.offer.length === 3, '领完道具后才生成并展示宝可梦三选一');
  check(g.postRentOffer === true, '交租后的三选一保留稀有度提升');
  check(take.offer.length === 3, 'takeItem 返回新的三选一');
  E.choose(g, g.offer[0]);
  check(g.phase === 'spinning' && g.spinsLeft === 5, '选完宝可梦后开始下一轮 5 转');
}
{
  const g = E.createGame(8);
  g.rentIndex = 2;
  g.items = ['contract', 'rareCandy'];
  const w = E.rarityWeights(g);
  check(Math.abs(w.uncommon - 43.2) < 1e-9, '契约 + 神奇糖果叠加：非凡权重 ×1.44');
  check(w.common >= 0, '高倍率下普通档权重不为负');
  g.items.push('luckyEgg', 'luckyEgg');
  check(E.evolveThresholdOf(g) === 2, '两个幸运蛋把进化阈值降到最低 2');
  g.items.push('expShare', 'recycle');
  const r = E.settleGrid(g, new Array(20).fill(null));
  check(r.total === 3 && r.bySpecies.__other === 3, '学习装置 + 回收叠加：每转额外 +3 金');
}
{
  const g = E.createGame(9);
  g.rentIndex = 0;
  let ok = true;
  for (let i = 0; i < 120; i++) {
    E.rollItemOffer(g).forEach(id => { if (ITEMS[id].rarity !== 'common') ok = false; });
  }
  check(ok, '第 1 次交租前道具也只出普通档（与宝可梦一致）');
  g.postRentOffer = true;
  g.rentIndex = 2;
  let sawCommon = false;
  for (let i = 0; i < 120; i++) {
    E.rollItemOffer(g).forEach(id => { if (ITEMS[id].rarity === 'common') sawCommon = true; });
  }
  check(sawCommon, '交租后道具不套用「强制非凡」规则，普通道具仍会出现');
  const pct = E.rarityPercent(g, true);
  check(pct.common === 68.5 && pct.uncommon === 30 && pct.rare === 1.5,
    '道具档位展示概率与实际抽取权重一致');
}

// ---- 策略模拟 ----
console.log('== 策略模拟（每种策略 200 局）==');
function runGame(seed, strategy) {
  const g = E.createGame(seed);
  let guard = 0;
  while (g.phase !== 'gameover' && g.phase !== 'win' && guard < 400) {
    guard++;
    if (g.phase === 'spinning') {
      const res = E.spin(g);
      // 模拟玩家在每转结束后立刻确认进化
      (res.pending || []).forEach(p => { if (E.canEvolve(g, p.from)) E.evolve(g, p.from); });
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
      E.takeItem(g, g.itemOffer[0]);
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
  console.log(`${strategy}: 通关率 ${rate}% (${wins}/${N}), 平均交租 ${(floors / N).toFixed(1)}/${D.CONFIG.rentCount}`);
  if (strategy === 'greedy') check(floors / N > 3, '临时低难度下贪心能推进到后段轮次');
  if (strategy === 'skip') check(floors / N <= 7, '全跳过平均轮次不超出总轮数');
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
