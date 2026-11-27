/* 线上验收：对 Pages 部署后的 URL 做资源连通性与缓存版本校验 */
const BASE = process.argv[2] || 'https://poke-rent.pages.dev';

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
check(home.text.includes('style.css?v=4'), '样式表引用带缓存版本');
check(home.text.includes('js/data.js?v=4'), 'data.js 引用带缓存版本');
check(home.text.includes('js/engine.js?v=4'), 'engine.js 引用带缓存版本');
check(home.text.includes('js/ui.js?v=4'), 'ui.js 引用带缓存版本');
check(home.text.includes('btn-skip'), '跳过动画按钮已部署');
check(home.text.includes('rank-box'), '贡献排名面板已部署');

// 新样式与稀有度已部署
const css = await get('/style.css?v=4');
check(css.status === 200 && css.text.includes('.cell.question'), '问号演出样式已部署');
const ui = await get('/js/ui.js?v=4');
check(ui.status === 200 && ui.text.includes('class="rar"'), '稀有度标签已部署');

// 静态资源
const js = await get('/js/data.js?v=4');
check(js.status === 200, 'data.js HTTP 200');
check(js.text.includes('saveVersion: 3'), 'data.js 内容正确');
check(js.text.includes('RARITY') && js.text.includes('postRentOffer'), '稀有度与交租后标记已部署');

// 18 只宝可梦图
const ids = [1, 2, 4, 5, 7, 8, 25, 26, 37, 43, 50, 51, 54, 81, 86, 87, 95, 361];
let spritesOk = 0;
for (const id of ids) {
  const r = await fetch(BASE + '/assets/pokemon/' + id + '.png?v=4');
  if (r.status === 200) spritesOk++;
}
check(spritesOk === 18, `18 只精灵图全部可访问 (${spritesOk}/18)`);

// 道具图标
const icons = ['poke-ball', 'center-pass', 'coffee', 'contract', 'broken-ball', 'recycle', 'conveyor'];
let iconsOk = 0;
for (const n of icons) {
  const r = await fetch(BASE + '/assets/items/' + n + '.png?v=4');
  if (r.status === 200) iconsOk++;
}
check(iconsOk === 7, `7 个道具图标全部可访问 (${iconsOk}/7)`);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
