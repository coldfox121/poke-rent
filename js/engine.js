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
      offer: [],                  // 当前宝可梦 3 选 1
      itemOffer: [],              // 交租后的道具 3 选 1
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
    var type = TYPES[mon.type], count = 0, types = [], links = [], nb = neighbors(idx);
    for (var i = 0; i < nb.length; i++) {
      var other = POKEMON[grid[nb[i]]];
      if (other && type.beats.indexOf(other.type) >= 0) {
        count++;
        // 通用联动记录：UI 会让源格与该目标格一起跳，并显示这条联动的收益。
        // 后续特殊能力联动其他宝可梦时，追加 { kind:'ability', target, label } 即可复用。
        links.push({ kind: 'counter', target: nb[i], type: other.type, label: '克' + TYPES[other.type].name });
        var nm = TYPES[other.type].name;
        if (types.indexOf(nm) < 0) types.push(nm);
      }
    }
    var gain = count === 0 ? mon.base : mon.base * CONFIG.bonusMultiplier * count;
    return { gain: gain, count: count, types: types, links: links };
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
        info.push({ id: id, gain: 0, count: 0, types: [], links: [] });
        continue;
      }
      var d = cellDetail(id, grid, idx);
      total += d.gain;
      detail.push(d.gain);
      info.push({ id: id, gain: d.gain, count: d.count, types: d.types, links: d.links });
      bySpecies[id] = (bySpecies[id] || 0) + d.gain;
    }
    var bonus = g.items.filter(function (id) { return id === 'recycle'; }).length * 2
      + g.items.filter(function (id) { return id === 'expShare'; }).length * 1;
    if (bonus > 0) {
      total += bonus;
      bySpecies.__other = (bySpecies.__other || 0) + bonus;
    }
    return { total: total, detail: detail, info: info, bySpecies: bySpecies };
  }

  // 进化阈值：幸运蛋每层 -1，最低 2
  function evolveThresholdOf(g) {
    var n = g.items.filter(function (id) { return id === 'luckyEgg'; }).length;
    return Math.max(2, CONFIG.evolveThreshold - n);
  }

  // 累计上屏次数，达到阈值则进化（卡池中该物种替换为进化形态）
  // 返回 [{from, to, positions}]，供 UI 在对应格子播放进化特效
  // 原地替换传入 grid，使本转演出显示进化后的形态（修复旧版只替换局部变量的问题）
  function applyEvolution(g, grid) {
    var evolved = [], threshold = evolveThresholdOf(g);
    for (var i = 0; i < grid.length; i++) {
      var id = grid[i], mon = POKEMON[id];
      if (id === null || !mon || !mon.evolveTo) continue;
      g.evolveCount[id] = (g.evolveCount[id] || 0) + 1;
      if (g.evolveCount[id] >= threshold) {
        var from = id, to = mon.evolveTo, positions = [];
        g.pool = g.pool.map(function (x) { return x === from ? to : x; });
        for (var j = 0; j < grid.length; j++) {
          if (grid[j] === from) { grid[j] = to; positions.push(j); }
        }
        if (g.lastGrid) g.lastGrid = g.lastGrid.map(function (x) { return x === from ? to : x; });
        g.log.push('进化：' + POKEMON[from].name + ' → ' + POKEMON[to].name);
        evolved.push({ from: from, to: to, positions: positions });
      }
    }
    return evolved;
  }

  // 稀有度档位权重：原作简化版 1.0x = 常见68.5% / 非凡30% / 稀有1.5%
  // 第 1 次交租前只出普通，之后解锁非凡，第 2 次交租后解锁稀有；
  // 交租后的首次三选一强制非凡以上；
  // 坂木的契约、神奇糖果每层 ×1.2（可叠加），普通档权重压到 0 后不再为负
  // forItem=true 时不套用「交租后强制非凡」：那是宝可梦三选一的专用规则，
  // 道具每轮交租后都选，若强制高阶会因高阶道具不足而回退，导致显示概率与结果不符
  function rarityWeights(g, forItem) {
    var layers = g.items.filter(function (id) { return id === 'contract' || id === 'rareCandy'; }).length;
    var boost = Math.pow(CONFIG.rarityBoost, layers);
    var w = {
      common:   Math.max(0, 100 - RARITY.uncommon.weight * boost - RARITY.rare.weight * boost),
      uncommon: RARITY.uncommon.weight * boost,
      rare:     RARITY.rare.weight * boost
    };
    if (g.rentIndex < 1) { w.common += w.uncommon + w.rare; w.uncommon = 0; w.rare = 0; }
    else if (g.rentIndex < 2) { w.common += w.rare; w.rare = 0; }
    if (!forItem && g.postRentOffer) w.common = 0;
    return w;
  }

  // 供 UI 展示的档位百分比（与抽取权重同源）
  function rarityPercent(g, forItem) {
    var w = rarityWeights(g, forItem), total = w.common + w.uncommon + w.rare;
    if (total <= 0) return { common: 0, uncommon: 100, rare: 0 };
    return {
      common:   Math.round(w.common / total * 1000) / 10,
      uncommon: Math.round(w.uncommon / total * 1000) / 10,
      rare:     Math.round(w.rare / total * 1000) / 10
    };
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

  // 交租后的道具 3 选 1：与宝可梦同一套「先抽稀有度档、再抽具体项」逻辑
  // 不可叠加的拿到后不再出现；可叠加的仍可出现，保证 7 轮每轮都有 3 个选项
  function rollItemOffer(g) {
    var n = CONFIG.itemOfferCount, out = [], guard = 0;
    var byTier = { common: [], uncommon: [], rare: [] };
    Object.keys(ITEMS).forEach(function (id) {
      if (g.items.indexOf(id) >= 0 && !ITEMS[id].stackable) return;
      byTier[ITEMS[id].rarity].push(id);
    });
    var w = rarityWeights(g, true);
    while (out.length < n && guard < 300) {
      guard++;
      var tier = pickTier(g, w), arr = byTier[tier];
      if (!arr || arr.length === 0) continue;
      var id = arr[Math.floor(rng(g)() * arr.length)];
      if (out.indexOf(id) >= 0) continue;
      out.push(id);
    }
    if (out.length < n) {
      // 极端情况下（道具拿完）用剩余可选项补齐
      var rest = Object.keys(byTier).reduce(function (a, k) { return a.concat(byTier[k]); }, []);
      for (var i = 0; i < rest.length && out.length < n; i++) {
        if (out.indexOf(rest[i]) < 0) out.push(rest[i]);
      }
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
    var evolved = applyEvolution(g, grid);
    g.log.push('第 ' + g.totalSpins + ' 转：+' + result.total + ' 金');
    if (g.spinsLeft <= 0) {
      // 交租轮：本转不再选宝可梦，先去交租 → 领道具 → 交租后再选
      g.offer = [];
      g.phase = 'rentDue';
    } else {
      g.offer = rollOffer(g);
      g.phase = 'choosing';
    }
    return {
      ok: true, grid: grid, gain: result.total, detail: result.detail,
      info: result.info, bySpecies: result.bySpecies, startCoins: startCoins, offer: g.offer,
      evolved: evolved
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

    // 每次交租后固定发放代币：2 张精灵中心券（删牌）+ 1 个精灵球（刷新）
    g.tokens.centerPass += CONFIG.removalPerRent;
    g.tokens.pokeBall += CONFIG.rerollPerRent;
    g.log.push('收到邮件：精灵中心券 ×' + CONFIG.removalPerRent + ' + 精灵球 ×' + CONFIG.rerollPerRent);

    g.itemOffer = rollItemOffer(g);
    g.spinsLeft = RENT[g.rentIndex].spins;
    g.postRentOffer = true; // 交租后的首次三选一强制非凡以上
    g.phase = 'rentReward';
    return { ok: true, rent: rent.rent, itemOffer: g.itemOffer };
  }

  // 领取交租奖励物品（可跳过；道具可叠加）
  function takeItem(g, itemId) {
    if (g.phase !== 'rentReward') return { ok: false, reason: 'phase' };
    if (itemId && g.itemOffer.indexOf(itemId) >= 0) {
      g.items.push(itemId);
      g.log.push('获得物品：' + ITEMS[itemId].name);
    }
    g.itemOffer = [];
    // 交租轮的宝可梦三选一挪到领完道具之后，此时才生成并展示
    g.offer = rollOffer(g);
    g.phase = 'choosing';
    return { ok: true, offer: g.offer };
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
    evolveThresholdOf: evolveThresholdOf,
    rarityWeights: rarityWeights,
    rarityPercent: rarityPercent,
    rollOffer: rollOffer,
    rollItemOffer: rollItemOffer,
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
