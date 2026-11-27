/* 端到端测试：真实浏览器点击流程 */
import puppeteer from 'file:///C:/Users/Administrator/AppData/Local/Temp/poke-rent-test/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const URL = 'file:///D:/TREA_project/poke-rent/index.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let failures = 0;
function check(c, m) { if (!c) { failures++; console.error('FAIL ' + m); } else console.log('PASS ' + m); }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0' });

// file:// 下 page.goto/reload 偶发 30s 导航超时，改用 location.reload() + 轮询就绪
async function softReload() {
  await page.evaluate(() => { location.reload(); });
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const ok = await page.evaluate(() => document.readyState === 'complete' && !!document.getElementById('hud-progress'));
      if (ok) return;
    } catch (e) { /* 导航中上下文销毁，继续轮询 */ }
  }
  throw new Error('reload timeout');
}

// ---- 新手引导（首次进入，先于故事）----
check(await page.$eval('#tutorial-layer', el => el.style.display) === 'block', '首次进入显示新手引导');
check(await page.$eval('#tutorial-tip', el => el.textContent.includes('转动')), '引导第 1 步讲转动');
// 引导期间页面按钮不可点，避免提前触发转动打乱流程
await page.click('#btn-spin');
check(await page.$eval('#hud-coins', el => el.textContent) === '1', '引导期间点击转动不扣金币');
check(await page.$$eval('#reel .cell.question', els => els.length) === 0, '引导期间点击转动不触发演出');
await page.click('#tut-next');
check(await page.$eval('#tutorial-tip', el => el.textContent.includes('属性克制')), '引导第 2 步讲属性克制');
// 页面尺寸变化后高亮框必须跟随目标
await page.setViewport({ width: 1100, height: 780 });
await new Promise(r => setTimeout(r, 120));
const holeFollows = await page.evaluate(() => {
  const h = document.getElementById('tutorial-hole').getBoundingClientRect();
  const t = document.getElementById('reel').getBoundingClientRect();
  return Math.abs(h.left - (t.left - 8)) < 2 && Math.abs(h.top - (t.top - 8)) < 2
    && Math.abs(h.width - (t.width + 16)) < 2 && Math.abs(h.height - (t.height + 16)) < 2;
});
check(holeFollows, '引导高亮框随页面布局变化实时跟随目标');
await page.setViewport({ width: 1280, height: 900 });
await new Promise(r => setTimeout(r, 120));
await page.click('#tut-next');
check(await page.$eval('#tutorial-tip', el => el.textContent.includes('卡池')), '引导第 3 步讲卡池');
await page.click('#tut-next');
check(await page.$eval('#tutorial-tip', el => el.textContent.includes('收租')), '引导第 4 步讲交租');
await page.click('#tut-next');
check(await page.$eval('#tutorial-tip', el => el.textContent.includes('图鉴')), '引导第 5 步讲图鉴');
await page.click('#tut-next');
check(await page.$eval('#tutorial-layer', el => el.style.display) === 'none', '引导完成后关闭');
const tutorSeen = await page.evaluate(() => localStorage.getItem('poke-rent-tutorial'));
check(tutorSeen === '1', '引导完成标记写入 localStorage');

// ---- 开场故事（首次引导结束后弹出）----
check(await page.$eval('#story-layer', el => el.style.display) === 'flex', '首次引导结束后弹出故事弹窗');
check(await page.$eval('#story-modal', el => el.textContent.includes('火箭队') && el.textContent.includes('7 轮') && el.textContent.includes('6 金') && el.textContent.includes('第 1 轮')),
  '故事弹窗含背景与本轮目标');
await page.click('#m-story-start');
check(await page.$eval('#story-layer', el => el.style.display) === 'none', '故事弹窗可关闭');

check(await page.$eval('#hud-coins', el => el.textContent) === '1', '初始金币 1');
check(await page.$$eval('#reel .cell', els => els.length) === 20, '20 格网格');
check(await page.$$eval('#pool .pool-chip', els => els.length) === 3, '初始卡池御三家 3 只');
check(await page.$eval('#hud-progress', el => el.textContent) === '1/7', '进度显示 1/7（当前所在轮次）');
check(await page.$eval('#dex-count', el => /3\/18/.test(el.textContent)), '图鉴按钮显示已点亮 3/18');
check(await page.$$eval('#pool .pool-chip .pool-num', els => els.length) === 3, '卡池每种显示 ×N 张数');
check(await page.$$eval('#pool .pool-type', els => els.length === 3 && els.every(el => el.textContent.trim())), '卡池 chip 显示宝可梦属性');

