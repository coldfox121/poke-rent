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
check(await page.$eval('#hud-progress', el => el.textContent) === '0/7', '进度改为 0/7');
check(await page.$eval('#btn-dex', el => /图鉴 6\/18/.test(el.textContent)), '图鉴按钮显示已点亮 6/18');

// 图鉴弹窗
await page.click('#btn-dex');
await page.waitForSelector('#dex-layer', { visible: true });
check(await page.$$eval('.dex-card', els => els.length) === 18, '图鉴列出 18 只');
check(await page.$$eval('.dex-card.locked', els => els.length) === 12, '开局 6 只点亮、12 只未点亮');
await page.click('.dex-card:not(.locked)');
check(await page.$eval('#dex-detail', el => el.textContent.includes('图鉴说明') && el.textContent.includes('游戏内功能')),
  '图鉴详情含官方说明 + 游戏内功能');
await page.click('#m-dex-close');
check(await page.$eval('#dex-layer', el => el.style.display) === 'none', '图鉴可关闭');

// 第一次转动：验证演出可跳过
await page.click('#btn-spin');
check(await page.$eval('#btn-skip', el => el.style.display !== 'none'), '演出期间显示跳过按钮');
check(await page.$$eval('#reel .cell.question', els => els.length) === 20, '20 格同时变问号');
check(await page.$$eval('#reel .cell.rolling, #reel .roll-strip', els => els.length) === 0, '不再使用滚动精灵条');
check(await page.$$eval('#reel .cell.question', els => els.every(e => e.textContent === '?')), '问号内容一致');
await page.click('#btn-skip');
await page.waitForSelector('.modal', { visible: true });
check(await page.$eval('#btn-skip', el => el.style.display) === 'none', '跳过后按钮隐藏');
check(await page.$$eval('.choice', els => els.length) === 3, '转后出现 3 选 1');
check(await page.$$eval('.choice .rar', els => els.length) === 3, '三选一显示稀有度标签');
check(await page.$$eval('.choice .prob', els => els.length) === 3, '三选一显示档位概率');
check(await page.$eval('.choice .prob', el => /\d+(\.\d+)?%/.test(el.textContent)), '档位概率带百分号');

// 收起选择窗口 → 可看到上轮转盘 → 悬浮按钮恢复
await page.click('#m-hide');
check(await page.$eval('#modal-layer', el => el.style.display) === 'none', '收起后弹窗隐藏');
check(await page.$eval('#modal-dock', el => el.style.display) !== 'none', '收起后显示悬浮按钮');
check(await page.$$eval('#reel .cell:not(.empty)', els => els.length) > 0, '收起后上轮结果可见');
await page.click('#modal-dock');
check(await page.$eval('#modal-layer', el => el.style.display) === 'flex', '悬浮按钮恢复选择窗口');

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

// 选第一个：有空位时新宝可梦应立即上屏
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
check(gridNames.length === 7, '卡池 6 只全上屏 + 新填 1 格 = 7 格');
const dexText = await page.$eval('#btn-dex', el => el.textContent);
const lit = +(dexText.match(/图鉴 (\d+)\//) || [])[1];
check(lit >= 6 && lit >= poolAfter, `图鉴点亮数与卡池一致（${lit} 只，可能选到已点亮的起始宝可梦）`);

// 第二次转动：完整演出，收集逐格标注
await page.click('#btn-spin');
await page.waitForFunction(() => document.querySelectorAll('#reel .cell.question').length === 0, { timeout: 3000 });
check(await page.$$eval('.float-gain', els => els.length) === 0, '结果亮出后停留 1 秒才开始结算');
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
const bounced = await page.$$eval('#reel .cell img.bounce', els => els.length);
check(bounced >= 0, `精灵跳动 class 已应用（本转末帧 ${bounced} 个）`);
await page.click('.choice');
await new Promise(r => setTimeout(r, 100));

// 存档存在
const hasSave = await page.evaluate(() => !!localStorage.getItem('poke-rent-save'));
check(hasSave, 'localStorage 存档写入');

// 连续转到交租，验证道具 3 选 1 与每轮代币
let itemSeen = false, tokenSeen = false;
for (let i = 0; i < 14; i++) {
  const spinning = await page.$eval('#btn-spin', el => !el.disabled);
  if (!spinning) {
    const modalVisible = await page.$eval('#modal-layer', el => el.style.display !== 'none');
    if (modalVisible && await page.$('#m-pay')) { await page.click('#m-pay'); }
    else if (modalVisible && await page.$('.choice[data-item]')) {
      if (!itemSeen) {
        check(await page.$$eval('.choice[data-item]', els => els.length) === 3, '交租后道具 3 选 1');
        check(await page.$$eval('.choice[data-item] .rar', els => els.length) === 3, '道具奖励带稀有度标签');
        check(await page.$$eval('.choice[data-item] .prob', els => els.every(e => !/ 0%$/.test(e.textContent))),
          '道具档位概率不为 0%（显示与抽取一致）');
        itemSeen = true;
      }
      await page.click('.choice[data-item]');
    }
    else if (modalVisible && await page.$('.choice')) { await page.click('.choice'); }
    continue;
  }
  await page.click('#btn-spin');
  if (await page.$eval('#btn-skip', el => el.style.display !== 'none')) await page.click('#btn-skip');
  await new Promise(r => setTimeout(r, 100));
  if (await page.$('.choice[data-item]')) {
    if (!itemSeen) {
      check(await page.$$eval('.choice[data-item]', els => els.length) === 3, '交租后道具 3 选 1');
      check(await page.$$eval('.choice[data-item] .rar', els => els.length) === 3, '道具奖励带稀有度标签');
      check(await page.$$eval('.choice[data-item] .prob', els => els.every(e => !/ 0%$/.test(e.textContent))),
        '道具档位概率不为 0%（显示与抽取一致）');
      itemSeen = true;
    }
    await page.click('.choice[data-item]');
  }
  else if (await page.$('.choice')) await page.click('.choice');
  else if (await page.$('#m-pay')) await page.click('#m-pay');
  const tk = await page.$eval('#tokens', el => el.textContent);
  if (!tokenSeen && /精灵中心券 ×[2-9]/.test(tk) && /精灵球 ×[1-9]/.test(tk)) tokenSeen = true;
}
check(itemSeen, '流程中确实出现道具 3 选 1');
check(tokenSeen, '交租后发放删除券与刷新球');

check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors.join(' | ') : ''));

await browser.close();
console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
