/* 账迹 · 解析层
   真能在浏览器里跑：GBK 解码 → ZIP 解包 → CSV/XLSX 解析 → 归一 Transaction → 去重
   支付宝/微信导出格式变化时，只需改 COLMAP 与 isHeader()。 */

/* ---------- GBK 解码（iOS Safari 的 TextDecoder 不支持 gbk，用查找表） ---------- */
let GBK = null;
function ensureGbk() {
  if (GBK) return GBK;
  if (!window.GBK_TABLE_B64) throw new Error('缺少 GBK 表');
  const bin = atob(window.GBK_TABLE_B64);
  const u16 = new Uint16Array(bin.length / 2);
  for (let i = 0; i < u16.length; i++) u16[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
  GBK = u16;
  return GBK;
}
function decodeGbk(bytes) {
  const T = ensureGbk();
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) { out += String.fromCharCode(b); continue; }
    const c = bytes[++i];
    if (c === undefined) { out += '\uFFFD'; break; }
    const row = b - 0x81, col = c < 0x7f ? c - 0x40 : c - 0x41;
    const idx = row * 190 + col;
    out += (idx >= 0 && idx < T.length && T[idx]) ? String.fromCharCode(T[idx]) : '\uFFFD';
  }
  return out;
}
/* 自动判断编码：UTF-8 BOM / GBK 特征 / ASCII */
function decodeAuto(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), enc: 'UTF-8 BOM' };
  const head = b.subarray(0, Math.min(b.length, 4096));
  // 支付宝导出绝大多数是 GBK；UTF-8 中文三字节 0xE4-0xE9 开头，GBK 中文双字节 0xB0-0xF7
  let gbkBad = 0, utf8Bad = 0;
  for (let i = 0; i < head.length; i++) {
    const x = head[i];
    if (x < 0x80) continue;
    if (i + 1 >= head.length) break;
    const y = head[i + 1];
    if (x >= 0xE4 && x <= 0xE9 && y >= 0x80 && y <= 0xBF && i + 2 < head.length) { i += 2; continue; }
    if (x >= 0xB0 && x <= 0xF7 && ((y >= 0xA1 && y <= 0xFE) || (y >= 0x40 && y <= 0x7E))) { gbkBad++; i += 1; continue; }
    utf8Bad++;
  }
  const enc = utf8Bad === 0 && gbkBad === 0 ? 'UTF-8' : (gbkBad > 0 && utf8Bad === 0 ? 'GBK' : (detectUtf8(b) ? 'UTF-8' : 'GBK'));
  return enc === 'GBK' ? { text: decodeGbk(b), enc: 'GBK' } : { text: new TextDecoder('utf-8').decode(b), enc: 'UTF-8' };
}
function detectUtf8(b) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch (e) { return false; }
}