// ---- 规则弹窗 ----
check(await page.$eval('#btn-rules', el => el.textContent.includes('规则')), '顶栏规则按钮存在');
await page.click('#btn-rules');
await page.waitForSelector('#rules-layer', { visible: true });
check(await page.$$eval('.rule', els => els.length) >= 8, '规则页含目标/转动/克制等条目');
check(await page.$eval('#rules-modal', el => el.textContent.includes('属性克制奖励') && el.textContent.includes('基础值 ×2')),
  '规则页写明属性克制奖励规则');
check(await page.$$eval('.type-row', els => els.length) === 6, '规则页含 6 属性克制表');
await page.click('#m-rules-close');
check(await page.$eval('#rules-layer', el => el.style.display) === 'none', '规则弹窗可关闭');

// ---- 图鉴弹窗 ----
await page.click('#btn-dex');
await page.waitForSelector('#dex-layer', { visible: true });
check(await page.$$eval('.dex-card', els => els.length) === 18, '图鉴列出 18 只');
check(await page.$$eval('.dex-card.locked', els => els.length) === 15, '开局 3 只点亮、15 只未点亮');
await page.click('.dex-card:not(.locked)');
check(await page.$eval('#dex-detail', el => el.textContent.includes('图鉴说明') && el.textContent.includes('基础信息')),
  '图鉴详情含官方说明 + 基础信息');
check(await page.$eval('#dex-detail', el => !el.textContent.includes('每个独立结算')),
  '图鉴详情不再写属性克制奖励规则');
await page.click('#m-dex-close');
check(await page.$eval('#dex-layer', el => el.style.display) === 'none', '图鉴可关闭');

// ---- 点击卡池 chip 进图鉴 ----
await page.click('#pool .pool-chip');
check(await page.$eval('#dex-layer', el => el.style.display) === 'flex', '点击卡池宝可梦打开图鉴');
await page.click('#m-dex-close');

// ---- 第一次转动 ----
await page.click('#btn-spin');
check(await page.$eval('#btn-skip', el => el.style.display !== 'none'), '演出期间显示跳过按钮');
check(await page.$$eval('#reel .cell.question', els => els.length) === 20, '20 格同时变问号');
await page.click('#btn-skip');
await page.waitForSelector('.modal', { visible: true });
check(await page.$eval('#btn-skip', el => el.style.display) === 'none', '跳过后按钮隐藏');
check(await page.$$eval('.choice', els => els.length) === 3, '转后出现 3 选 1');
check(await page.$$eval('.choice .rar', els => els.length) === 3, '三选一显示稀有度标签');
check(await page.$$eval('.choice .prob', els => els.length) === 0, '卡片下不再逐项显示概率');
check(await page.$$eval('.choice .type-pill', els => els.length === 3 && els.every(el => el.textContent.trim())), '三选一卡片显示彩色属性标签');
check(await page.$eval('.prob-bar', el => /普通 [\d.]+%.*非凡 [\d.]+%.*稀有 [\d.]+%/.test(el.textContent)),
  '概率统一显示在弹窗顶部一行');

// 收起选择窗口 → 飞向悬浮按钮 → 悬浮按钮恢复
await page.click('#m-hide');
await page.waitForFunction(() => document.getElementById('modal-layer').style.display === 'none', { timeout: 2000 });
check(await page.$eval('#modal-dock', el => el.style.display) !== 'none', '收起后显示悬浮按钮');
check(await page.$$eval('#reel .cell:not(.empty)', els => els.length) > 0, '收起后上轮结果可见');
await page.click('#modal-dock');
await page.waitForFunction(() => document.getElementById('modal-layer').style.display === 'flex', { timeout: 1000 });
await new Promise(r => setTimeout(r, 420)); // 等展开动画收尾计时器完成，避免干扰随后的收起
check(await page.$eval('#modal-dock', el => el.style.display) === 'none', '展开后悬浮按钮隐藏');

const imgOk = await page.$$eval('#reel .cell img', imgs =>
  imgs.length > 0 && imgs.every(img => img.complete && img.naturalWidth > 0)
);
check(imgOk, '转动后精灵图全部加载成功');

// 点击转盘上的宝可梦进图鉴（先收起选择弹窗，否则弹窗盖住转盘）
await page.click('#m-hide');
await page.waitForFunction(() => document.getElementById('modal-layer').style.display === 'none', { timeout: 2000 });
await page.click('#reel .cell:not(.empty)');
check(await page.$eval('#dex-layer', el => el.style.display) === 'flex', '点击转盘宝可梦打开图鉴');
await page.click('#m-dex-close');
// 重新展开选择弹窗，继续后续流程
await page.click('#modal-dock');
await page.waitForFunction(() => document.getElementById('modal-layer').style.display === 'flex', { timeout: 1000 });
await new Promise(r => setTimeout(r, 420)); // 等展开动画收尾

