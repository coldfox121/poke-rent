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
