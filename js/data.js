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

  // 18 只 = 6 属性 × (2 只进化链 + 1 只单体)
  var POKEMON = {
    1:   { id: 1,   name: '妙蛙种子', type: 'grass',    base: 1, evolveTo: 2 },
    2:   { id: 2,   name: '妙蛙草',   type: 'grass',    base: 3, evolveTo: null },
    43:  { id: 43,  name: '走路草',   type: 'grass',    base: 1, evolveTo: null },
    4:   { id: 4,   name: '小火龙',   type: 'fire',     base: 1, evolveTo: 5 },
    5:   { id: 5,   name: '火恐龙',   type: 'fire',     base: 3, evolveTo: null },
    37:  { id: 37,  name: '六尾',     type: 'fire',     base: 1, evolveTo: null },
    7:   { id: 7,   name: '杰尼龟',   type: 'water',    base: 1, evolveTo: 8 },
    8:   { id: 8,   name: '卡咪龟',   type: 'water',    base: 3, evolveTo: null },
    54:  { id: 54,  name: '可达鸭',   type: 'water',    base: 1, evolveTo: null },
    25:  { id: 25,  name: '皮卡丘',   type: 'electric', base: 1, evolveTo: 26 },
    26:  { id: 26,  name: '雷丘',     type: 'electric', base: 3, evolveTo: null },
    81:  { id: 81,  name: '小磁怪',   type: 'electric', base: 1, evolveTo: null },
    50:  { id: 50,  name: '地鼠',     type: 'ground',   base: 1, evolveTo: 51 },
    51:  { id: 51,  name: '三地鼠',   type: 'ground',   base: 3, evolveTo: null },
    95:  { id: 95,  name: '大岩蛇',   type: 'ground',   base: 1, evolveTo: null },
    86:  { id: 86,  name: '小海狮',   type: 'ice',      base: 1, evolveTo: 87 },
    87:  { id: 87,  name: '白海狮',   type: 'ice',      base: 3, evolveTo: null },
    361: { id: 361, name: '雪童子',   type: 'ice',      base: 1, evolveTo: null }
  };

  // 租金曲线：当前 Wiki 组，转数 5/5/6/6/7/7/8/8/9/9/10/10
  var RENT = [
    { rent: 25,  spins: 5 },
    { rent: 50,  spins: 5 },
    { rent: 100, spins: 6 },
    { rent: 150, spins: 6 },
    { rent: 225, spins: 7 },
    { rent: 275, spins: 7 },
    { rent: 325, spins: 8 },
    { rent: 375, spins: 8 },
    { rent: 500, spins: 9 },
    { rent: 550, spins: 9 },
    { rent: 650, spins: 10 },
    { rent: 777, spins: 10 }
  ];

  // 永久物品：当局生效、不可关闭
  var ITEMS = {
    coffee:      { id: 'coffee',      name: '提神咖啡',   icon: 'assets/items/coffee.png',      desc: '交不起租时可额外转 2 次（每局一次）' },
    contract:    { id: 'contract',    name: '坂木的契约', icon: 'assets/items/contract.png',    desc: '交租时 +6 金币抵消' },
    brokenBall:  { id: 'brokenBall',  name: '破碎的精灵球', icon: 'assets/items/broken-ball.png', desc: '3 选 1 变 2 选 1，每次选择 +2 金' },
    recycle:     { id: 'recycle',     name: '回收',       icon: 'assets/items/recycle.png',     desc: '每次结算额外 +2 金' },
    conveyor:    { id: 'conveyor',    name: '传送带',     icon: 'assets/items/conveyor.png',    desc: '每转后 20 格整体右移一格' }
  };

  // 消耗品：一次性
  var TOKENS = {
    pokeBall:    { id: 'pokeBall',    name: '精灵球',     icon: 'assets/items/poke-ball.png',    desc: '刷新当前的 3 选 1' },
    centerPass:  { id: 'centerPass',  name: '精灵中心券', icon: 'assets/items/center-pass.png',  desc: '移除卡池中 1 个符号' }
  };

  var CONFIG = {
    cols: 5,
    rows: 4,
    cellCount: 20,
    startCoins: 1,
    spinCost: 1,
    evolveThreshold: 4,
    bonusMultiplier: 2,
    fillBase: 4,          // 首轮每转填充格数
    fillPerRent: 1,       // 每交租一次增加的填充格数
    fillMax: 20,          // 填充上限
    baseOfferCount: 3,
    rentCount: RENT.length,
    saveVersion: 2,
    cacheVersion: 2
  };

  // 演出时序（毫秒）：集中放置，后续接调速 UI 时只需覆盖这里
  var ANIM = {
    rollDuration: 500,   // 20 格翻滚时长
    rollStagger: 60,     // 每列错开
    settleTotal: 3000,   // 逐格结算总时长，按有收益格数均分
    settleMin: 150,      // 单格最短停留（满配时）
    settleMax: 600,      // 单格最长停留（前期格子少时看得清）
    tailDuration: 300    // 收尾展示总收益
  };

  global.PR = global.PR || {};
  global.PR.data = {
    TYPES: TYPES,
    POKEMON: POKEMON,
    RENT: RENT,
    ITEMS: ITEMS,
    TOKENS: TOKENS,
    CONFIG: CONFIG,
    ANIM: ANIM,
    // 起始卡池：6 个一阶（每属性一个）
    STARTER_POOL: [1, 4, 7, 25, 50, 86]
  };
})(typeof window !== 'undefined' ? window : globalThis);
