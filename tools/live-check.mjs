/* 线上验收：对 Pages 部署后的 URL 做资源连通性与缓存版本校验 */
const BASE = process.argv[2] || 'https://poke-rent.pages.dev';
const V = '8';

let failures = 0;
function check(c, m) { if (!c) { failures++; console.error('FAIL ' + m); } else console.log('PASS ' + m); }

async function get(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, text: await r.text(), headers: r.headers };
}

console.log('== 线上验收 ' + BASE + ' ==');

// 首页
const home = await get('/');
check(home.status === 200, '首页 HTTP 200');
check(home.text.includes('宝可梦房东'), '首页标题正确');
check(home.text.includes('style.css?v=' + V), '样式表引用带缓存版本');
check(home.text.includes('js/data.js?v=' + V), 'data.js 引用带缓存版本');
check(home.text.includes('js/dex-data.js?v=' + V), 'dex-data.js 引用带缓存版本');
check(home.text.includes('js/engine.js?v=' + V), 'engine.js 引用带缓存版本');
check(home.text.includes('js/ui.js?v=' + V), 'ui.js 引用带缓存版本');
check(home.text.includes('btn-skip'), '跳过动画按钮已部署');
check(home.text.includes('modal-dock'), '选择弹窗收起按钮已部署');
check(home.text.includes('btn-dex'), '图鉴按钮已部署');
check(home.text.includes('btn-rules'), '规则按钮已部署');
check(home.text.includes('tutorial-layer'), '新手引导层已部署');
check(home.text.includes('debug-layer'), '调试窗口层已部署');
check(home.text.includes('btn-clear-save'), '清除存档按钮已部署');
check(home.text.includes('rank-box'), '贡献排名面板已部署');
check(home.text.includes('1/7'), '进度从 1/7 开始已部署');
check(!home.text.includes('title="进度"'), '进度格不向玩家暴露管理员入口提示');

// 新样式与逻辑已部署
const css = await get('/style.css?v=' + V);
check(css.status === 200 && css.text.includes('.cell.question'), '问号演出样式已部署');
check(css.text.includes('.dex-card.locked'), '图鉴剪影样式已部署');
check(css.text.includes('.prob-bar'), '顶部档位概率样式已部署');
check(css.text.includes('.cell.evolving'), '进化特效样式已部署');
check(css.text.includes('.tutorial-hole'), '新手引导高亮样式已部署');
check(css.text.includes('.btn-danger'), '清除存档按钮样式已部署');
check(css.text.includes('.type-pill'), '选择卡片属性彩色标签样式已部署');
check(css.text.includes('.choice img{width:96px'), '三选一宝可梦图标放大样式已部署');
check(css.text.includes('.hud-click{cursor:default'), '进度格无可点击视觉暗示已部署');
check(css.text.includes('.float-link'), '联动目标跳动提示样式已部署');
check(css.text.includes('.debug-grid'), '调试窗口样式已部署');
const ui = await get('/js/ui.js?v=' + V);
check(ui.status === 200 && ui.text.includes('class="rar"'), '稀有度标签已部署');
check(ui.text.includes('m-hide'), '收起弹窗逻辑已部署');
check(ui.text.includes('showDex'), '图鉴弹窗逻辑已部署');
check(ui.text.includes('collapseToDock'), '收起飞向按钮动画已部署');
check(ui.text.includes('showRules'), '规则弹窗逻辑已部署');
check(ui.text.includes('startTutorial'), '新手引导逻辑已部署');
check(ui.text.includes('trackTutorial'), '引导高亮实时跟随逻辑已部署');
check(ui.text.includes('clearAllSaves'), '清除存档逻辑已部署');
check(ui.text.includes('playLink'), '逐条联动跳动演出已部署');
check(ui.text.includes('1997121'), '调试窗口密码入口已部署');
check(ui.text.includes('probBar'), '顶部概率条逻辑已部署');
check(ui.text.includes('evolving'), '进化特效逻辑已部署');
const eng = await get('/js/engine.js?v=' + V);
check(eng.status === 200 && eng.text.includes('postRentOffer'), '交租后强制稀有度逻辑已部署');
check(eng.text.includes('rollItemOffer'), '道具 3 选 1 逻辑已部署');
check(eng.text.includes("kind: 'counter'"), '通用联动目标数据已部署');
// 静态资源
const js = await get('/js/data.js?v=' + V);
check(js.status === 200, 'data.js HTTP 200');
check(js.text.includes('revealHold: 500'), '结果停留 0.5 秒参数已部署');
check(js.text.includes('STARTER_POOL: [1, 4, 7]'), '开局御三家 3 只已部署');
check(js.text.includes('RULES: RULES'), '规则数据已部署');
check(js.text.includes('saveVersion: 4'), 'data.js 存档版本正确');
check(js.text.includes('itemOfferCount: 3'), '道具 3 选 1 配置已部署');
check(js.text.includes('RARITY'), '稀有度数据已部署');
const dexData = await get('/js/dex-data.js?v=' + V);
check(dexData.status === 200 && dexData.text.includes('小火龙'), '图鉴中文说明已部署');
check((dexData.text.match(/"/g) || []).length >= 36, '图鉴 18 条数据齐全');

// 18 只宝可梦图
const ids = [1, 2, 4, 5, 7, 8, 25, 26, 37, 43, 50, 51, 54, 81, 86, 87, 95, 361];
let spritesOk = 0;
for (const id of ids) {
  const r = await fetch(BASE + '/assets/pokemon/' + id + '.png?v=' + V);
  if (r.status === 200) spritesOk++;
}
check(spritesOk === 18, `18 只精灵图全部可访问 (${spritesOk}/18)`);

// 道具图标（原 7 + 新增 3）
const icons = ['poke-ball', 'center-pass', 'coffee', 'contract', 'broken-ball', 'recycle', 'conveyor',
  'lucky-egg', 'exp-share', 'rare-candy'];
let iconsOk = 0;
for (const n of icons) {
  const r = await fetch(BASE + '/assets/items/' + n + '.png?v=' + V);
  if (r.status === 200) iconsOk++;
}
check(iconsOk === 10, `10 个道具图标全部可访问 (${iconsOk}/10)`);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