/* ---------- ZIP 解包（Stored + Deflate；支付宝那种带密码的 zip 无法在此解，会给明确提示） ---------- */
async function unzipEntries(buf) {
  return unzip(buf);
}
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const files = [];
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--)
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), flags = dv.getUint16(p + 8, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lh = dv.getUint32(p + 42, true);
    const nameBytes = u8.subarray(p + 46, p + 46 + nlen);
    // zip 未设 UTF-8 标志位（0x800）时，中文名通常是 GBK（支付宝的 zip 就是这样）
    let name;
    if (flags & 0x800) name = new TextDecoder('utf-8').decode(nameBytes);
    else { try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); } catch (e) { name = decodeGbk(nameBytes); } }
    const lnlen = dv.getUint16(lh + 26, true), lelen = dv.getUint16(lh + 28, true);
    const dataAt = lh + 30 + lnlen + lelen;
    if (!(flags & 0x1)) files.push({ name, method, dataAt, csize });
    p += 46 + nlen + elen + clen;
  }
  if (!files.length) throw new Error('encrypted');
  const out = [];
  for (const f of files) {
    const raw = u8.subarray(f.dataAt, f.dataAt + f.csize);
    let bytes;
    if (f.method === 0) bytes = raw;
    else if (f.method === 8) bytes = new Uint8Array(await inflateRaw(raw));
    else throw new Error('暂不支持的压缩方式 ' + f.method);
    out.push({ name: f.name, buf: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
  return out;
}
/* 不依赖 Blob.stream()（部分环境缺失），直接喂 ReadableStream */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function')
    throw new Error('这台设备的 Safari 不支持 zip 解压（需要 iOS 16.4+）。请用「文件」App 解压后导入里面的 CSV。');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Response(new ReadableStream({
    start(c) { c.enqueue(bytes); c.close(); }
  }).pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(await stream);
}

/* ---------- XLSX 最小解析（微信导出用；纯 zip+xml，无需第三方库） ---------- */
const xmlUnesc = s => String(s).replace(/&#x([0-9a-fA-F]+);|&#(\d+);|&lt;|&gt;|&quot;|&apos;|&amp;/g,
  (m, hx, dec, ...rest) => hx !== undefined ? String.fromCodePoint(parseInt(hx, 16))
    : dec !== undefined ? String.fromCodePoint(+dec)
      : ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp': '&' })[m]);

async function parseXlsx(buf) {
  const entries = await unzip(buf);
  const pick = pre => entries.filter(e => e.name.startsWith(pre) && e.name.endsWith('.xml'));
  const txt = e => new TextDecoder('utf-8').decode(e.buf);
  const ss = entries.find(e => e.name === 'xl/sharedStrings.xml');
  const shared = [];
  if (ss) {
    const x = txt(ss);
    for (const si of x.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''));
    }
  }
  const sheetEntry = pick('xl/worksheets/sheet')[0] || entries.filter(e => /xl\/worksheets\/.*\.xml$/.test(e.name))[0];
  if (!sheetEntry) throw new Error('XLSX 里找不到工作表');
  const xml = txt(sheetEntry);
  const rows = [];
  for (const r of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const cells = [];
    for (const c of r.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || []) {
      const ref = (c.match(/r="([A-Z]+)\d+"/) || [])[1];
      const tp = (c.match(/t="([^"]+)"/) || [])[1];
      const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const is = (c.match(/<is>[\s\S]*?<\/is>/) || [])[0];
      let val = '';
      if (tp === 's' && v !== undefined) val = xmlUnesc(shared[+v] || '');
      else if (tp === 'inlineStr' && is) val = xmlUnesc((is.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
      else if (is) val = xmlUnesc((is.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
      else if (v !== undefined) val = xmlUnesc(v);
      else if (tp === 'str') val = xmlUnesc((c.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
      const ci = colIdx(ref);
      if (ci >= 0) { while (cells.length < ci) cells.push(''); cells[ci] = val; }
    }
    rows.push(cells);
  }
  return rows;
}
function colIdx(ref) {
  if (!ref) return -1;
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ---------- CSV ---------- */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.trim()); if (row.some(x => x !== '')) rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* skip */ }
    else cell += c;
  }
  row.push(cell.trim());
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

/* ---------- 列名映射 → 统一 Transaction ---------- */
const COLMAP = {
  time: ['交易时间', '时间', '交易发起时间'],
  cat: ['交易分类', '交易类型', '类型'],
  peer: ['交易对方', '商户全称', '对方'],
  desc: ['商品说明', '商品', '商品名称', '说明'],
  dir: ['收/支', '收支方向', '收/支方向'],
  amount: ['金额', '金额(元)', '交易金额', '发生金额'],
  method: ['收/付款方式', '支付方式', '付款方式'],
  status: ['交易状态', '当前状态', '状态'],
  no: ['交易单号', '交易订单号', '订单号'],
  note: ['备注', '说明备注']
};
function n0(k) { return { time: '时间', amount: '金额', peer: '交易对方', dir: '收/支', cat: '分类' }[k] || ''; }
function isHeader(r) {
  const s = r.map(x => String(x).replace(/\s/g, '')).join('|');
  return /金额/.test(s) && (/交易时间|时间/.test(s)) && (/收\/支|收支/.test(s) || /交易对方|商户/.test(s));
}
function toNum(s) { const v = parseFloat(String(s).replace(/[^\d.\-]/g, '')); return isFinite(v) ? v : 0; }
function toTime(s) {
  const m = String(s).match(/(\d{4})[^\d]?(\d{1,2})[^\d]?(\d{1,2})[^\d]?(\d{1,2})?:?(\d{2})?:?(\d{2})?/);
  if (!m) return null;
  const [, y, mo, d, hh = '0', mm = '0', ss = '0'] = m;
  return new Date(+y, +mo - 1, +d, +hh, +mm, +ss);
}
const IN = /收入|收款|借入/, OUT = /支出|付款/;
const CLOSED = /交易关闭|已关闭|支付失败|未支付/;   // 不计入收支
const REFUNDED = /已全额退款/;                      // 计入收入（回冲）
const RULES = [
  ['餐饮', /美团|饿了么|星巴克|咖啡|瑞幸|麦当劳|肯德基|饭|吃|外卖|便利|餐/],
  ['交通出行', /滴滴|打车|地铁|公交|12306|火车|机票|航空|飞猪|加油|停车|高铁|骑行|客/],
  ['购物', /淘宝|天猫|京东|拼多多|商场|超市|服饰|鞋|数码|家电|买/],
  ['居住缴费', /电费|水费|燃气|物业|房租|宽带|供暖/],
  ['娱乐休闲', /影|戏|门票|游戏|会员|视频|演出|大麦|K歌/],
  ['医疗', /医院|药|诊|体检/],
  ['教育', /学费|课|培训|书/]
];
function guessCat(t) {
  const s = (t.peer || '') + (t.desc || '') + (t.cat || '');
  for (const [k, re] of RULES) if (re.test(s)) return k;
  return t.cat && t.cat !== '/' ? t.cat : '其他';
}
function rowsToTx(rows, source) {
  const hi = rows.findIndex(isHeader);
  if (hi < 0) return { tx: [], headerAt: -1 };
  const hdr = rows[hi].map(x => String(x).replace(/\s/g, ''));
  const idx = {}; for (const k in COLMAP) idx[k] = hdr.findIndex(h => COLMAP[k].some(n => h === n));
  for (const k of ['amount', 'time']) if (idx[k] < 0) idx[k] = hdr.findIndex(h => h.includes(n0(k)));
  const tx = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const g = k => idx[k] >= 0 ? String(rows[r][idx[k]] ?? '').trim() : '';
    const time = toTime(g('time')); const amount = toNum(g('amount'));
    if (!time || !amount) continue;
    const dirRaw = g('dir'), st = g('status');
    let dir = 'none';
    if (CLOSED.test(st)) dir = 'neutral';                 // 交易关闭 → 不算钱
    else if (REFUNDED.test(st) || /退款|退货/.test(g('desc') + g('cat'))) dir = 'in';
    else if (IN.test(dirRaw)) dir = 'in';
    else if (OUT.test(dirRaw)) dir = 'out';
    const t = {
      time: time.getTime(), amount, dir,
      cat: g('cat'), peer: g('peer'), desc: g('desc'),
      method: g('method'), status: g('status'), src: source
    };
    t.cat = (t.dir === 'in' && /工资|报酬/.test(t.desc + t.peer)) ? '收入' : guessCat(t);
    t.key = t.time + '|' + t.amount + '|' + t.peer;
    tx.push(t);
  }
  return { tx, headerAt: hi + 1, cols: hdr.filter(Boolean) };
}

/* ---------- 入口：任意文件 → Transaction[] ---------- */
async function importFile(file) {
  const buf = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  const log = [];
  const encs = new Set();
  let all = [];

  const feed = (decoded, fileName, fallbackSrc) => {
    encs.add(decoded.enc);
    const rows = parseCsv(decoded.text);
    const src = detectSrc(fileName + ' ' + decoded.text.slice(0, 400)) || fallbackSrc;
    const r = rowsToTx(rows, src);
    if (r.headerAt < 0) { log.push(`跳过 ${fileName || '（zip 内文件）'}：没找到表头行`); return; }
    log.push(`${fileName || '工作表'}［${decoded.enc}］表头第 ${r.headerAt} 行 · ${r.cols.length} 列 · ${r.tx.length} 笔（${src}）`);
    all = all.concat(r.tx);
  };

  if (name.endsWith('.xlsx')) {
    const rows = await parseXlsx(buf);
    const r = rowsToTx(rows, detectSrc(file.name) || '微信');
    if (r.headerAt < 0) throw new Error('XLSX 中未识别到账单表头');
    encs.add('XLSX');
    log.push(`${file.name}：表头第 ${r.headerAt} 行 · ${r.tx.length} 笔（${r.tx[0]?.src}）`);
    all = r.tx;
  } else if (name.endsWith('.zip')) {
    let entries;
    try { entries = await unzip(buf); }
    catch (e) {
      if (e.message === 'encrypted') throw new Error('这个 ZIP 带密码（支付宝邮件里的那种）。先在「文件」App 里解压，或用电脑解压后导入里面的 CSV。');
      throw e;
    }
    if (!entries.length) throw new Error('ZIP 是空的');
    log.push(`解压出 ${entries.length} 个文件`);
    for (const en of entries) {
      if (!/\.(csv|txt)$/i.test(en.name)) { log.push(`跳过 ${baseName(en.name)}（非 CSV）`); continue; }
      feed(decodeAuto(en.buf), baseName(en.name), detectSrc(file.name) || '导入');
    }
    if (!all.length) throw new Error('ZIP 里没有可识别的账单 CSV');
  } else if (/\.(csv|txt)$/.test(name)) {
    feed(decodeAuto(buf), file.name, '导入');
    if (!all.length) throw new Error('没找到表头行（需含「交易时间 / 金额 / 收\支」列），或全部行的金额都解析失败');
  } else throw new Error('支持 .csv / .txt / .zip / .xlsx');

  return { tx: all, log, enc: [...encs].join(' / ') };
}
function baseName(p) { return p.split(/[\\/]/).pop(); }
function detectSrc(s) {
  if (/alipay|支付宝/i.test(s)) return '支付宝';
  if (/wechat|微信/i.test(s)) return '微信';
  return null;
}

/* 对外暴露 */
if (typeof window !== 'undefined') {
  window.Parse = { importFile, parseCsv, parseXlsx, unzip, decodeAuto, decodeGbk, rowsToTx, isHeader, guessCat, COLMAP, RULES };
}
