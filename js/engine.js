/* poke-rent 核心引擎：纯逻辑，可在 Node 与浏览器共用，便于模拟测试 */
(function (global) {
  'use strict';

  var D = (global.PR && global.PR.data) || require('./data.js'),
      TYPES = D.TYPES, POKEMON = D.POKEMON, RENT = D.RENT,
      RARITY = D.RARITY, ITEMS = D.ITEMS, CONFIG = D.CONFIG;

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
      contrib: {},                // 本局贡献金币：物种 id -> 累计金币（__other 为物品等来源）
      tokens: { pokeBall: 0, centerPass: 0 },
      rentIndex: 0,               // 当前第几轮租金（0-based）
      spinsLeft: RENT[0].spins,
      totalSpins: 0,
      coffeeUsed: false,
      postRentOffer: false,       // 交租后的首次三选一强制非凡以上
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

  // 生成 20 格：卡池里每种符号每转各上屏一次，随机铺位；卡池 > 20 时随机抽 20 个
  // 例：卡池 6 只 → 上屏 6 只 + 14 个空格（对齐原作：牌组即卡池，空格随构筑逐步填满）
  function rollGrid(g) {
    var pool = g.pool.slice();
    for (var s = pool.length - 1; s > 0; s--) {
      var j = Math.floor(rng(g)() * (s + 1));
      var tmp = pool[s]; pool[s] = pool[j]; pool[j] = tmp;
    }
    var place = pool.slice(0, CONFIG.cellCount);
    var grid = new Array(CONFIG.cellCount).fill(null);
    var positions = [];
    for (var p = 0; p < CONFIG.cellCount; p++) positions.push(p);
    for (var k = positions.length - 1; k > 0; k--) {
      var q = Math.floor(rng(g)() * (k + 1));
      var t = positions[k]; positions[k] = positions[q]; positions[q] = t;
    }
    for (var i = 0; i < place.length; i++) grid[positions[i]] = place[i];
    if (g.items.indexOf('conveyor') >= 0 && grid.length > 0) {
      var last = grid[grid.length - 1];
      for (var m = grid.length - 1; m > 0; m--) grid[m] = grid[m - 1];
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
  // 同时返回克制来源，供 UI 演出标注「克草 ×3」
  function cellDetail(speciesId, grid, idx) {
    var mon = POKEMON[speciesId];
    if (!mon) return { gain: 0, count: 0, types: [] };
    var type = TYPES[mon.type], count = 0, types = [], nb = neighbors(idx);
    for (var i = 0; i < nb.length; i++) {
      var other = POKEMON[grid[nb[i]]];
      if (other && type.beats.indexOf(other.type) >= 0) {
        count++;
        var nm = TYPES[other.type].name;
        if (types.indexOf(nm) < 0) types.push(nm);
      }
    }
    var gain = count === 0 ? mon.base : mon.base * CONFIG.bonusMultiplier * count;
    return { gain: gain, count: count, types: types };
  }

  function cellGain(speciesId, grid, idx) {
    return cellDetail(speciesId, grid, idx).gain;
  }

  // 整转结算：行优先遍历 20 格，同时按物种累计贡献
  function settleGrid(g, grid) {
    var total = 0, detail = [], info = [], bySpecies = {};
    for (var idx = 0; idx < grid.length; idx++) {
      var id = grid[idx];
      if (id === null || !POKEMON[id]) {
        detail.push(0);
        info.push({ id: id, gain: 0, count: 0, types: [] });
        continue;
      }
      var d = cellDetail(id, grid, idx);
      total += d.gain;
      detail.push(d.gain);
      info.push({ id: id, gain: d.gain, count: d.count, types: d.types });
      bySpecies[id] = (bySpecies[id] || 0) + d.gain;
    }
    if (g.items.indexOf('recycle') >= 0) {
      total += 2;
      bySpecies.__other = (bySpecies.__other || 0) + 2;
    }
    return { total: total, detail: detail, info: info, bySpecies: bySpecies };
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

  // 稀有度档位权重：原作简化版 1.0x = 常见68% / 非凡30% / 稀有1.5%
  // 第 1 次交租前只出普通，之后解锁非凡，第 2 次交租后解锁稀有；
  // 交租后的首次三选一强制非凡以上；坂木的契约把非普通档权重 ×1.2
  function rarityWeights(g) {
    var boost = g.items.indexOf('contract') >= 0 ? CONFIG.rarityBoost : 1;
    var w = {
      common:   100 - RARITY.uncommon.weight * boost - RARITY.rare.weight * boost,
      uncommon: RARITY.uncommon.weight * boost,
      rare:     RARITY.rare.weight * boost
    };
    if (g.rentIndex < 1) { w.common += w.uncommon + w.rare; w.uncommon = 0; w.rare = 0; }
    else if (g.rentIndex < 2) { w.common += w.rare; w.rare = 0; }
    if (g.postRentOffer && g.rentIndex >= 2) w.common = 0;
    return w;
  }

  function pickTier(g, w) {
    var total = w.common + w.uncommon + w.rare;
    if (total <= 0) return 'uncommon';
    var r = rng(g)() * total;
    if (r < w.common) return 'common';
    if (r < w.common + w.uncommon) return 'uncommon';
    return 'rare';
  }

  // 生成三选一：先按权重抽稀有度档，再从该档里抽具体宝可梦
  function rollOffer(g) {
    var n = g.items.indexOf('brokenBall') >= 0 ? CONFIG.baseOfferCount - 1 : CONFIG.baseOfferCount;
    if (g.items.indexOf('brokenBall') >= 0) g.coins += 2;
    var byTier = { common: [], uncommon: [], rare: [] };
    Object.keys(POKEMON).forEach(function (k) {
      var mon = POKEMON[k];
      byTier[mon.rarity].push(mon.id);
    });
    var w = rarityWeights(g), out = [], guard = 0;
    while (out.length < n && guard < 300) {
      guard++;
      var tier = pickTier(g, w);
      var arr = byTier[tier];
      if (!arr || arr.length === 0) continue;
      var id = arr[Math.floor(rng(g)() * arr.length)];
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
    var startCoins = g.coins;
    var grid = rollGrid(g);
    var result = settleGrid(g, grid);
    g.coins += result.total;
    g.lastGain = result.total;
    g.lastGrid = grid;
    g.totalSpins++;
    g.spinsLeft--;
    if (!g.contrib || typeof g.contrib !== 'object') g.contrib = {};
    Object.keys(result.bySpecies).forEach(function (k) {
      g.contrib[k] = (g.contrib[k] || 0) + result.bySpecies[k];
    });
    applyEvolution(g, grid);
    g.log.push('第 ' + g.totalSpins + ' 转：+' + result.total + ' 金');
    g.offer = rollOffer(g);
    g.phase = 'choosing';
    return {
      ok: true, grid: grid, gain: result.total, detail: result.detail,
      info: result.info, bySpecies: result.bySpecies, startCoins: startCoins, offer: g.offer
    };
  }

  // 三选一（或跳过）
  function choose(g, speciesId) {
    if (g.phase !== 'choosing') return { ok: false, reason: 'phase' };
    if (speciesId !== null && speciesId !== undefined) {
      if (g.offer.indexOf(speciesId) < 0) return { ok: false, reason: 'notInOffer' };
      g.pool.push(speciesId); // 卡池污染：选中的符号加入卡池
      g.log.push('加入卡池：' + POKEMON[speciesId].name + '（' + RARITY[POKEMON[speciesId].rarity].name + '）');
    }
    g.postRentOffer = false; // 强制稀有度的三选一已用完
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
    g.postRentOffer = true; // 原作：付租后的符号选择强制不常见以上
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
    cellDetail: cellDetail,
    cellGain: cellGain,
    settleGrid: settleGrid,
    applyEvolution: applyEvolution,
    rarityWeights: rarityWeights,
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
