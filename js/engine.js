/* poke-rent 核心引擎：纯逻辑，可在 Node 与浏览器共用，便于模拟测试 */
(function (global) {
  'use strict';

  var D = (global.PR && global.PR.data) || require('./data.js'),
      TYPES = D.TYPES, POKEMON = D.POKEMON, RENT = D.RENT,
      ITEMS = D.ITEMS, CONFIG = D.CONFIG;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 确定性随机：传入 seed 可复现，便于测试
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 1000000) / 1000000;
    };
  }

  function createGame(seed) {
    var pool = D.STARTER_POOL.slice(); // 卡池：可重复的物种 id 列表
    return {
      seed: seed || (Date.now() >>> 0),
      rng: null,
      coins: CONFIG.startCoins,
      pool: pool,
      evolveCount: {},            // 物种 id -> 累计上屏次数
      items: [],                  // 已拥有的永久物品 id
      tokens: { pokeBall: 0, centerPass: 0 },
      rentIndex: 0,               // 当前第几轮租金（0-based）
      spinsLeft: RENT[0].spins,
      totalSpins: 0,
      coffeeUsed: false,
      phase: 'spinning',          // spinning | choosing | rentDue | gameover | win
      offer: [],                  // 当前 3 选 1
      lastGrid: [],               // 上一转的 20 格
      lastGain: 0,
      log: []
    };
  }

  function rng(g) {
    if (!g.rng) g.rng = makeRng(g.seed);
    return g.rng;
  }

  function pickFromPool(g) {
    var p = g.pool;
    return p[Math.floor(rng(g)() * p.length)];
  }

  // 生成 20 格：只填部分格子（随进度增加），空格不产出；按传送带右移
  function rollGrid(g) {
    var grid = new Array(CONFIG.cellCount).fill(null);
    var fill = Math.min(CONFIG.fillBase + g.rentIndex * CONFIG.fillPerRent, CONFIG.fillMax, CONFIG.cellCount);
    // 随机选 fill 个位置放置符号
    var positions = [];
    for (var p = 0; p < CONFIG.cellCount; p++) positions.push(p);
    for (var k = 0; k < fill; k++) {
      var swap = k + Math.floor(rng(g)() * (CONFIG.cellCount - k));
      var tmp = positions[k]; positions[k] = positions[swap]; positions[swap] = tmp;
    }
    for (var i = 0; i < fill; i++) grid[positions[i]] = pickFromPool(g);
    if (g.items.indexOf('conveyor') >= 0 && grid.length > 0) {
      var last = grid[grid.length - 1];
      for (var j = grid.length - 1; j > 0; j--) grid[j] = grid[j - 1];
      grid[0] = last;
    }
    return grid;
  }

  // 行优先遍历，8 邻域（含斜角）
  function neighbors(idx) {
    var r = Math.floor(idx / CONFIG.cols), c = idx % CONFIG.cols, out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < CONFIG.rows && nc >= 0 && nc < CONFIG.cols) out.push(nr * CONFIG.cols + nc);
      }
    }
    return out;
  }

  // 结算单格：每个被自己克制的邻居独立结算一次 base×2，多次相加；无克制邻居则 base
  function cellGain(speciesId, grid, idx) {
    var mon = POKEMON[speciesId];
    if (!mon) return 0;
    var type = TYPES[mon.type], count = 0, nb = neighbors(idx);
    for (var i = 0; i < nb.length; i++) {
      var other = POKEMON[grid[nb[i]]];
      if (other && type.beats.indexOf(other.type) >= 0) count++;
    }
    if (count === 0) return mon.base;
    return mon.base * CONFIG.bonusMultiplier * count;
  }

  // 整转结算：行优先遍历 20 格
  function settleGrid(g, grid) {
    var total = 0, detail = [];
    for (var idx = 0; idx < grid.length; idx++) {
      var gain = grid[idx] === null ? 0 : cellGain(grid[idx], grid, idx);
      total += gain;
      detail.push(gain);
    }
    if (g.items.indexOf('recycle') >= 0) total += 2;
    return { total: total, detail: detail };
  }

  // 累计上屏次数，达到阈值则进化（卡池中该物种替换为进化形态）
  function applyEvolution(g, grid) {
    var evolved = [];
    for (var i = 0; i < grid.length; i++) {
      var id = grid[i], mon = POKEMON[id];
      if (id === null || !mon || !mon.evolveTo) continue;
      g.evolveCount[id] = (g.evolveCount[id] || 0) + 1;
      if (g.evolveCount[id] >= CONFIG.evolveThreshold) {
        var from = id, to = mon.evolveTo;
        g.pool = g.pool.map(function (x) { return x === from ? to : x; });
        // 同步替换本转 grid 与 lastGrid 中的该物种
        grid = grid.map(function (x) { return x === from ? to : x; });
        if (g.lastGrid) g.lastGrid = g.lastGrid.map(function (x) { return x === from ? to : x; });
        g.log.push('进化：' + POKEMON[from].name + ' → ' + POKEMON[to].name);
        evolved.push(from);
      }
    }
    return evolved;
  }

  // 生成 3 选 1 候选：从全局 18 只中抽取，优先未拥有的物种以形成构筑
  function rollOffer(g) {
    var n = g.items.indexOf('brokenBall') >= 0 ? CONFIG.baseOfferCount - 1 : CONFIG.baseOfferCount;
    if (g.items.indexOf('brokenBall') >= 0) g.coins += 2;
    var all = Object.keys(POKEMON).map(Number);
    var owned = {};
    g.pool.forEach(function (id) { owned[id] = true; });
    // 排序：未拥有的优先，其次已拥有的
    all.sort(function (a, b) { return (owned[a] ? 1 : 0) - (owned[b] ? 1 : 0); });
    // 在未拥有里随机取，不足则补已拥有
    var candidateCount = all.filter(function (id) { return !owned[id]; }).length;
    var out = [];
    var guard = 0;
    while (out.length < n && guard < 200) {
      guard++;
      var upper = Math.max(candidateCount, 1);
      var idx = Math.floor(rng(g)() * Math.min(upper + 2, all.length));
      var id = all[idx];
      if (out.indexOf(id) >= 0) continue;
      out.push(id);
    }
    return out;
  }

  // 执行一次转动
  function spin(g) {
    if (g.phase !== 'spinning') return { ok: false, reason: 'phase' };
    if (g.coins < CONFIG.spinCost) return { ok: false, reason: 'coins' };
    g.coins -= CONFIG.spinCost;
    var grid = rollGrid(g);
    var result = settleGrid(g, grid);
    g.coins += result.total;
    g.lastGain = result.total;
    g.lastGrid = grid;
    g.totalSpins++;
    g.spinsLeft--;
    applyEvolution(g, grid);
    g.log.push('第 ' + g.totalSpins + ' 转：+' + result.total + ' 金');
    g.offer = rollOffer(g);
    g.phase = 'choosing';
    return { ok: true, grid: grid, gain: result.total, detail: result.detail, offer: g.offer };
  }

  // 三选一（或跳过）
  function choose(g, speciesId) {
    if (g.phase !== 'choosing') return { ok: false, reason: 'phase' };
    if (speciesId !== null && speciesId !== undefined) {
      if (g.offer.indexOf(speciesId) < 0) return { ok: false, reason: 'notInOffer' };
      g.pool.push(speciesId); // 卡池污染：选中的符号加入卡池
      g.log.push('加入卡池：' + POKEMON[speciesId].name);
    }
    if (g.spinsLeft <= 0) {
      g.phase = 'rentDue';
    } else {
      g.phase = 'spinning';
    }
    return { ok: true };
  }

  // 使用精灵球刷新 3 选 1
  function usePokeBall(g) {
    if (g.phase !== 'choosing') return { ok: false, reason: 'phase' };
    if (g.tokens.pokeBall <= 0) return { ok: false, reason: 'noToken' };
    g.tokens.pokeBall--;
    g.offer = rollOffer(g);
    return { ok: true, offer: g.offer };
  }

  // 使用精灵中心券：移除卡池中一个符号（不能移空）
  function useCenterPass(g, speciesId) {
    if (g.tokens.centerPass <= 0) return { ok: false, reason: 'noToken' };
    if (g.pool.length <= 1) return { ok: false, reason: 'poolTooSmall' };
    var idx = g.pool.indexOf(speciesId);
    if (idx < 0) return { ok: false, reason: 'notInPool' };
    g.pool.splice(idx, 1);
    g.tokens.centerPass--;
    g.log.push('移除卡池：' + POKEMON[speciesId].name);
    return { ok: true };
  }

  // 交租
  function payRent(g) {
    if (g.phase !== 'rentDue') return { ok: false, reason: 'phase' };
    var rent = RENT[g.rentIndex];
    var pay = rent.rent;
    if (g.items.indexOf('contract') >= 0) pay = Math.max(0, pay - 6);

    if (g.coins < pay) {
      if (g.items.indexOf('coffee') >= 0 && !g.coffeeUsed) {
        g.coffeeUsed = true;
        g.spinsLeft = 2;
        g.phase = 'spinning';
        g.log.push('提神咖啡：额外 2 转');
        return { ok: true, saved: true, rent: rent.rent };
      }
      g.phase = 'gameover';
      g.log.push('交不起房租，被赶出公寓');
      return { ok: false, reason: 'gameover', rent: rent.rent };
    }

    g.coins -= pay;
    g.rentIndex++;
    // 交完租刚好 0 金币则补 1，防止卡死
    if (g.coins === 0) g.coins = 1;
    g.log.push('交租 ' + rent.rent + '，剩余 ' + g.coins + ' 金');

    if (g.rentIndex >= CONFIG.rentCount) {
      g.phase = 'win';
      return { ok: true, win: true };
    }

    // 邮件：从第 3 次租金起每隔一次给刷新/删除代币
    if (g.rentIndex >= 2 && (g.rentIndex - 2) % 2 === 0) {
      g.tokens.pokeBall++;
      g.tokens.centerPass++;
      g.log.push('收到邮件：精灵球 + 精灵中心券');
    }
    // 交租后 3 选 1 永久物品（首版 5 个随机给一个未拥有的）
    var avail = Object.keys(ITEMS).filter(function (k) { return g.items.indexOf(k) < 0; });
    if (avail.length > 0) {
      g.itemOffer = avail[Math.floor(rng(g)() * avail.length)];
    } else {
      g.itemOffer = null;
    }

    g.spinsLeft = RENT[g.rentIndex].spins;
    g.phase = 'rentReward';
    return { ok: true, rent: rent.rent, itemOffer: g.itemOffer };
  }

  // 领取交租奖励物品
  function takeItem(g, itemId) {
    if (g.phase !== 'rentReward') return { ok: false, reason: 'phase' };
    if (itemId && g.itemOffer === itemId) {
      g.items.push(itemId);
      g.log.push('获得物品：' + ITEMS[itemId].name);
    }
    g.phase = 'spinning';
    return { ok: true };
  }

  function getRent(g) {
    return g.rentIndex < RENT.length ? RENT[g.rentIndex] : null;
  }

  var engine = {
    makeRng: makeRng,
    createGame: createGame,
    rollGrid: rollGrid,
    neighbors: neighbors,
    cellGain: cellGain,
    settleGrid: settleGrid,
    applyEvolution: applyEvolution,
    rollOffer: rollOffer,
    spin: spin,
    choose: choose,
    usePokeBall: usePokeBall,
    useCenterPass: useCenterPass,
    payRent: payRent,
    takeItem: takeItem,
    getRent: getRent,
    clone: clone
  };

  global.PR = global.PR || {};
  global.PR.engine = engine;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = engine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
