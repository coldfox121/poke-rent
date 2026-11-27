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

check(await page.$eval('#hud-coins', el => el.textContent) === '1', '初始金币 1');
check(await page.$$eval('#reel .cell', els => els.length) === 20, '20 格网格');
check(await page.$$eval('#pool .pool-chip', els => els.length) === 6, '初始卡池 6 只');

// 第一次转动：验证演出可跳过
await page.click('#btn-spin');
check(await page.$eval('#btn-skip', el => el.style.display !== 'none'), '演出期间显示跳过按钮');
check(await page.$$eval('#reel .cell.rolling', els => els.length) === 20, '20 格进入翻滚动画');
await page.click('#btn-skip');
await page.waitForSelector('.modal', { visible: true });
check(await page.$eval('#btn-skip', el => el.style.display) === 'none', '跳过后按钮隐藏');
check(await page.$$eval('.choice', els => els.length) === 3, '转后出现 3 选 1');

// 验证精灵图加载成功
const imgOk = await page.$$eval('#reel .cell img', imgs =>
  imgs.length > 0 && imgs.every(img => img.complete && img.naturalWidth > 0)
);
check(imgOk, '转动后精灵图全部加载成功');

// 贡献排名
check(await page.$$eval('#rank .rank-row', els => els.length) > 0, '贡献排名有记录');
check(await page.$eval('#rank-box', el => !el.open), '排名面板默认折叠');
const rankTotal = await page.$eval('#rank-total', el => +el.textContent);
check(rankTotal > 0, `贡献总金币 ${rankTotal} > 0`);

// 选第一个
const poolBefore = await page.$$eval('#pool .pool-chip', els => els.length);
await page.click('.choice');
await new Promise(r => setTimeout(r, 150));
check(await page.$eval('#modal-layer', el => el.style.display) === 'none', '选择后弹窗关闭');
check(await page.$eval('#hud-spins', el => el.textContent) === '4', '剩余转数递减到 4');
const poolAfter = await page.$$eval('#pool .pool-chip', els => els.length);
check(poolAfter >= poolBefore, '卡池不减少（选新符号会增加）');

// 第二次转动：完整演出，收集逐格标注
await page.click('#btn-spin');
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
const beatLabels = [...seenGain].filter(x => x.includes('克'));
check(beatLabels.every(x => /克.+ ×\d+/.test(x)), '克制标注格式为「克X ×N」');
await page.click('.choice');
await new Promise(r => setTimeout(r, 100));

// 存档存在
const hasSave = await page.evaluate(() => !!localStorage.getItem('poke-rent-save'));
check(hasSave, 'localStorage 存档写入');

// 连续转到交租
for (let i = 0; i < 6; i++) {
  const spinning = await page.$eval('#btn-spin', el => !el.disabled);
  if (!spinning) {
    const modalVisible = await page.$eval('#modal-layer', el => el.style.display !== 'none');
    if (modalVisible && await page.$('#m-pay')) { await page.click('#m-pay'); }
    else if (modalVisible && await page.$('.choice')) { await page.click('.choice'); }
    continue;
  }
  await page.click('#btn-spin');
  if (await page.$eval('#btn-skip', el => el.style.display !== 'none')) await page.click('#btn-skip');
  await new Promise(r => setTimeout(r, 100));
  if (await page.$('.choice')) await page.click('.choice');
  else if (await page.$('#m-pay')) await page.click('#m-pay');
  else if (await page.$('#m-take')) await page.click('#m-take');
}

check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors.join(' | ') : ''));

await browser.close();
console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
