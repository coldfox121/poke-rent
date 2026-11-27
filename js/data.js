/* poke-rent 数据层：18 只宝可梦、属性克制、租金曲线、道具/消耗品定义 */
(function (global) {
  'use strict';

  var TYPES = {
    fire:    { name: '火', color: '#D85A30', beats: ['grass', 'ice'] },
    water:   { name: '水', color: '#378ADD', beats: ['fire', 'ground'] },
    grass:   { name: '草', color: '#639922', beats: ['water', 'ground'] },
    electric:{ name: '电', color: '#BA7517', beats: ['water'] },
    ground:  { name: '地面', color: '#993C1D', beats: ['electric', 'fire'] },
    ice:     { name: '冰', color: '#1D9E75', beats: ['grass', 'ground'] }
  };

  // 稀有度：按 Poke'Catch 的 tierOf 规则（捕获率 / 进化阶段 / 种族值）对 18 只归类
  // 产出暂不改变，稀有度只影响三选一抽取概率与界面标识
  var RARITY = {
    // 原作 1.0x 为 68/30/1.5/0.5（非常稀有）；本作无非常稀有档，0.5 并入普通 → 68.5
    common:   { key: 'common',   name: '普通', color: '#9aa4b1', weight: 68.5 },
    uncommon: { key: 'uncommon', name: '非凡', color: '#3b82f6', weight: 30 },
    rare:     { key: 'rare',     name: '稀有', color: '#a855f7', weight: 1.5 }
  };

  // 18 只 = 6 属性 × (2 只进化链 + 1 只单体)
  var POKEMON = {
    1:   { id: 1,   name: '妙蛙种子', type: 'grass',    base: 1, rarity: 'rare',     evolveTo: 2 },
    2:   { id: 2,   name: '妙蛙草',   type: 'grass',    base: 3, rarity: 'rare',     evolveTo: null },
    43:  { id: 43,  name: '走路草',   type: 'grass',    base: 1, rarity: 'common',   evolveTo: null },
    4:   { id: 4,   name: '小火龙',   type: 'fire',     base: 1, rarity: 'rare',     evolveTo: 5 },
    5:   { id: 5,   name: '火恐龙',   type: 'fire',     base: 3, rarity: 'rare',     evolveTo: null },
    37:  { id: 37,  name: '六尾',     type: 'fire',     base: 1, rarity: 'common',   evolveTo: null },
    7:   { id: 7,   name: '杰尼龟',   type: 'water',    base: 1, rarity: 'rare',     evolveTo: 8 },
    8:   { id: 8,   name: '卡咪龟',   type: 'water',    base: 3, rarity: 'rare',     evolveTo: null },
    54:  { id: 54,  name: '可达鸭',   type: 'water',    base: 1, rarity: 'common',   evolveTo: null },
    25:  { id: 25,  name: '皮卡丘',   type: 'electric', base: 1, rarity: 'uncommon', evolveTo: 26 },
    26:  { id: 26,  name: '雷丘',     type: 'electric', base: 3, rarity: 'rare',     evolveTo: null },
    81:  { id: 81,  name: '小磁怪',   type: 'electric', base: 1, rarity: 'common',   evolveTo: null },
    50:  { id: 50,  name: '地鼠',     type: 'ground',   base: 1, rarity: 'common',   evolveTo: 51 },
    51:  { id: 51,  name: '三地鼠',   type: 'ground',   base: 3, rarity: 'uncommon', evolveTo: null },
    95:  { id: 95,  name: '大岩蛇',   type: 'ground',   base: 1, rarity: 'rare',     evolveTo: null },
    86:  { id: 86,  name: '小海狮',   type: 'ice',      base: 1, rarity: 'common',   evolveTo: 87 },
    87:  { id: 87,  name: '白海狮',   type: 'ice',      base: 3, rarity: 'uncommon', evolveTo: null },
    361: { id: 361, name: '雪童子',   type: 'ice',      base: 1, rarity: 'common',   evolveTo: null }
  };

  // 租金曲线：7 轮 × 固定 5 转。当前为「临时测试难度」——按用户要求大幅调低，
  // 目的是能顺利测到后段流程；后续做特殊能力时再按模拟重新扫描正式平衡。
  var RENT = [
    { rent: 6,  spins: 5 },
    { rent: 10, spins: 5 },
    { rent: 14, spins: 5 },
    { rent: 18, spins: 5 },
    { rent: 22, spins: 5 },
    { rent: 26, spins: 5 },
    { rent: 30, spins: 5 }
  ];

  // 永久物品：当局生效、不可关闭；stackable=false 的道具已拥有后不再出现
  var ITEMS = {
    coffee:      { id: 'coffee',      name: '提神咖啡',   icon: 'assets/items/coffee.png',      desc: '交不起租时可额外转 2 次（每局一次）', rarity: 'common',   stackable: false },
    contract:    { id: 'contract',    name: '坂木的契约', icon: 'assets/items/contract.png',    desc: '交租时 +6 金币抵消；三选一稀有度倍率 ×1.2（可叠加）', rarity: 'uncommon', stackable: true },
    brokenBall:  { id: 'brokenBall',  name: '破碎的精灵球', icon: 'assets/items/broken-ball.png', desc: '3 选 1 变 2 选 1，每次选择 +2 金', rarity: 'uncommon', stackable: false },
    recycle:     { id: 'recycle',     name: '回收',       icon: 'assets/items/recycle.png',     desc: '每次结算额外 +2 金（可叠加）', rarity: 'common',   stackable: true },
    conveyor:    { id: 'conveyor',    name: '传送带',     icon: 'assets/items/conveyor.png',    desc: '每转后 20 格整体右移一格（可叠加）', rarity: 'common',   stackable: true },
    expShare:    { id: 'expShare',    name: '学习装置',   icon: 'assets/items/exp-share.png',    desc: '每次结算额外 +1 金（可叠加）', rarity: 'common',   stackable: true },
    rareCandy:   { id: 'rareCandy',   name: '神奇糖果',   icon: 'assets/items/rare-candy.png',   desc: '三选一稀有度倍率 ×1.2（可叠加）', rarity: 'rare',     stackable: true },
    luckyEgg:    { id: 'luckyEgg',    name: '幸运蛋',     icon: 'assets/items/lucky-egg.png',    desc: '进化所需上屏次数 -1，最低 2（可叠加）', rarity: 'uncommon', stackable: true }
  };

  // 消耗品：一次性
  var TOKENS = {
    pokeBall:    { id: 'pokeBall',    name: '精灵球',     icon: 'assets/items/poke-ball.png',    desc: '刷新当前的 3 选 1' },
    centerPass:  { id: 'centerPass',  name: '精灵中心券', icon: 'assets/items/center-pass.png',  desc: '移除卡池中 1 个符号' }
  };

  // 规则页 / 新手引导共用：属性克制奖励规则从这里读取，不再写进图鉴详情
  var RULES = [
    { title: '目标', body: '扮演被火箭队逼债的训练家，靠精灵球机赚钱，连续交清 7 轮保护费即通关。每轮固定 5 转，每转消耗 1 金币。' },
    { title: '转动与卡池', body: '点「转动」生成 20 格结果。卡池中每种宝可梦每转各上屏一次、随机铺位；卡池超过 20 只时随机抽 20 只。转完从三选一里挑选宝可梦加入卡池，也可跳过保持卡池干净。' },
    { title: '基础产出', body: '每格若周围 8 邻域（上下左右 + 四斜角，不含首尾环绕）没有自己克制的宝可梦，就产出自身基础值。' },
    { title: '属性克制奖励', body: '每有 1 个被自己克制的邻居（按下方克制表），该格就独立再结算一次「基础值 ×2」，多次相加。例：基础 1 的宝可梦有 3 个被克邻居，产出 1 + 1×2×3 = 7 金。行优先结算（第一行左到右，逐行到第四行）。' },
    { title: '进化', body: '同一只宝可梦累计上屏达到 4 次即进化为二阶形态，基础产出由 1 提升到 3，卡池中该符号同步替换。「幸运蛋」每件让阈值 -1，最低 2。' },
    { title: '稀有度', body: '三选一先抽稀有度档位再抽具体项，档位概率显示在弹窗顶部：普通 68.5% / 非凡 30% / 稀有 1.5%。第 1 次交租前只出普通，交租 1 次后解锁非凡，2 次后解锁稀有；交租后首次三选一强制非凡以上。' },
    { title: '道具与消耗品', body: '永久物品当局生效、不可关闭，同类效果可叠加；消耗品为精灵球（刷新三选一）与精灵中心券（从卡池移除 1 个符号，吃券的 × 按钮在卡池 chip 上）。每次交租后发放 2 券 + 1 球，并给一次道具 3 选 1。' },
    { title: '图鉴', body: '18 只宝可梦，首次进入卡池即点亮并跨局保留。图鉴展示官方图鉴说明与基础信息（属性、基础收益、进化条件、稀有度）；点击转盘或卡池里的宝可梦可直接跳到对应图鉴条目。' }
  ];

  var CONFIG = {
    cols: 5,
    rows: 4,
    cellCount: 20,
    startCoins: 1,
    spinCost: 1,
    evolveThreshold: 4,
    bonusMultiplier: 2,
    baseOfferCount: 3,
    itemOfferCount: 3,    // 交租后道具 3 选 1
    removalPerRent: 2,    // 每次交租后赠送精灵中心券
    rerollPerRent: 1,     // 每次交租后赠送精灵球
    rentCount: RENT.length,
    rarityBoost: 1.2,     // 坂木的契约 / 神奇糖果每层的稀有度倍率
    saveVersion: 5,
    cacheVersion: 12
  };

  // 演出时序（毫秒）：集中放置，后续接调速 UI 时只需覆盖这里
  var ANIM = {
    questionDuration: 500, // 20 格同时变问号的停留时长
    revealHold: 500,       // 结果亮出后停留，让玩家看清再开始结算（0.5 秒）
    settleTotal: 3000,     // 逐格结算总时长，按有收益格数均分
    settleMin: 150,        // 单格最短停留（满配时）
    settleMax: 600,        // 单格最长停留（前期格子少时看得清）
    tailDuration: 300      // 收尾展示总收益
  };

  global.PR = global.PR || {};
  global.PR.data = {
    TYPES: TYPES,
    POKEMON: POKEMON,
    RARITY: RARITY,
    RENT: RENT,
    RULES: RULES,
    ITEMS: ITEMS,
    TOKENS: TOKENS,
    CONFIG: CONFIG,
    ANIM: ANIM,
    // 起始卡池：御三家 3 只（妙蛙种子 / 小火龙 / 杰尼龟），对齐原作且不让开局过易
    STARTER_POOL: [1, 4, 7]
  };
})(typeof window !== 'undefined' ? window : globalThis);
