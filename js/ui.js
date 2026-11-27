/* poke-rent UI 层：渲染、交互、localStorage 存档 */
(function () {
  'use strict';
  var D = window.PR.data, E = window.PR.engine,
      POKEMON = D.POKEMON, TYPES = D.TYPES, RARITY = D.RARITY,
      ITEMS = D.ITEMS, TOKENS = D.TOKENS, RENT = D.RENT,
      ANIM = D.ANIM;

  var SAVE_KEY = 'poke-rent-save';
  var DEX_KEY = 'poke-rent-dex';   // 图鉴跨局保留，与单局存档分离
  var TUTOR_KEY = 'poke-rent-tutorial'; // 新手引导完成标记，跨局保留
  var SPEED_KEY = 'poke-rent-speed'; // 播放速度偏好，跨局保留，不属于单局存档
  var CACHE_V = D.CONFIG.cacheVersion;
  var game = null, dex = [], dexSelected = null;
  // 播放速度：1 = 正常，2/3 = 倍速，0 = 默认跳过（不播转动动画，直接出结果）
  var speed = loadSpeed();

  function loadSpeed() {
    try {
      var s = parseInt(localStorage.getItem(SPEED_KEY), 10);
      if (s === 0 || s === 1 || s === 2 || s === 3) return s;
    } catch (e) {}
    return 1;
  }

  function saveSpeed() {
    try { localStorage.setItem(SPEED_KEY, String(speed)); } catch (e) {}
  }

  // 按当前倍速缩放演出时长；跳过模式下为 0
  function animMs(ms) { return speed === 0 ? 0 : Math.max(1, Math.round(ms / speed)); }
  // 演出状态：token 递增使旧演出失效，避免「跳过 / 重开」后旧回调继续跑
  // timers 支持并行计时（逐格结算 + 进化特效），abortAnim 时统一清空
  var anim = { active: false, token: 0, timers: [] };
  // 管理员调试：连点进度 5 次输入密码后开启 5×4 单格结算测试
  var DEBUG_PASSWORD = '1997121', debugClicks = 0, debugClickAt = 0;
  var debugGrid = new Array(D.CONFIG.cellCount).fill(null), debugPick = null, debugCenter = 7;

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
      contrib: game.contrib || {}, lastContrib: game.lastContrib || {},
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

  // 首次进入卡池即点亮：开局自带的御三家也算，跨局保留
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
    if (!g.lastContrib || typeof g.lastContrib !== 'object') g.lastContrib = {};
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
    // 显示当前所在轮次：刚进 1/7，交租一次 2/7，通关封顶 7/7
    var progress = Math.min(game.rentIndex + 1, D.CONFIG.rentCount);
    $('hud-progress').textContent = progress + '/' + D.CONFIG.rentCount;
    $('dex-count').textContent = dex.length + '/' + Object.keys(POKEMON).length;
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
        // 点击转盘上的宝可梦进图鉴详情（能力提示）
        cell.classList.add('clickable');
        cell.title = '点击查看图鉴与能力';
        cell.onclick = function (species) {
          return function () { if (!anim.active) showDex(species); };
        }(mon.id);
        // 达成进化条件时在右下角挂可进化标识，点击确认才真正进化
        if (E.canEvolve(game, mon.id)) {
          var evo = document.createElement('button');
          evo.type = 'button';
          evo.className = 'cell-evo';
          evo.textContent = '可进化';
          evo.title = abilityCompareText(mon.id);
          evo.onclick = function (species) {
            return function (e) {
              e.stopPropagation();
              if (!anim.active) showEvolveConfirm(species);
            };
          }(mon.id);
          cell.appendChild(evo);
        }
      } else {
        cell.classList.add('empty');
        cell.textContent = '·';
        cell.onclick = null;
        cell.classList.remove('clickable');
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
      var speciesId = parseInt(id, 10);
      var chip = document.createElement('div');
      chip.className = 'pool-chip clickable';
      chip.title = '点击查看图鉴与能力';
      // 主体点击进图鉴
      chip.onclick = function (species) {
        return function () { showDex(species); };
      }(speciesId);
      var img = document.createElement('img');
      img.src = sprite(id); img.alt = mon.name;
      chip.appendChild(img);
      var label = document.createElement('span');
      label.textContent = mon.name;
      chip.appendChild(label);
      // 卡池 chip 显示属性，和转盘的克制关系对照更直观
      var tyTag = document.createElement('span');
      tyTag.className = 'pool-type';
      tyTag.style.background = TYPES[mon.type].color;
      tyTag.textContent = TYPES[mon.type].name;
      chip.appendChild(tyTag);
      // 每种显示张数 ×N
      var num = document.createElement('span');
      num.className = 'pool-num';
      num.textContent = '×' + counts[id];
      chip.appendChild(num);
      var rar = document.createElement('span');
      rar.className = 'pool-rar';
      rar.style.color = RARITY[mon.rarity].color;
      rar.textContent = RARITY[mon.rarity].name.charAt(0);
      chip.appendChild(rar);
      if (game.evolveCount[id]) {
        var evo = document.createElement('span');
        evo.className = 'evo';
        evo.textContent = game.evolveCount[id] + '/' + E.evolveThresholdOf(game);
        chip.appendChild(evo);
      }
      // 卡池里也提供进化入口，避免转盘没刷出该宝可梦时无法确认进化
      if (E.canEvolve(game, speciesId)) {
        var evoBtn = document.createElement('button');
        evoBtn.className = 'pool-evo';
        evoBtn.type = 'button';
        evoBtn.textContent = '↑';
        evoBtn.title = abilityCompareText(speciesId);
        evoBtn.onclick = function (species) {
          return function (ev) { ev.stopPropagation(); showEvolveConfirm(species); };
        }(speciesId);
        chip.appendChild(evoBtn);
      }
      // 有中心券时用独立 × 按钮移除该符号（不与进图鉴的点击冲突）
      if ((game.tokens.centerPass || 0) > 0) {
        var rm = document.createElement('button');
        rm.className = 'pool-remove';
        rm.type = 'button';
        rm.textContent = '×';
        rm.title = '用精灵中心券移除 1 张 ' + mon.name;
        rm.onclick = function (species) {
          return function (ev) {
            ev.stopPropagation();
            if (!confirm('用精灵中心券移除 1 张 ' + POKEMON[species].name + '？')) return;
            var res = E.useCenterPass(game, species);
            if (res.ok) { save(); render(); }
            else alert('无法移除：' + res.reason);
          };
        }(speciesId);
        chip.appendChild(rm);
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

  // 贡献金币排名：同时记录本局累计与上一转贡献；__other 为物品等额外来源
  function renderRank() {
    var c = game.contrib || {}, last = game.lastContrib || {};
    var keys = [];
    Object.keys(c).concat(Object.keys(last)).forEach(function (k) {
      if (keys.indexOf(k) < 0) keys.push(k);
    });
    var rows = keys.filter(function (k) {
      return (c[k] > 0 || last[k] > 0) && (k === '__other' || POKEMON[k]);
    }).map(function (k) {
      return { key: k, val: c[k] || 0, lastVal: last[k] || 0 };
    }).sort(function (a, b) { return b.val - a.val || b.lastVal - a.lastVal; });
    var total = rows.reduce(function (s, r) { return s + r.val; }, 0);
    var lastTotal = rows.reduce(function (s, r) { return s + r.lastVal; }, 0);
    $('rank-total').textContent = total;
    var box = $('rank');
    box.innerHTML = '';
    if (rows.length === 0) {
      box.innerHTML = '<div class="empty">还没有收益</div>';
      return;
    }
    var head = document.createElement('div');
    head.className = 'rank-head';
    head.innerHTML = '<span>本局累计 <b>' + total + '</b></span><span>上一转 <b>' + lastTotal + '</b></span>';
    box.appendChild(head);
    var top = Math.max(1, rows[0].val);
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
      var nums = document.createElement('span');
      nums.className = 'rank-nums';
      var cur = document.createElement('span');
      cur.className = 'rank-cur'; cur.textContent = '+' + r.val;
      var lastEl = document.createElement('span');
      lastEl.className = 'rank-last'; lastEl.textContent = '上转 +' + r.lastVal;
      nums.appendChild(cur); nums.appendChild(lastEl);
      row.appendChild(idx); row.appendChild(img); row.appendChild(name);
      row.appendChild(barWrap); row.appendChild(nums);
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
    $('modal').classList.remove('collapsing');
  }
  function hideModal() {
    $('modal-layer').style.display = 'none';
    $('modal-dock').style.display = 'none';
  }

  // 收起动画：弹窗从当前位置缩放飞向右下角悬浮按钮，让用户看清收到哪里
  function collapseToDock() {
    var modal = $('modal'), dock = $('modal-dock'), layer = $('modal-layer');
    var a = modal.getBoundingClientRect();
    // 先把 dock 放到目标位置（隐藏但可测量）
    dock.style.display = 'block';
    dock.style.visibility = 'hidden';
    var b = dock.getBoundingClientRect();
    dock.style.display = 'none';
    dock.style.visibility = 'visible';
    var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    var scale = Math.max(0.08, Math.min(b.width / a.width, b.height / a.height));
    modal.style.transformOrigin = 'center center';
    modal.style.transition = 'transform .32s cubic-bezier(.4,0,.7,.2),opacity .32s ease';
    // 强制回流后启动过渡
    void modal.offsetWidth;
    modal.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
    modal.style.opacity = '0';
    layer.classList.add('fading');
    var done = function () {
      layer.style.display = 'none';
      modal.style.transition = '';
      modal.style.transform = '';
      modal.style.opacity = '';
      layer.classList.remove('fading');
      dock.style.display = 'block';
      dock.classList.remove('dock-pop');
      void dock.offsetWidth;
      dock.classList.add('dock-pop');
    };
    setTimeout(done, 340);
  }

  // 展开动画：从悬浮按钮位置飞回中央
  function expandFromDock() {
    var modal = $('modal'), dock = $('modal-dock'), layer = $('modal-layer');
    var b = dock.getBoundingClientRect();
    showOffer();
    var a = modal.getBoundingClientRect();
    var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    var scale = Math.max(0.08, Math.min(b.width / a.width, b.height / a.height));
    modal.style.transformOrigin = 'center center';
    modal.style.transition = 'none';
    modal.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
    modal.style.opacity = '0';
    void modal.offsetWidth;
    modal.style.transition = 'transform .34s cubic-bezier(.2,.8,.3,1),opacity .3s ease';
    modal.style.transform = 'translate(0,0) scale(1)';
    modal.style.opacity = '1';
    setTimeout(function () {
      modal.style.transition = '';
      modal.style.transform = '';
      modal.style.opacity = '';
    }, 360);
  }

  // 档位概率统一放在弹窗顶部，单个卡片只标稀有度
  function probBar(pct) {
    return '<div class="prob-bar">档位概率：'
      + '<span style="color:' + RARITY.common.color + '">普通 ' + pct.common + '%</span> · '
      + '<span style="color:' + RARITY.uncommon.color + '">非凡 ' + pct.uncommon + '%</span> · '
      + '<span style="color:' + RARITY.rare.color + '">稀有 ' + pct.rare + '%</span></div>';
  }

  var offerShowEvo = false;

  // 能力文案：名称 + 说明，供格子悬停、三选一、图鉴共用
  function abilityText(id) {
    var mon = POKEMON[id], ab = mon && mon.ability;
    return ab ? ab.name + '：' + ab.text : '暂无特殊能力';
  }

  function abilityCompareText(id) {
    var mon = POKEMON[id], to = mon && mon.evolveTo;
    if (!to) return '无进化形态';
    return '当前 ' + mon.name + '：' + abilityText(id) + '\n进化后 ' + POKEMON[to].name + '：' + abilityText(to);
  }

  function evoPreviewHtml(id) {
    var mon = POKEMON[id], to = mon.evolveTo;
    if (!to) return '<span class="evo-preview">无进化形态</span>';
    var t = POKEMON[to];
    return '<span class="evo-preview">进化后：' + t.name + ' · 基础 ' + t.base + '<br>' + abilityText(to) + '</span>';
  }

  function evoCardHtml(id, label) {
    var mon = POKEMON[id], ty = TYPES[mon.type];
    return '<div class="evo-card"><div class="evo-label">' + label + '</div>'
      + '<img src="' + sprite(id) + '" alt="' + mon.name + '">'
      + '<div class="nm">' + mon.name + '</div>'
      + '<div class="meta">' + ty.name + ' · 基础 ' + mon.base + ' 金</div>'
      + '<div class="ability">' + abilityText(id) + '</div></div>';
  }

  // 进化确认：先展示当前与进化后的能力对比，确认后才替换卡池
  function showEvolveConfirm(id) {
    var mon = POKEMON[id], to = mon && mon.evolveTo;
    if (!to || !E.canEvolve(game, id)) return;
    var html = '<h2>确认进化</h2><div class="lead">进化后卡池里的 ' + mon.name + ' 会全部变为 ' + POKEMON[to].name + '，能力同步替换。</div>'
      + '<div class="evo-compare">' + evoCardHtml(id, '当前') + '<div class="evo-arrow">→</div>'
      + evoCardHtml(to, '进化后') + '</div>'
      + '<div class="modal-actions"><button class="btn btn-ghost" id="m-evo-cancel">再想想</button>'
      + '<button class="btn btn-spin" id="m-evo-ok">确认进化</button></div>';
    showModal(html);
    $('m-evo-cancel').onclick = hideModal;
    $('m-evo-ok').onclick = function () {
      var r = E.evolve(game, id);
      if (!r.ok) { alert('无法进化：' + r.reason); return; }
      hideModal(); save(); render();
    };
  }

  function showOffer() {
    var pct = E.rarityPercent(game);
    var html = '<h2>选择一只宝可梦</h2><div class="lead">选中的宝可梦会加入卡池；也可以跳过保持卡池干净。可点「收起」对照上轮结果再决定。</div>'
      + probBar(pct)
      + (game.postRentOffer ? '<div class="badge">交租后：本次稀有度至少非凡</div>' : '')
      + '<label class="evo-toggle"><input type="checkbox" id="m-show-evo"' + (offerShowEvo ? ' checked' : '') + '> 查看进化</label>'
      + '<div class="choices">';
    game.offer.forEach(function (id) {
      var mon = POKEMON[id], ty = TYPES[mon.type], rar = RARITY[mon.rarity];
      html += '<div class="choice" data-id="' + id + '"><img src="' + sprite(id) + '" alt="' + mon.name + '"><span class="nm">' + mon.name + '</span>'
        + '<span class="rar" style="color:' + rar.color + ';border-color:' + rar.color + '">' + rar.name + '</span>'
        + '<span class="ty-line"><span class="type-pill" style="background:' + ty.color + '">' + ty.name + '</span>'
        + '<span class="base-tag">基础 ' + mon.base + '</span></span>'
        + '<span class="ability-line">' + abilityText(id) + '</span>'
        + (offerShowEvo ? evoPreviewHtml(id) : '') + '</div>';
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
    $('m-hide').onclick = collapseToDock;
    $('m-skip').onclick = function () {
      E.choose(game, null); hideModal(); save(); render(); afterChoose();
    };
    var te = $('m-show-evo');
    if (te) te.onchange = function () { offerShowEvo = te.checked; showOffer(); };
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
    if (offers.length === 0) { E.takeItem(game, null); save(); render(); showOffer(); return; }
    var pct = E.rarityPercent(game, true);
    var html = '<h2>交租奖励 · 道具 3 选 1</h2><div class="lead">按与宝可梦相同的稀有度权重抽取，选一件永久物品加入本局；同类效果可叠加。</div>';
    html += probBar(pct);
    html += '<div class="choices">';
    offers.forEach(function (id) {
      var it = ITEMS[id], rar = RARITY[it.rarity];
      html += '<div class="choice" data-item="' + id + '"><img src="' + icon(it.icon) + '" alt="' + it.name + '">'
        + '<span class="nm">' + it.name + '</span>'
        + '<span class="rar" style="color:' + rar.color + ';border-color:' + rar.color + '">' + rar.name + '</span>'
        + '<span class="ty">' + it.desc + '</span></div>';
    });
    html += '</div><div class="modal-actions"><button class="btn btn-ghost" id="m-skip-item">都不要</button></div>';
    showModal(html);
    Array.prototype.forEach.call(document.querySelectorAll('.choice[data-item]'), function (el) {
      el.onclick = function () {
        E.takeItem(game, el.dataset.item);
        hideModal(); save(); render(); showOffer();
      };
    });
    $('m-skip-item').onclick = function () {
      E.takeItem(game, null);
      hideModal(); save(); render(); showOffer();
    };
  }

  // 图鉴只写官方说明 + 基础信息；属性克制奖励规则移到「规则」页与新手引导
  function dexFunctionText(id) {
    var mon = POKEMON[id], ty = TYPES[mon.type];
    var s = '属性 ' + ty.name + ' · 基础收益 ' + mon.base + ' 金';
    if (mon.evolveTo) s += ' · 累计上屏 ' + E.evolveThresholdOf(game) + ' 次后可确认进化为 ' + POKEMON[mon.evolveTo].name + '（基础 3 金）';
    else s += ' · 无进化形态';
    s += ' · 稀有度 ' + RARITY[mon.rarity].name;
    return s;
  }

  function preEvolutionOf(id) {
    var keys = Object.keys(POKEMON);
    for (var i = 0; i < keys.length; i++) {
      var mon = POKEMON[keys[i]];
      if (mon.evolveTo === id) return mon.id;
    }
    return null;
  }

  function dexEvoNode(id) {
    if (id === null || id === undefined) return '';
    if (dex.indexOf(id) < 0) return '<span class="muted">???</span>';
    if (id === dexSelected) return '<span class="cur">' + POKEMON[id].name + '</span>';
    return '<button type="button" class="dex-evo-btn" data-evo="' + id + '">' + POKEMON[id].name + '</button>';
  }

  function dexEvoChainHtml(id) {
    var pre = preEvolutionOf(id), next = POKEMON[id].evolveTo;
    var parts = [];
    if (pre) parts.push(dexEvoNode(pre));
    parts.push(dexEvoNode(id));
    if (next) parts.push(dexEvoNode(next));
    return '进化链：' + parts.join(' <span class="arrow">→</span> ')
      + ((!pre && !next) ? ' <span class="muted">（无进化形态）</span>' : '');
  }

  function renderDexDetail(id) {
    var box = $('dex-detail');
    if (!box) return;
    if (!id || dex.indexOf(id) < 0) {
      box.innerHTML = '<p>尚未点亮：把这只宝可梦选入卡池即可解锁图鉴资料（跨局保留）。</p>';
      return;
    }
    dexSelected = id;
    var mon = POKEMON[id], ty = TYPES[mon.type], rar = RARITY[mon.rarity];
    var official = (window.PR.dex && window.PR.dex[id]) || '暂无官方图鉴说明。';
    box.innerHTML = '<img src="' + sprite(id) + '" alt="' + mon.name + '">'
      + '<div class="body"><h3>' + mon.name + ' <span class="rar" style="color:' + rar.color + ';border-color:' + rar.color + '">' + rar.name + '</span>'
      + '<span class="badge">' + ty.name + '属性</span></h3>'
      + '<p>图鉴说明：' + official + '</p>'
      + '<div class="fn">基础信息：' + dexFunctionText(id) + '</div>'
      + '<div class="fn" style="margin-top:6px">特殊能力：' + abilityText(id) + '</div>'
      + '<div class="dex-evo">' + dexEvoChainHtml(id) + '</div></div>';
    Array.prototype.forEach.call(box.querySelectorAll('.dex-evo-btn'), function (btn) {
      btn.onclick = function () {
        dexSelected = parseInt(btn.dataset.evo, 10);
        renderDexDetail(dexSelected);
      };
    });
  }

  function showDex(focusId) {
    var ids = Object.keys(POKEMON).map(Number);
    if (focusId && POKEMON[focusId]) dexSelected = focusId;
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

  // 规则弹窗：属性克制奖励等全局规则集中在这里
  function showRules() {
    var html = '<h2>游戏规则</h2><div class="lead">塔塔开收租指南 · 点开即看，随时可查。</div>';
    html += '<div class="rules-list">';
    D.RULES.forEach(function (r, i) {
      html += '<div class="rule"><h3>' + (i + 1) + '. ' + r.title + '</h3><p>' + r.body + '</p></div>';
    });
    // 属性克制表
    html += '<div class="rule"><h3>' + (D.RULES.length + 1) + '. 属性克制表</h3>'
      + '<div class="type-table">';
    Object.keys(TYPES).forEach(function (k) {
      var t = TYPES[k];
      html += '<div class="type-row"><span class="type-name" style="background:' + t.color + '">' + t.name + '</span>'
        + '<span class="type-beats">克制 ' + t.beats.map(function (b) { return TYPES[b].name; }).join('、') + '</span></div>';
    });
    html += '</div><p class="rule-note">相邻 = 上下左右 + 四斜角（8 邻域），不含首尾环绕；结算顺序为行优先。</p></div>';
    html += '</div><div class="modal-actions"><button class="btn" id="m-rules-close">关闭</button>'
      + '<button class="btn btn-ghost" id="m-rules-tutorial">重看新手引导</button></div>';
    $('rules-modal').innerHTML = html;
    $('rules-layer').style.display = 'flex';
    $('m-rules-close').onclick = function () { $('rules-layer').style.display = 'none'; };
    $('m-rules-tutorial').onclick = function () {
      $('rules-layer').style.display = 'none';
      startTutorial(true);
    };
  }

  // 开场：故事背景 + 本局/本轮目标，只在首次进入（或清档后）出现
  function showIntro() {
    var rent = D.RENT[game.rentIndex] || D.RENT[0];
    var html = '<span class="story-mark">火箭队收租行动</span><h2>精灵球机与七轮房租</h2>'
      + '<div class="story-text">你欠了火箭队一屁股债，只能搬进这栋没人敢住的公寓，靠一台旧精灵球机赚钱还租。'
      + '连续交清 7 轮房租，公寓归你；交不上，连人带机器一起扔出去。'
      + '机器吐出的宝可梦会按属性互相克制——压得越狠，你抽成越多。</div>'
      + '<div class="story-goal"><h3>本局目标 · 第 ' + (game.rentIndex + 1) + ' 轮</h3>'
      + '<p>每轮 ' + rent.spins + ' 转，本轮需凑够 <b>' + rent.rent + ' 金</b>。'
      + '撑过第 7 轮就算通关；交不上房租，火箭队当场收房。</p></div>'
      + '<div class="modal-actions"><button class="btn btn-spin" id="m-story-start">开始游戏</button></div>';
    $('story-modal').innerHTML = html;
    $('story-layer').style.display = 'flex';
    $('m-story-start').onclick = function () {
      $('story-layer').style.display = 'none';
    };
  }

  // 新手引导：分步高亮，说明规则并引导发现转动 / 交租等核心功能
  var tutorialSteps = [
    { sel: '#btn-spin', text: '① 先转动。每转花 1 金币，精灵球机会生成 20 格结果。点击「转动」开始。' },
    { sel: '#reel', text: '② 格子产出看属性克制：每个被自己克制的邻居，额外结算一次「基础值 ×2」，可叠加。完整规则点右上角「规则」查看。' },
    { sel: '#pool', text: '③ 转完从三选一挑选宝可梦加入卡池。卡池里每种符号每转各上屏一次；点卡池里的宝可梦可看图鉴，点 × 用券删牌。' },
    { sel: '#hud-rent', text: '④ 每轮 5 转后火箭队来收租，交满 7 轮即通关。进度从 1/7 开始。' },
    { sel: '#btn-dex', text: '⑤ 图鉴记录官方说明与宝可梦能力，跨局保留；规则页随时可查。现在开始你的收租之旅吧！' }
  ];
  var tutorialStep = 0, tutorialForced = false, tutorialRaf = null;

  function tutorialDone() {
    var wasFirstTime = !tutorialForced; // 规则页「重看引导」不弹故事
    try { localStorage.setItem(TUTOR_KEY, '1'); } catch (e) {}
    $('tutorial-layer').style.display = 'none';
    if (tutorialRaf) { cancelAnimationFrame(tutorialRaf); tutorialRaf = null; }
    tutorialForced = false;
    // 首次进入：先走完引导，再弹开场故事；之后每次开局只弹故事
    if (wasFirstTime) showIntro();
  }

  // 高亮框跟随目标元素：页面滚动、窗口缩放、游戏重绘导致布局变化时实时更新
  function positionTutorial() {
    if ($('tutorial-layer').style.display !== 'block' || tutorialStep >= tutorialSteps.length) return;
    var target = document.querySelector(tutorialSteps[tutorialStep].sel);
    if (!target) return;
    var r = target.getBoundingClientRect();
    var pad = 8;
    var hole = $('tutorial-hole');
    hole.style.left = (r.left - pad) + 'px';
    hole.style.top = (r.top - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px';
    hole.style.height = (r.height + pad * 2) + 'px';
    // 提示框放在高亮框下方，靠近屏幕底部时改放上方
    var tip = $('tutorial-tip');
    var top = r.bottom + pad + 12;
    if (top + 150 > window.innerHeight) top = Math.max(12, r.top - 150);
    tip.style.top = top + 'px';
    tip.style.left = Math.max(12, Math.min(r.left, window.innerWidth - 360)) + 'px';
  }

  function trackTutorial() {
    if ($('tutorial-layer').style.display !== 'block') { tutorialRaf = null; return; }
    positionTutorial();
    tutorialRaf = requestAnimationFrame(trackTutorial);
  }

  function renderTutorialStep() {
    if (tutorialStep >= tutorialSteps.length) { tutorialDone(); return; }
    var step = tutorialSteps[tutorialStep];
    var target = document.querySelector(step.sel);
    if (!target) { tutorialStep++; renderTutorialStep(); return; }
    var tip = $('tutorial-tip');
    tip.innerHTML = '<div class="tutorial-txt">' + step.text + '</div><div class="tutorial-nav">'
      + '<button class="btn btn-ghost" id="tut-skip">跳过</button>'
      + '<button class="btn" id="tut-next">' + (tutorialStep === tutorialSteps.length - 1 ? '开始游戏' : '下一步') + '</button></div>';
    $('tut-next').onclick = function () { tutorialStep++; renderTutorialStep(); };
    $('tut-skip').onclick = tutorialDone;
    positionTutorial();
  }

  function startTutorial(force) {
    tutorialForced = !!force;
    tutorialStep = 0;
    $('tutorial-layer').style.display = 'block';
    renderTutorialStep();
    if (!tutorialRaf) tutorialRaf = requestAnimationFrame(trackTutorial);
  }

  // 管理员调试窗口：连点进度 5 次 → 输入密码 → 与实战一致的 5×4 盘面单格结算测试
  function showDebug() {
    var html = '<h2>调试 · 单格结算测试</h2>'
      + '<div class="lead">拖动宝可梦到任意格；未选中宝可梦时，点击格子切换「结算目标」。'
      + '目标格按真实 8 邻域规则结算，可测试角落、边缘与内部格。</div>';
    html += '<div class="debug-grid" id="debug-grid">';
    for (var i = 0; i < D.CONFIG.cellCount; i++) {
      html += '<div class="debug-cell" data-i="' + i + '"></div>';
    }
    html += '</div><div class="debug-result" id="debug-result">选一个格子作为结算目标，放入宝可梦后点「结算目标格」。</div>';
    html += '<div class="debug-pool" id="debug-pool">';
    Object.keys(POKEMON).forEach(function (k) {
      var mon = POKEMON[k];
      html += '<div class="debug-chip" draggable="true" data-id="' + k + '"><img src="' + sprite(k) + '" alt="' + mon.name + '"><span>' + mon.name + '</span></div>';
    });
    html += '</div><div class="modal-actions"><button class="btn" id="dbg-settle">结算目标格</button>'
      + '<button class="btn btn-ghost" id="dbg-clear">清空</button>'
      + '<button class="btn btn-ghost" id="dbg-close">关闭</button></div>';
    $('debug-modal').innerHTML = html;
    $('debug-layer').style.display = 'flex';
    bindDebug();
    renderDebugGrid();
  }

  function debugCoord(idx) {
    return '第 ' + (Math.floor(idx / D.CONFIG.cols) + 1) + ' 行第 ' + (idx % D.CONFIG.cols + 1) + ' 列';
  }

  function renderDebugGrid() {
    var box = $('debug-grid');
    if (!box) return;
    var near = E.neighbors(debugCenter);
    Array.prototype.forEach.call(box.children, function (cell, i) {
      cell.innerHTML = '';
      cell.classList.remove('has-mon', 'center', 'near');
      var id = debugGrid[i];
      if (id && POKEMON[id]) {
        var mon = POKEMON[id], ty = TYPES[mon.type];
        cell.classList.add('has-mon');
        cell.innerHTML = '<img src="' + sprite(id) + '" alt="' + mon.name + '">'
          + '<span class="nm">' + mon.name + '</span><span class="ty" style="background:' + ty.color + '">' + ty.name + '</span>';
      } else {
        cell.textContent = (Math.floor(i / D.CONFIG.cols) + 1) + '-' + (i % D.CONFIG.cols + 1);
      }
      if (i === debugCenter) cell.classList.add('center');
      else if (near.indexOf(i) >= 0) cell.classList.add('near');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#debug-pool .debug-chip'), function (chip) {
      chip.classList.toggle('picked', parseInt(chip.dataset.id, 10) === debugPick);
    });
  }

  function bindDebug() {
    Array.prototype.forEach.call(document.querySelectorAll('#debug-pool .debug-chip'), function (chip) {
      chip.onclick = function () {
        var id = parseInt(chip.dataset.id, 10);
        debugPick = debugPick === id ? null : id; // 再点一次取消选择
        renderDebugGrid();
      };
      chip.ondragstart = function (ev) {
        ev.dataTransfer.setData('text/plain', chip.dataset.id);
        ev.dataTransfer.effectAllowed = 'copy';
      };
    });
    Array.prototype.forEach.call($('debug-grid').children, function (cell) {
      cell.ondragover = function (ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; };
      cell.ondrop = function (ev) {
        ev.preventDefault();
        var id = parseInt(ev.dataTransfer.getData('text/plain'), 10);
        if (POKEMON[id]) { debugGrid[parseInt(cell.dataset.i, 10)] = id; renderDebugGrid(); }
      };
      cell.onclick = function () {
        var i = parseInt(cell.dataset.i, 10);
        if (debugPick) debugGrid[i] = debugPick; // 选中宝可梦时点击 = 放入
        else debugCenter = i;                     // 未选中时点击 = 切换结算目标
        renderDebugGrid();
      };
    });
    $('dbg-settle').onclick = function () {
      var id = debugGrid[debugCenter];
      var box = $('debug-result');
      if (!id || !POKEMON[id]) {
        box.textContent = '请先给「结算目标」格放入宝可梦（' + debugCoord(debugCenter) + '）。';
        return;
      }
      var mon = POKEMON[id], d = E.cellDetail(id, debugGrid, debugCenter);
      var nb = E.neighbors(debugCenter).length, names = [];
      (d.links || []).forEach(function (l) { names.push(POKEMON[debugGrid[l.target]].name); });
      box.innerHTML = '<b>' + mon.name + '</b>（基础 ' + mon.base + '）· 目标 ' + debugCoord(debugCenter)
        + '<div class="rule-note">邻域 ' + nb + ' 格 · 被克制邻居 <b>' + d.count + '</b> 个'
        + (names.length ? '（' + names.join('、') + '）' : '') + '</div>'
        + ' → 结算 <b class="big">' + d.gain + '</b> 金'
        + '<div class="rule-note">' + (d.count ? mon.base + ' + ' + mon.base + '×2×' + d.count + ' = ' + d.gain : '无克制邻居，仅基础值 ' + mon.base) + '</div>';
    };
    $('dbg-clear').onclick = function () {
      debugGrid = new Array(D.CONFIG.cellCount).fill(null);
      $('debug-result').textContent = '已清空（结算目标保留在 ' + debugCoord(debugCenter) + '）。';
      renderDebugGrid();
    };
    $('dbg-close').onclick = function () { $('debug-layer').style.display = 'none'; };
  }

  function onProgressClick() {
    var now = Date.now();
    if (now - debugClickAt > 1500) debugClicks = 0;
    debugClickAt = now;
    debugClicks++;
    if (debugClicks >= 5) {
      debugClicks = 0;
      var pwd = prompt('管理员密码');
      if (pwd === DEBUG_PASSWORD) showDebug();
    }
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
    showIntro(); // 每次开局都显示故事背景与本轮目标
  }

  // 清除所有存档：本局进度 + 跨局图鉴 + 新手引导标记，需两次确认
  function clearAllSaves() {
    if (!confirm('确定清除所有存档吗？\n本局进度、图鉴点亮记录、新手引导标记都会被删除，且不可恢复。')) return;
    var answer = prompt('二次确认：请输入「清除」两个字以永久删除。');
    if (answer !== '清除') return;
    abortAnim(); // 演出中清档必须先中止，否则旧回调会继续写回
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(DEX_KEY);
      localStorage.removeItem(TUTOR_KEY);
    } catch (e) {}
    location.reload();
  }

  function clearAnimDom() {
    Array.prototype.forEach.call(document.querySelectorAll('.float-gain,.coin-fly,.evo-badge'), function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#reel .cell img'), function (el) {
      el.classList.remove('bounce');
    });
    Array.prototype.forEach.call($('reel').children, function (el) {
      el.classList.remove('rolling', 'question', 'settling', 'evolving');
      el.style.animationDelay = '';
    });
  }

  // 中止演出：清计时器并让所有在途回调失效。跳过 / 重开都必须先走这里
  function abortAnim() {
    anim.active = false;
    anim.token++;
    anim.timers.forEach(clearTimeout);
    anim.timers = [];
    clearAnimDom();
    $('btn-skip').style.display = 'none';
  }

  function later(token, fn, ms) {
    var t = setTimeout(function () {
      if (!anim.active || token !== anim.token) return;
      fn();
    }, ms);
    anim.timers.push(t);
  }

  function bounceSprite(img) {
    if (!img) return;
    img.classList.remove('bounce');
    void img.offsetWidth; // 强制重排，让连续多次跳动每次都能重新播放
    img.classList.add('bounce');
  }

  function addFloat(cell, html, cls) {
    if (!cell) return null;
    var el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    cell.appendChild(el);
    return el;
  }

  // 播放一条联动收益：源格与目标格一起跳，各自显示收益来源，金币按这条单独入账
  function playLink(token, cell, targetCell, amount, label, floats) {
    bounceSprite(cell.querySelector('img'));
    // 目标格只跟着跳，不加任何文字/边框标识
    if (targetCell) bounceSprite(targetCell.querySelector('img'));
    floats.push(addFloat(cell, '+' + amount + '<small>' + label + '</small>', 'float-gain'));
    flyCoin(cell);
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

  // 转动演出结束后按引擎阶段分流：交租轮先收租，普通轮才选宝可梦
  function afterSpin() {
    render();
    if (game.phase === 'rentDue') showRent();
    else showOffer();
  }

  function finishAnim(token) {
    if (!anim.active || token !== anim.token) return;
    anim.active = false;
    anim.timers = [];
    clearAnimDom();
    $('btn-skip').style.display = 'none';
    afterSpin();
  }

  function skipAnim() {
    if (!anim.active) return;
    abortAnim();
    afterSpin();
  }

  // 阶段 A：所有格子同时变问号，格子边框和页面完全不动
  function showQuestion(cell) {
    cell.className = 'cell question';
    cell.textContent = '?';
  }

  function playSpin(token, res) {
    var cells = $('reel').children;
    // 默认跳过：不播问号与逐格结算，直接亮出结果并进入后续流程
    if (speed === 0) {
      paintCells(res.grid);
      $('machine-status').textContent = '结果已出';
      finishAnim(token);
      return;
    }
    Array.prototype.forEach.call(cells, showQuestion);
    later(token, function () {
      Array.prototype.forEach.call(cells, function (cell) {
        cell.classList.remove('question');
      });
      paintCells(res.grid); // 20 格同时亮出结果；可进化的格子会自动挂上「可进化」标识
      $('machine-status').textContent = '结果已出，准备结算…';
      // 结果先停 0.5 秒，让玩家看清排布与克制关系，再开始逐格结算
      later(token, function () {
        $('machine-status').textContent = '逐格结算中…';
        // 阶段 B：行优先逐格结算，金币数字跟着涨
        // 空格立即跳过不浪费演出时间；有收益格按总时长均分，单格 150~600ms
        var gainCount = res.info.filter(function (x) { return x.gain > 0; }).length;
        var step = Math.max(animMs(ANIM.settleMin), Math.min(animMs(ANIM.settleMax),
          Math.round(animMs(ANIM.settleTotal) / Math.max(1, gainCount))));
        var idx = 0, shown = res.startCoins;
        function settleOne() {
          if (idx >= res.info.length) {
            later(token, function () {
              $('gain-line').innerHTML = '上转收益 <span class="big">+' + res.gain + '</span> 金';
              finishAnim(token);
            }, animMs(ANIM.tailDuration));
            return;
          }
          var i = idx++, info = res.info[i], cell = cells[i], floats = [];
          var links = info.links || [];
          var duration = step;
          if (info.gain > 0 && cell) {
            cell.classList.add('settling');
            if (links.length) {
              // 每条联动单独结算、单独跳一次：克 2 个邻居 = 跳 2 次，每次 base×2
              var per = Math.round(info.gain / links.length);
              var sub = Math.max(animMs(110), Math.floor(step / links.length));
              duration = sub * links.length;
              var added = 0;
              links.forEach(function (link, k) {
                later(token, function () {
                  var amount = k === links.length - 1 ? info.gain - added : per;
                  added += amount;
                  playLink(token, cell, cells[link.target], amount, link.label || '联动', floats);
                  shown += amount;
                  tickCoins(shown);
                }, k * sub);
              });
            } else {
              // 无联动：基础收益跳一次
              bounceSprite(cell.querySelector('img'));
              floats.push(addFloat(cell, '+' + info.gain, 'float-gain'));
              flyCoin(cell);
              shown += info.gain;
              tickCoins(shown);
            }
          }
          if (info.gain === 0) {
            settleOne(); // 空格不占演出时间
            return;
          }
          later(token, function () {
            if (cell) cell.classList.remove('settling');
            floats.forEach(function (f) { if (f && f.parentNode) f.parentNode.removeChild(f); });
            settleOne();
          }, duration);
        }
        settleOne();
      }, animMs(ANIM.revealHold));
    }, animMs(ANIM.questionDuration));
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

  function setSpeed(s) {
    if ([0, 1, 2, 3].indexOf(s) < 0) return;
    speed = s;
    saveSpeed();
    renderSpeed();
  }

  // 速度控件高亮 + body 标记（CSS 用 data-speed 同步缩短弹跳、金币等动画）
  function renderSpeed() {
    document.body.setAttribute('data-speed', String(speed));
    Array.prototype.forEach.call(document.querySelectorAll('#speed-ctrl .speed-btn'), function (btn) {
      btn.classList.toggle('active', parseInt(btn.getAttribute('data-speed'), 10) === speed);
    });
  }

  function bind() {
    $('btn-spin').onclick = onSpin;
    $('btn-skip').onclick = skipAnim;
    $('btn-dex').onclick = function () { showDex(); };
    $('btn-rules').onclick = showRules;
    $('hud-progress-box').onclick = onProgressClick;
    $('modal-dock').onclick = expandFromDock;
    Array.prototype.forEach.call(document.querySelectorAll('#speed-ctrl .speed-btn'), function (btn) {
      btn.onclick = function () {
        var s = parseInt(btn.getAttribute('data-speed'), 10);
        // 演出中切到「跳过」：当前这次也立即结束
        if (s === 0 && anim.active) skipAnim();
        setSpeed(s);
      };
    });
    $('btn-restart').onclick = function () {
      if (confirm('确定重开？当前进度会丢失。')) restart();
    };
    $('btn-clear-save').onclick = clearAllSaves;
  }

  function init() {
    game = load() || E.createGame();
    dex = loadDex();
    lightDex(game.pool); // 开局自带的御三家按「进入卡池」规则点亮
    bind();
    renderSpeed();
    render();
    if (game.phase === 'rentDue') showRent();
    else if (game.phase === 'choosing') showOffer();
    else if (game.phase === 'rentReward') showItemReward();
    else if (game.phase === 'win' || game.phase === 'gameover') showEnd(game.phase === 'win');
    // 首次进入显示新手引导（跨局只显示一次，可从规则页重看）
    var seen = false;
    try { seen = localStorage.getItem(TUTOR_KEY) === '1'; } catch (e) {}
    if (!seen) startTutorial(false); // 首次：先引导
    else showIntro();                // 之后每次开局：只弹故事
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
