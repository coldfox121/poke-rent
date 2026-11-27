/* poke-rent UI 层：渲染、交互、localStorage 存档 */
(function () {
  'use strict';
  var D = window.PR.data, E = window.PR.engine,
      POKEMON = D.POKEMON, TYPES = D.TYPES, RARITY = D.RARITY,
      ITEMS = D.ITEMS, TOKENS = D.TOKENS, RENT = D.RENT,
      ANIM = D.ANIM;

  var SAVE_KEY = 'poke-rent-save';
  var DEX_KEY = 'poke-rent-dex';   // 图鉴跨局保留，与单局存档分离
  var CACHE_V = D.CONFIG.cacheVersion;
  var game = null, dex = [], dexSelected = null;
  // 演出状态：token 递增使旧演出失效，避免「跳过 / 重开」后旧回调继续跑
  var anim = { active: false, token: 0, timer: null };

  function $(id) { return document.getElementById(id); }
  function v(path) { return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'v=' + CACHE_V; }
  function sprite(id) { return v('assets/pokemon/' + id + '.png'); }
  function icon(path) { return v(path); }

  // 存档：结构真变化才升 SAVE_VERSION，纯加法迁移
  function save() {
    if (!game) return;
    var raw = {
      saveVersion: D.CONFIG.saveVersion,
      seed: game.seed,
      coins: game.coins, pool: game.pool, evolveCount: game.evolveCount,
      contrib: game.contrib || {},
      items: game.items, tokens: game.tokens, rentIndex: game.rentIndex,
      spinsLeft: game.spinsLeft, totalSpins: game.totalSpins,
      coffeeUsed: game.coffeeUsed, postRentOffer: !!game.postRentOffer, phase: game.phase,
      itemOffer: game.itemOffer || [],
      lastGrid: game.lastGrid, lastGain: game.lastGain, log: game.log.slice(-50)
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(raw)); } catch (e) {}
  }

  function loadDex() {
    try {
      var s = localStorage.getItem(DEX_KEY);
      if (s) {
        var arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr.filter(function (id) { return !!POKEMON[id]; });
      }
    } catch (e) {}
    return [];
  }

  function saveDex() {
    try { localStorage.setItem(DEX_KEY, JSON.stringify(dex)); } catch (e) {}
  }

  // 首次进入卡池即点亮：开局自带的 6 只也算，跨局保留
  function lightDex(ids) {
    var changed = false;
    (ids || []).forEach(function (id) {
      if (POKEMON[id] && dex.indexOf(id) < 0) { dex.push(id); changed = true; }
    });
    if (changed) saveDex();
    return changed;
  }

  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    // 纯加法：先原样继承旧档全部字段（含未知字段），再补齐缺失字段
    var base = E.createGame(raw.seed);
    var g = {};
    Object.keys(raw).forEach(function (k) { g[k] = raw[k]; });
    Object.keys(base).forEach(function (k) { if (!(k in g)) g[k] = base[k]; });
    if (!g.tokens) g.tokens = { pokeBall: 0, centerPass: 0 };
    if (g.tokens.pokeBall === undefined) g.tokens.pokeBall = 0;
    if (g.tokens.centerPass === undefined) g.tokens.centerPass = 0;
    if (!Array.isArray(g.pool) || g.pool.length === 0) g.pool = D.STARTER_POOL.slice();
    if (!Array.isArray(g.items)) g.items = [];
    if (!Array.isArray(g.log)) g.log = [];
    if (!g.evolveCount || typeof g.evolveCount !== 'object') g.evolveCount = {};
    if (!g.contrib || typeof g.contrib !== 'object') g.contrib = {};
    if (typeof g.postRentOffer !== 'boolean') g.postRentOffer = false;
    // v3 的 itemOffer 是单个 id，v4 起改为数组（纯加法迁移：旧值转成单元素数组）
    if (typeof g.itemOffer === 'string') g.itemOffer = [g.itemOffer];
    if (!Array.isArray(g.itemOffer)) g.itemOffer = [];
    if (typeof g.rentIndex !== 'number' || g.rentIndex < 0) g.rentIndex = 0;
    // 旧版 12 轮存档的进度已超过新版 7 轮：保留数值，按通关处理，避免数组越界
    if (g.rentIndex >= D.CONFIG.rentCount && g.phase !== 'win' && g.phase !== 'gameover') g.phase = 'win';
    if (g.phase === 'choosing' || g.phase === 'rentReward') g.phase = 'spinning';
    return g;
  }

  function load() {
    try {
      var s = localStorage.getItem(SAVE_KEY);
      if (s) return migrate(JSON.parse(s));
    } catch (e) {}
    return null;
  }

  function renderHUD() {
    $('hud-coins').textContent = game.coins;
    var r = RENT[game.rentIndex];
    $('hud-rent').textContent = r ? r.rent : '—';
    $('hud-spins').textContent = game.spinsLeft;
    $('hud-progress').textContent = game.rentIndex + '/' + D.CONFIG.rentCount;
    $('btn-dex').textContent = '图鉴 ' + dex.length + '/' + Object.keys(POKEMON).length;
    var statusMap = {
      spinning: '按转动开始', choosing: '请选择符号', rentDue: '该交租了',
      rentReward: '选择物品', gameover: '已被赶出', win: '通关！'
    };
    $('machine-status').textContent = statusMap[game.phase] || game.phase;
    $('btn-spin').disabled = game.phase !== 'spinning' || game.coins < D.CONFIG.spinCost;
  }

  // 只重绘格子内容，保留 cell 元素本身：演出期间重建 DOM 会冲掉动画 class
  function paintCells(grid) {
    var reel = $('reel');
    if (reel.children.length !== D.CONFIG.cellCount) reel.innerHTML = '';
    for (var i = 0; i < D.CONFIG.cellCount; i++) {
      var cell = reel.children[i] || document.createElement('div');
      if (!cell.parentNode) reel.appendChild(cell);
      cell.className = 'cell';
      var id = grid && grid[i];
      if (id && POKEMON[id]) {
        var mon = POKEMON[id], ty = TYPES[mon.type];
        cell.innerHTML = '<img src="' + sprite(mon.id) + '" alt="' + mon.name + '">'
          + '<span class="nm">' + mon.name + '</span>'
          + '<span class="ty" style="background:' + ty.color + '">' + ty.name + '</span>';
      } else {
        cell.classList.add('empty');
        cell.textContent = '·';
      }
    }
  }

  function renderReel() {
    paintCells(game.lastGrid);
    if (game.lastGain > 0) {
      $('gain-line').innerHTML = '上转收益 <span class="big">+' + game.lastGain + '</span> 金';
    } else {
      $('gain-line').textContent = '—';
    }
  }

  function renderPool() {
    var counts = {};
    game.pool.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    var box = $('pool');
    box.innerHTML = '';
    Object.keys(counts).forEach(function (id) {
      var mon = POKEMON[id];
      if (!mon) return;
      var chip = document.createElement('div');
      chip.className = 'pool-chip';
      var img = document.createElement('img');
      img.src = sprite(id); img.alt = mon.name;
      chip.appendChild(img);
      var label = document.createElement('span');
      label.textContent = mon.name;
      chip.appendChild(label);
      var rar = document.createElement('span');
      rar.className = 'pool-rar';
      rar.style.color = RARITY[mon.rarity].color;
      rar.textContent = RARITY[mon.rarity].name.charAt(0);
      chip.appendChild(rar);
      if (game.evolveCount[id]) {
        var evo = document.createElement('span');
        evo.className = 'evo';
        evo.textContent = game.evolveCount[id] + '/' + D.CONFIG.evolveThreshold;
        chip.appendChild(evo);
      }
      // 有中心券时点击 chip 可移除该符号
      if ((game.tokens.centerPass || 0) > 0) {
        chip.style.cursor = 'pointer';
        chip.title = '点击用精灵中心券移除';
        chip.onclick = function (species) {
          return function () {
            if (!confirm('用精灵中心券移除 ' + POKEMON[species].name + '？')) return;
            var res = E.useCenterPass(game, species);
            if (res.ok) { save(); render(); }
            else alert('无法移除：' + res.reason);
          };
        }(parseInt(id, 10));
      }
      box.appendChild(chip);
    });
    $('pool-count').textContent = game.pool.length;
  }

  function renderItems() {
    var box = $('items');
    box.innerHTML = '';
    if (game.items.length === 0) {
      box.innerHTML = '<div class="empty">暂无</div>';
    } else {
      game.items.forEach(function (id) {
        var it = ITEMS[id];
        var row = document.createElement('div');
        row.className = 'item';
        var img = document.createElement('img');
        img.src = icon(it.icon); img.alt = it.name;
        row.appendChild(img);
        var txt = document.createElement('div');
        txt.className = 'txt';
        var b = document.createElement('b'); b.textContent = it.name;
        var s = document.createElement('span'); s.textContent = it.desc;
        txt.appendChild(b); txt.appendChild(s);
        row.appendChild(txt);
        box.appendChild(row);
      });
    }
    var tbox = $('tokens');
    tbox.innerHTML = '';
    ['pokeBall', 'centerPass'].forEach(function (id) {
      var tk = TOKENS[id], n = game.tokens[id] || 0;
      var row = document.createElement('div');
      row.className = 'item';
      var img = document.createElement('img');
      img.src = icon(tk.icon); img.alt = tk.name;
      row.appendChild(img);
      var txt = document.createElement('div');
      txt.className = 'txt';
      var b = document.createElement('b'); b.textContent = tk.name + ' ×' + n;
      var s = document.createElement('span'); s.textContent = tk.desc;
      txt.appendChild(b); txt.appendChild(s);
      row.appendChild(txt);
      tbox.appendChild(row);
    });
  }

  function renderLog() {
    var box = $('log');
    box.innerHTML = '';
    game.log.slice(-12).reverse().forEach(function (line) {
      var d = document.createElement('div');
      d.textContent = line;
      box.appendChild(d);
    });
  }

  // 本局贡献金币排名：按宝可梦种类累计，降序；__other 为物品等额外来源
  function renderRank() {
    var c = game.contrib || {};
    var rows = Object.keys(c).filter(function (k) { return c[k] > 0 && (k === '__other' || POKEMON[k]); })
      .map(function (k) { return { key: k, val: c[k] }; })
      .sort(function (a, b) { return b.val - a.val; });
    var total = rows.reduce(function (s, r) { return s + r.val; }, 0);
    $('rank-total').textContent = total;
    var box = $('rank');
    box.innerHTML = '';
    if (rows.length === 0) {
      box.innerHTML = '<div class="empty">还没有收益</div>';
      return;
    }
    var top = rows[0].val;
    rows.forEach(function (r, i) {
      var other = r.key === '__other';
      var row = document.createElement('div');
      row.className = 'rank-row';
      var idx = document.createElement('span');
      idx.className = 'rank-idx'; idx.textContent = (i + 1);
      var img = document.createElement('img');
      img.src = other ? icon('assets/items/recycle.png') : sprite(r.key);
      img.alt = other ? '其它' : POKEMON[r.key].name;
      var name = document.createElement('span');
      name.className = 'rank-name'; name.textContent = other ? '其它' : POKEMON[r.key].name;
      var barWrap = document.createElement('span');
      barWrap.className = 'rank-bar';
      var bar = document.createElement('i');
      bar.style.width = Math.max(3, Math.round(r.val / top * 100)) + '%';
      barWrap.appendChild(bar);
      var val = document.createElement('span');
      val.className = 'rank-val'; val.textContent = '+' + r.val;
      row.appendChild(idx); row.appendChild(img); row.appendChild(name);
      row.appendChild(barWrap); row.appendChild(val);
      box.appendChild(row);
    });
  }

  function render() {
    renderHUD(); renderReel(); renderPool(); renderItems(); renderLog(); renderRank();
  }

  function showModal(html) {
    $('modal').innerHTML = html;
    $('modal-layer').style.display = 'flex';
    $('modal-dock').style.display = 'none';
  }
  function hideModal() {
    $('modal-layer').style.display = 'none';
    $('modal-dock').style.display = 'none';
  }

  function showOffer() {
    var pct = E.rarityPercent(game);
    var html = '<h2>选择一只宝可梦</h2><div class="lead">选中的宝可梦会加入卡池；也可以跳过保持卡池干净。可点「收起」对照上轮结果再决定。</div>'
      + (game.postRentOffer ? '<div class="badge">交租后：本次稀有度至少非凡</div>' : '')
      + '<div class="choices">';
    game.offer.forEach(function (id) {
      var mon = POKEMON[id], ty = TYPES[mon.type], rar = RARITY[mon.rarity];
      html += '<div class="choice" data-id="' + id + '"><img src="' + sprite(id) + '" alt="' + mon.name + '"><span class="nm">' + mon.name + '</span>'
        + '<span class="rar" style="color:' + rar.color + ';border-color:' + rar.color + '">' + rar.name + '</span>'
        + '<span class="ty">' + ty.name + ' · 基础' + mon.base + '</span>'
        + '<span class="prob">' + rar.name + '档 ' + pct[mon.rarity] + '%</span></div>';
    });
    html += '</div><div class="modal-actions">';
    if ((game.tokens.pokeBall || 0) > 0) html += '<button class="btn" id="m-reroll">精灵球 ×' + game.tokens.pokeBall + ' 刷新</button>';
    html += '<button class="btn btn-ghost" id="m-hide">收起</button>';
    html += '<button class="btn btn-ghost" id="m-skip">跳过</button></div>';
    showModal(html);
    Array.prototype.forEach.call(document.querySelectorAll('.choice'), function (el) {
      el.onclick = function () {
        var id = parseInt(el.dataset.id, 10);
        E.choose(game, id);
        // 有空格就填一个进去（随机空位），让新符号立即可见；无空格保持原样，不做保底
        var empty = [];
        for (var i = 0; i < game.lastGrid.length; i++) {
          if (game.lastGrid[i] === null || game.lastGrid[i] === undefined) empty.push(i);
        }
        if (empty.length > 0) game.lastGrid[empty[Math.floor(Math.random() * empty.length)]] = id;
        lightDex([id]);
        hideModal(); save(); render(); afterChoose();
      };
    });
    $('m-hide').onclick = function () {
      $('modal-layer').style.display = 'none';
      $('modal-dock').style.display = 'block';
    };
    $('m-skip').onclick = function () {
      E.choose(game, null); hideModal(); save(); render(); afterChoose();
    };
    var rr = $('m-reroll');
    if (rr) rr.onclick = function () {
      E.usePokeBall(game); save(); showOffer();
    };
  }

  function afterChoose() {
    if (game.phase === 'rentDue') showRent();
  }

  function showRent() {
    var rent = RENT[game.rentIndex];
    var canPay = game.coins >= rent.rent;
    var saved = game.items.indexOf('coffee') >= 0 && !game.coffeeUsed;
    var html = '<h2>火箭队来收保护费</h2><div class="lead">第 ' + (game.rentIndex + 1) + ' 次收租 · ' + rent.spins + ' 转一次</div>';
    html += '<div class="rent-num">' + rent.rent + ' 金</div>';
    html += '<div class="lead">你目前有 <b>' + game.coins + '</b> 金' + (canPay ? '，可以支付。' : '，不够支付。') + '</div>';
    if (!canPay && saved) html += '<div class="badge">提神咖啡可救场</div>';
    html += '<div class="modal-actions"><button class="btn btn-spin" id="m-pay">' + (canPay ? '支付房租' : (saved ? '用咖啡撑过去' : '认输')) + '</button></div>';
    showModal(html);
    $('m-pay').onclick = function () {
      var res = E.payRent(game);
      hideModal(); save(); render();
      if (!res.ok) {
        showEnd(false);
      } else if (res.win) {
        showEnd(true);
      } else if (res.saved) {
        // 咖啡救场，继续转
      } else if (game.phase === 'rentReward') {
        showItemReward();
      }
    };
  }

  function showItemReward() {
    var offers = (game.itemOffer || []).filter(function (id) { return !!ITEMS[id]; });
    if (offers.length === 0) { game.phase = 'spinning'; save(); render(); return; }
    var pct = E.rarityPercent(game, true);
    var html = '<h2>交租奖励 · 道具 3 选 1</h2><div class="lead">按与宝可梦相同的稀有度权重抽取，选一件永久物品加入本局；同类效果可叠加。</div>';
    html += '<div class="choices">';
    offers.forEach(function (id) {
      var it = ITEMS[id], rar = RARITY[it.rarity];
      html += '<div class="choice" data-item="' + id + '"><img src="' + icon(it.icon) + '" alt="' + it.name + '">'
        + '<span class="nm">' + it.name + '</span>'
        + '<span class="rar" style="color:' + rar.color + ';border-color:' + rar.color + '">' + rar.name + '</span>'
        + '<span class="ty">' + it.desc + '</span>'
        + '<span class="prob">' + rar.name + '档 ' + pct[it.rarity] + '%</span></div>';
    });
    html += '</div><div class="modal-actions"><button class="btn btn-ghost" id="m-skip-item">都不要</button></div>';
    showModal(html);
    Array.prototype.forEach.call(document.querySelectorAll('.choice[data-item]'), function (el) {
      el.onclick = function () {
        E.takeItem(game, el.dataset.item);
        hideModal(); save(); render();
      };
    });
    $('m-skip-item').onclick = function () {
      E.takeItem(game, null);
      hideModal(); save(); render();
    };
  }

  function dexFunctionText(id) {
    var mon = POKEMON[id], ty = TYPES[mon.type];
    var beats = ty.beats.map(function (k) { return TYPES[k].name; }).join('、');
    var s = '基础产出 ' + mon.base + ' 金；相邻有被自己克制（' + beats + '）的宝可梦时，每个独立结算一次 ×2，多次相加。';
    if (mon.evolveTo) s += ' 累计上屏 ' + E.evolveThresholdOf(game) + ' 次进化为' + POKEMON[mon.evolveTo].name + '，基础产出提升。';
    s += ' 稀有度 ' + RARITY[mon.rarity].name + '，决定三选一中的抽取权重。';
    return s;
  }

  function renderDexDetail(id) {
    var box = $('dex-detail');
    if (!box) return;
    if (!id || dex.indexOf(id) < 0) {
      box.innerHTML = '<p>尚未点亮：把这只宝可梦选入卡池即可解锁图鉴资料（跨局保留）。</p>';
      return;
    }
    var mon = POKEMON[id], ty = TYPES[mon.type], rar = RARITY[mon.rarity];
    var official = (window.PR.dex && window.PR.dex[id]) || '暂无官方图鉴说明。';
    box.innerHTML = '<img src="' + sprite(id) + '" alt="' + mon.name + '">'
      + '<div class="body"><h3>' + mon.name + ' <span class="rar" style="color:' + rar.color + ';border-color:' + rar.color + '">' + rar.name + '</span>'
      + '<span class="badge">' + ty.name + '属性</span></h3>'
      + '<p>图鉴说明：' + official + '</p>'
      + '<div class="fn">游戏内功能：' + dexFunctionText(id) + '</div></div>';
  }

  function showDex() {
    var ids = Object.keys(POKEMON).map(Number);
    var html = '<h2>宝可梦图鉴 <span class="badge">' + dex.length + '/' + ids.length + '</span></h2>'
      + '<div class="lead">首次选入卡池即点亮，跨局保留。官方图鉴说明取自 PokeAPI 简体中文版。</div><div class="dex-grid">';
    ids.forEach(function (id) {
      var on = dex.indexOf(id) >= 0, mon = POKEMON[id], rar = RARITY[mon.rarity];
      html += '<div class="dex-card' + (on ? '' : ' locked') + '" data-dex="' + id + '">'
        + '<img src="' + sprite(id) + '" alt="">'
        + '<span class="nm">' + (on ? mon.name : '???') + '</span>'
        + '<span class="rar" style="color:' + (on ? rar.color : '#999') + '">' + (on ? rar.name : '未点亮') + '</span></div>';
    });
    html += '</div><div class="dex-detail" id="dex-detail"></div>'
      + '<div class="modal-actions"><button class="btn" id="m-dex-close">关闭</button></div>';
    $('dex-modal').innerHTML = html;
    $('dex-layer').style.display = 'flex';
    Array.prototype.forEach.call(document.querySelectorAll('.dex-card'), function (el) {
      el.onclick = function () {
        dexSelected = parseInt(el.dataset.dex, 10);
        renderDexDetail(dexSelected);
      };
    });
    $('m-dex-close').onclick = function () { $('dex-layer').style.display = 'none'; };
    renderDexDetail(dexSelected !== null ? dexSelected : (dex[0] || null));
  }

  function showEnd(win) {
    var html = '<h2>' + (win ? '通关！' : '被赶出公寓') + '</h2>';
    html += '<div class="lead">' + (win ? D.CONFIG.rentCount + ' 次房租全部缴清，火箭队暂时放过了你。' : '金币不够交租，你被赶了出去。') + '</div>';
    html += '<div class="rent-num">' + game.rentIndex + '/' + D.CONFIG.rentCount + '</div>';
    html += '<div class="lead">总转动 ' + game.totalSpins + ' 次 · 剩余 ' + game.coins + ' 金</div>';
    html += '<div class="modal-actions"><button class="btn btn-spin" id="m-again">再来一局</button></div>';
    showModal(html);
    $('m-again').onclick = function () { restart(); };
  }

  function restart() {
    abortAnim(); // 演出中改存档必须先中止，否则旧回调会继续改状态
    game = E.createGame();
    lightDex(game.pool); // 图鉴跨局保留，不随重开清零
    $('modal-layer').style.display = 'none';
    $('modal-dock').style.display = 'none';
    save(); render();
  }

  function clearAnimDom() {
    Array.prototype.forEach.call(document.querySelectorAll('.float-gain,.coin-fly'), function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#reel .cell img'), function (el) {
      el.classList.remove('bounce');
    });
    Array.prototype.forEach.call($('reel').children, function (el) {
      el.classList.remove('rolling', 'question', 'settling');
      el.style.animationDelay = '';
    });
  }

  // 中止演出：清计时器并让所有在途回调失效。跳过 / 重开都必须先走这里
  function abortAnim() {
    anim.active = false;
    anim.token++;
    if (anim.timer) { clearTimeout(anim.timer); anim.timer = null; }
    clearAnimDom();
    $('btn-skip').style.display = 'none';
  }

  function later(token, fn, ms) {
    anim.timer = setTimeout(function () {
      if (!anim.active || token !== anim.token) return;
      fn();
    }, ms);
  }

  function flyCoin(cell) {
    var from = cell.getBoundingClientRect();
    var to = $('hud-coins').getBoundingClientRect();
    var el = document.createElement('div');
    el.className = 'coin-fly';
    el.style.left = (from.left + from.width / 2) + 'px';
    el.style.top = (from.top + from.height / 2) + 'px';
    el.style.setProperty('--dx', (to.left + to.width / 2 - from.left - from.width / 2) + 'px');
    el.style.setProperty('--dy', (to.top + to.height / 2 - from.top - from.height / 2) + 'px');
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 700);
  }

  function tickCoins(value) {
    var box = $('hud-coins').parentNode;
    $('hud-coins').textContent = value;
    box.classList.remove('tick');
    void box.offsetWidth;
    box.classList.add('tick');
  }

  function finishAnim(token) {
    if (!anim.active || token !== anim.token) return;
    anim.active = false;
    anim.timer = null;
    clearAnimDom();
    $('btn-skip').style.display = 'none';
    render();
    showOffer();
  }

  function skipAnim() {
    if (!anim.active) return;
    abortAnim();
    render();
    showOffer();
  }

  // 阶段 A：所有格子同时变问号，格子边框和页面完全不动
  function showQuestion(cell) {
    cell.className = 'cell question';
    cell.textContent = '?';
  }

  function playSpin(token, res) {
    var cells = $('reel').children;
    Array.prototype.forEach.call(cells, showQuestion);
    later(token, function () {
      Array.prototype.forEach.call(cells, function (cell) {
        cell.classList.remove('question');
      });
      paintCells(res.grid); // 20 格同时亮出结果
      $('machine-status').textContent = '结果已出，准备结算…';
      // 结果先停 1 秒，让玩家看清排布与克制关系，再开始逐格结算
      later(token, function () {
        $('machine-status').textContent = '逐格结算中…';
        // 阶段 B：行优先逐格结算，金币数字跟着涨
        // 空格立即跳过不浪费演出时间；有收益格按总时长均分，单格 150~600ms
        var gainCount = res.info.filter(function (x) { return x.gain > 0; }).length;
        var step = Math.max(ANIM.settleMin, Math.min(ANIM.settleMax,
          Math.round(ANIM.settleTotal / Math.max(1, gainCount))));
        var idx = 0, shown = res.startCoins;
        function settleOne() {
          if (idx >= res.info.length) {
            later(token, function () {
              $('gain-line').innerHTML = '上转收益 <span class="big">+' + res.gain + '</span> 金';
              finishAnim(token);
            }, ANIM.tailDuration);
            return;
          }
          var i = idx++, info = res.info[i], cell = cells[i], float = null;
          if (info.gain > 0 && cell) {
            cell.classList.add('settling');
            // 贡献金币的宝可梦本体跳一下
            var spriteImg = cell.querySelector('img');
            if (spriteImg) {
              spriteImg.classList.remove('bounce');
              void spriteImg.offsetWidth;
              spriteImg.classList.add('bounce');
            }
            float = document.createElement('div');
            float.className = 'float-gain';
            float.innerHTML = '+' + info.gain + (info.count > 0
              ? '<small>克' + info.types.join('/') + ' ×' + info.count + '</small>' : '');
            cell.appendChild(float);
            flyCoin(cell);
            shown += info.gain;
            tickCoins(shown);
          }
          if (info.gain === 0) {
            settleOne(); // 空格不占演出时间
            return;
          }
          later(token, function () {
            if (cell) cell.classList.remove('settling');
            if (float && float.parentNode) float.parentNode.removeChild(float);
            settleOne();
          }, step);
        }
        settleOne();
      }, ANIM.revealHold);
    }, ANIM.questionDuration);
  }

  function onSpin() {
    var res = E.spin(game);
    if (!res.ok) return;
    save(); // 逻辑已落账：中途刷新按 choosing 恢复，不会重复扣钱
    abortAnim();
    anim.active = true;
    var token = anim.token;
    $('btn-spin').disabled = true;
    $('btn-skip').style.display = 'inline-block';
    $('machine-status').textContent = '转动结算中…';
    $('gain-line').textContent = '转动中…';
    playSpin(token, res);
  }

  function bind() {
    $('btn-spin').onclick = onSpin;
    $('btn-skip').onclick = skipAnim;
    $('btn-dex').onclick = showDex;
    $('modal-dock').onclick = function () { showOffer(); };
    $('btn-restart').onclick = function () {
      if (confirm('确定重开？当前进度会丢失。')) restart();
    };
  }

  function init() {
    game = load() || E.createGame();
    dex = loadDex();
    lightDex(game.pool); // 开局自带的 6 只按「进入卡池」规则点亮
    bind();
    render();
    if (game.phase === 'rentDue') showRent();
    else if (game.phase === 'choosing') showOffer();
    else if (game.phase === 'rentReward') showItemReward();
    else if (game.phase === 'win' || game.phase === 'gameover') showEnd(game.phase === 'win');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