// 贡献排名
check(await page.$$eval('#rank .rank-row', els => els.length) > 0, '贡献排名有记录');
check(await page.$eval('#rank .rank-head', el => el.textContent.includes('本局累计') && el.textContent.includes('上一转')),
  '贡献排名同时汇总本局与上一转');
check(await page.$$eval('#rank .rank-last', els => els.length > 0 && els.some(el => /上转 \+\d+/.test(el.textContent))),
  '每行显示上一转贡献');
check(await page.$eval('#rank-box', el => !el.open), '排名面板默认折叠');

// 选第一个
const poolBefore = await page.$$eval('#pool .pool-chip', els => els.length);
const chosenName = await page.$eval('.choice .nm', el => el.textContent);
await page.click('.choice');
await new Promise(r => setTimeout(r, 150));
check(await page.$eval('#modal-layer', el => el.style.display) === 'none', '选择后弹窗关闭');
check(await page.$eval('#hud-spins', el => el.textContent) === '4', '剩余转数递减到 4');
const poolAfter = await page.$$eval('#pool .pool-chip', els => els.length);
check(poolAfter >= poolBefore, '卡池不减少（选新符号会增加）');
const gridNames = await page.$$eval('#reel .cell:not(.empty) .nm', els => els.map(e => e.textContent));
check(gridNames.includes(chosenName), `选中的 ${chosenName} 立即填入空格上屏`);
const lit = +(await page.$eval('#dex-count', el => el.textContent).then(t => (t.match(/(\d+)\//) || [])[1]));
check(lit >= 3, `图鉴点亮数 ${lit} >= 3`);

// 第二次转动：完整演出
await page.click('#btn-spin');
await page.waitForFunction(() => document.querySelectorAll('#reel .cell.question').length === 0, { timeout: 3000 });
const seenGain = new Set();
for (let t = 0; t < 45; t++) {
  const texts = await page.$$eval('.float-gain', els => els.map(e => e.textContent));
  texts.forEach(x => seenGain.add(x));
  if (await page.$eval('#modal-layer', el => el.style.display !== 'none')) break;
  await new Promise(r => setTimeout(r, 100));
}
await page.waitForSelector('.modal', { visible: true, timeout: 8000 });
check(seenGain.size > 0, `逐格金币标注出现 ${seenGain.size} 种`);
check([...seenGain].every(x => /^\+\d+/.test(x)), '标注格式为 +数字');
await page.click('.choice');
await new Promise(r => setTimeout(r, 100));

const hasSave = await page.evaluate(() => !!localStorage.getItem('poke-rent-save'));
check(hasSave, 'localStorage 存档写入');

// 注入高金币存档专门测交租流程（开局御三家收益低、租金本次按用户要求未调，
// 真实连转很难在合理步数内攒够首轮房租，与本轮 UI 改动无关）
await page.evaluate(() => {
  localStorage.setItem('poke-rent-save', JSON.stringify({
    saveVersion: 4, seed: 12345, coins: 9999, pool: [1, 4, 7], evolveCount: {}, contrib: {},
    items: [], tokens: { pokeBall: 0, centerPass: 0 }, rentIndex: 0, spinsLeft: 1,
    totalSpins: 0, coffeeUsed: false, postRentOffer: false, phase: 'spinning',
    itemOffer: [], lastGrid: [], lastGain: 0, log: []
  }));
});
await softReload();
if (await page.$eval('#story-layer', el => el.style.display) === 'flex') await page.click('#m-story-start');
check(await page.$eval('#hud-progress', el => el.textContent) === '1/7', '交租前进度 1/7');
await page.click('#btn-spin');
await page.click('#btn-skip');
await page.waitForSelector('#m-pay', { visible: true });
check(await page.$('.choice[data-id]') === null, '交租轮转动后不先弹宝可梦三选一');
await page.click('#m-pay');
await page.waitForSelector('.choice[data-item]', { visible: true });
check(await page.$$eval('.choice[data-item]', els => els.length) === 3, '交租后道具 3 选 1');
check(await page.$$eval('.choice[data-item] .rar', els => els.length) === 3, '道具奖励带稀有度标签');
check(await page.$$eval('.prob-bar', els => els.length) === 1, '道具弹窗顶部统一概率条');
const tk = await page.$eval('#tokens', el => el.textContent);
check(/精灵中心券 ×[2-9]/.test(tk) && /精灵球 ×[1-9]/.test(tk), '交租后发放删除券与刷新球');
check(await page.$eval('#hud-progress', el => el.textContent) === '2/7', '交租一次后进度 2/7');
await page.click('.choice[data-item]');
await page.waitForSelector('.choice[data-id]', { visible: true });
check(await page.$eval('.badge', el => el.textContent.includes('至少非凡')), '交租后的宝可梦三选一在道具之后出现且保留稀有度提升');
await page.click('.choice[data-id]');

// ---- 管理员调试窗口：连点进度 5 次 + 密码 ----
await page.evaluate(() => { window.prompt = () => '1997121'; });
for (let i = 0; i < 5; i++) await page.click('#hud-progress-box');
check(await page.$eval('#debug-layer', el => el.style.display) === 'flex', '连点进度 5 次输入密码后打开调试窗口');
check(await page.$$eval('.debug-cell', els => els.length) === 9, '调试窗口 3×3 网格');
check(await page.$$eval('.debug-chip', els => els.length) === 18, '调试窗口可选 18 只宝可梦');
// 点选小火龙放入中心格
await page.click('.debug-chip[data-id="4"]');
await page.click('.debug-cell.center');
await page.click('#dbg-settle');
check(await page.$eval('#debug-result', el => el.textContent.includes('结算') && el.textContent.includes('金')),
  '调试窗口结算中心格并给出收益');
await page.click('#dbg-close');
check(await page.$eval('#debug-layer', el => el.style.display) === 'none', '调试窗口可关闭');

// ---- 多次联动跳动：一条克制=一次跳动，目标格跟着跳 ----
await page.evaluate(() => {
  const E = window.PR.engine;
  const orig = E.spin;
  E.spin = function (g) {
    E.spin = orig;
    const r = orig(g);
    r.grid = new Array(20).fill(null);
    r.grid[1] = 4; r.grid[6] = 7; r.grid[7] = 37; // 杰尼龟被上下两个火邻居夹住
    r.info = r.grid.map((id, i) => ({
      id: id, count: id === 7 ? 2 : 0, types: id === 7 ? ['火'] : [],
      gain: id === 7 ? 4 : (id ? 1 : 0),
      links: id === 7 ? [
        { kind: 'counter', target: 1, type: 'fire', label: '克火' },
        { kind: 'counter', target: 7, type: 'fire', label: '克火' }
      ] : []
    }));
    r.gain = r.info.reduce((s, x) => s + x.gain, 0);
    return r;
  };
});
await page.click('#btn-spin');
await page.waitForFunction(() => document.querySelectorAll('.float-gain').length >= 2, { timeout: 4000 });
check(await page.$$eval('.float-gain', els => els.filter(el => el.textContent.startsWith('+2')).length) >= 2,
  '克制 2 个邻居显示两次 +2，而不是一次 +4');
check(await page.$$eval('.float-link', els => els.length) === 0 && await page.$$eval('.cell.linked', els => els.length) === 0,
  '目标格不显示「被联动」文字或边框标识');
check(await page.$$eval('#reel .cell', els => els.filter(el => el.querySelector('img.bounce')).length) >= 2,
  '源格与被克制的目标格一起跳动');
await page.click('#btn-skip');
await page.waitForSelector('.modal', { visible: true });
await page.click('#m-hide');
await page.waitForFunction(() => document.getElementById('modal-layer').style.display === 'none', { timeout: 2000 });

// ---- 清除所有存档：两次确认，第二次输入「清除」 ----
await page.evaluate(() => { window.confirm = () => true; window.prompt = () => ''; });
await page.click('#btn-clear-save');
check(await page.evaluate(() => localStorage.getItem('poke-rent-save') !== null), '只过第一道确认时不清除');
await page.evaluate(() => { window.prompt = () => '清除'; });
await page.click('#btn-clear-save');
await new Promise(r => setTimeout(r, 1200)); // 等待 location.reload() 完成
await page.waitForFunction(() => /3\/18/.test(document.getElementById('dex-count').textContent), { timeout: 15000 });
check(await page.evaluate(() => localStorage.getItem('poke-rent-save') === null), '二次确认后本局存档已清空');
check(await page.evaluate(() => localStorage.getItem('poke-rent-tutorial') === null), '新手引导标记已清空');
check(await page.$eval('#tutorial-layer', el => el.style.display) === 'block', '清档后刷新重新先走新手引导');
check(await page.$eval('#dex-count', el => /3\/18/.test(el.textContent)), '清档后图鉴重新从御三家开始点亮');
// 引导已看过时：每次开局仍有故事，但不再出现引导
await page.evaluate(() => { try { localStorage.setItem('poke-rent-tutorial', '1'); } catch (e) {} });
await softReload();
check(await page.$eval('#story-layer', el => el.style.display) === 'flex', '已看过引导后开局仍显示故事弹窗');
check(await page.$eval('#tutorial-layer', el => el.style.display) === 'none', '已看过引导后不再显示新手引导');

check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors.join(' | ') : ''));

await browser.close();
console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
