/* poke-rent UI 层：渲染、交互、localStorage 存档 */
(function () {
  'use strict';
  var D = window.PR.data, E = window.PR.engine,
      POKEMON = D.POKEMON, TYPES = D.TYPES, ITEMS = D.ITEMS, TOKENS = D.TOKENS, RENT = D.RENT;

  var SAVE_KEY = 'poke-rent-save';
  var CACHE_V = D.CONFIG.cacheVersion;
  var game = null;

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
      items: game.items, tokens: game.tokens, rentIndex: game.rentIndex,
      spinsLeft: game.spinsLeft, totalSpins: game.totalSpins,
      coffeeUsed: game.coffeeUsed, phase: game.phase,
      lastGrid: game.lastGrid, lastGain: game.lastGain, log: game.log.slice(-50)
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(raw)); } catch (e) {}
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
    var statusMap = {
      spinning: '按转动开始', choosing: '请选择符号', rentDue: '该交租了',
      rentReward: '选择物品', gameover: '已被赶出', win: '通关！'
    };
    $('machine-status').textContent = statusMap[game.phase] || game.phase;
    $('btn-spin').disabled = game.phase !== 'spinning' || game.coins < D.CONFIG.spinCost;
  }

  function renderReel() {
    var reel = $('reel');
    var grid = game.lastGrid;
    reel.innerHTML = '';
    for (var i = 0; i < D.CONFIG.cellCount; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      if (grid && grid[i]) {
        var mon = POKEMON[grid[i]], ty = TYPES[mon.type];
        var img = document.createElement('img');
        img.src = sprite(mon.id); img.alt = mon.name;
        cell.appendChild(img);
        var nm = document.createElement('span');
        nm.className = 'nm'; nm.textContent = mon.name;
        cell.appendChild(nm);
        var tag = document.createElement('span');
        tag.className = 'ty'; tag.textContent = ty.name;
        tag.style.background = ty.color;
        cell.appendChild(tag);
      } else {
        cell.classList.add('empty');
        cell.textContent = '·';
      }
      reel.appendChild(cell);
    }
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

  function render() {
    renderHUD(); renderReel(); renderPool(); renderItems(); renderLog();
  }

  function showModal(html) {
    $('modal').innerHTML = html;
    $('modal-layer').style.display = 'flex';
  }
  function hideModal() { $('modal-layer').style.display = 'none'; }

  function showOffer() {
    var html = '<h2>选择一只宝可梦</h2><div class="lead">选中的宝可梦会加入卡池；也可以跳过保持卡池干净。</div><div class="choices">';
    game.offer.forEach(function (id) {
      var mon = POKEMON[id], ty = TYPES[mon.type];
      html += '<div class="choice" data-id="' + id + '"><img src="' + sprite(id) + '" alt="' + mon.name + '"><span class="nm">' + mon.name + '</span><span class="ty">' + ty.name + ' · 基础' + mon.base + '</span></div>';
    });
    html += '</div><div class="modal-actions">';
    if ((game.tokens.pokeBall || 0) > 0) html += '<button class="btn" id="m-reroll">精灵球 ×' + game.tokens.pokeBall + ' 刷新</button>';
    html += '<button class="btn btn-ghost" id="m-skip">跳过</button></div>';
    showModal(html);
    Array.prototype.forEach.call(document.querySelectorAll('.choice'), function (el) {
      el.onclick = function () {
        E.choose(game, parseInt(el.dataset.id, 10));
        hideModal(); save(); render(); afterChoose();
      };
    });
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
    if (!game.itemOffer) { game.phase = 'spinning'; save(); render(); return; }
    var it = ITEMS[game.itemOffer];
    var html = '<h2>交租奖励</h2><div class="lead">选择一件永久物品加入本局。</div>';
    html += '<div class="choices" style="grid-template-columns:1fr"><div class="choice"><img src="' + icon(it.icon) + '" alt="' + it.name + '"><span class="nm">' + it.name + '</span><span class="ty">' + it.desc + '</span></div></div>';
    html += '<div class="modal-actions"><button class="btn btn-ghost" id="m-skip-item">不要</button><button class="btn btn-spin" id="m-take">收下</button></div>';
    showModal(html);
    $('m-take').onclick = function () {
      E.takeItem(game, game.itemOffer);
      hideModal(); save(); render();
    };
    $('m-skip-item').onclick = function () {
      E.takeItem(game, null);
      hideModal(); save(); render();
    };
  }

  function showEnd(win) {
    var html = '<h2>' + (win ? '通关！' : '被赶出公寓') + '</h2>';
    html += '<div class="lead">' + (win ? '12 次房租全部缴清，火箭队暂时放过了你。' : '金币不够交租，你被赶了出去。') + '</div>';
    html += '<div class="rent-num">' + game.rentIndex + '/12</div>';
    html += '<div class="lead">总转动 ' + game.totalSpins + ' 次 · 剩余 ' + game.coins + ' 金</div>';
    html += '<div class="modal-actions"><button class="btn btn-spin" id="m-again">再来一局</button></div>';
    showModal(html);
    $('m-again').onclick = function () { restart(); };
  }

  function restart() {
    game = E.createGame();
    $('modal-layer').style.display = 'none';
    save(); render();
  }

  function onSpin() {
    var res = E.spin(game);
    if (!res.ok) return;
    save(); render();
    // 逐格动画
    var cells = $('reel').children;
    for (var i = 0; i < cells.length; i++) {
      (function (el) {
        el.classList.add('spinning');
        setTimeout(function () { el.classList.remove('spinning'); }, 180);
      })(cells[i]);
    }
    setTimeout(showOffer, 220);
  }

  function bind() {
    $('btn-spin').onclick = onSpin;
    $('btn-restart').onclick = function () {
      if (confirm('确定重开？当前进度会丢失。')) restart();
    };
    // 消耗品：点击卡池 chip 可用中心券移除（示例交互，正式版可在 modal 中提供）
  }

  function init() {
    game = load() || E.createGame();
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
