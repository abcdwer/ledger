/* 账迹 · 应用层（状态 / 存储 / 渲染 / 导入 / PWA） */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const money = n => '¥' + (n || 0).toLocaleString('zh-Hans', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = n => (n || 0).toLocaleString('zh-Hans', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const KEY = 'ledger.tx.v1', SET = 'ledger.settings.v1';

  const CAT = {
    '餐饮': ['#ff9500', '吃'], '交通出行': ['#007aff', '行'], '购物': ['#ff2d55', '购'],
    '居住缴费': ['#af52de', '住'], '娱乐休闲': ['#5ac8fa', '玩'], '医疗': ['#34c759', '医'],
    '教育': ['#5856d6', '教'], '收入': ['#34c759', '薪'], '转账': ['#8e8e93', '转'], '其他': ['#8e8e93', '他']
  };
  const SRC_COLOR = { '支付宝': '#007aff', '微信': '#34c759', '手动': '#8e8e93', '导入': '#ff9500' };
  const colorOf = c => (CAT[c] || CAT['其他'])[0];
  const glyphOf = c => (CAT[c] || CAT['其他'])[1];

  let TX = [], settings = { theme: 'auto', demoMonth: null, hasReal: false };
  let cur = null, filterSrc = '全部', pending = null, tt;

  /* ============ 存储 ============ */
  function load() {
    try { TX = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { TX = []; }
    try { Object.assign(settings, JSON.parse(localStorage.getItem(SET) || '{}')); } catch (e) { }
    if (!TX.length) { TX = demoTx(settings.demoMonth || ym(new Date())); save(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(TX)); localStorage.setItem(SET, JSON.stringify(settings)); }
    catch (e) { toast('本机存储已满，先到「我的」导出备份'); }
  }
  const ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

  /* ============ 演示数据（单月，一眼能核对） ============ */
  function demoTx(mk) {
    const [y, m] = mk.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    const fr = x => { const v = Math.sin(x * 9301 + 49297) * 233280; return v - Math.floor(v); };
    const P = [
      ['美团外卖', '餐饮', 42.5, '外卖订单'], ['星巴克咖啡', '餐饮', 36, 'Starbucks'],
      ['瑞幸咖啡', '餐饮', 9.9, '自提'], ['永和大王', '餐饮', 28, '早餐'],
      ['张亮麻辣烫', '餐饮', 24, '午餐'], ['全家便利店', '购物', 18.9, 'FamilyMart'],
      ['山姆会员商店', '购物', 486.7, '生鲜采购'], ['盒马鲜生', '购物', 127.6, '日常采买'],
      ['淘宝网', '购物', 219, '服饰'], ['京东自营', '购物', 899, '数码配件'],
      ['滴滴出行', '交通出行', 23.8, '快车'], ['上海地铁', '交通出行', 6, '2 号线'],
      ['中国石化', '交通出行', 320, '加油'], ['飞猪机票', '交通出行', 1280, '上海-成都 MU5401'],
      ['12306', '交通出行', 458, '上海虹桥-南京南'], ['国家电网', '居住缴费', 156.3, '电费代扣'],
      ['物业服务中心', '居住缴费', 380, '物业费'], ['中国电信', '居住缴费', 129, '宽带月租'],
      ['大麦网', '娱乐休闲', 380, '演唱会门票'], ['腾讯视频', '娱乐休闲', 30, '会员续费'],
      ['万达影城', '娱乐休闲', 78, '电影票'], ['三甲医院', '医疗', 264, '门诊挂号'],
      ['连锁药房', '医疗', 48.5, '感冒药'], ['得到App', '教育', 299, '课程']
    ];
    const out = [], salT = new Date(y, m - 1, 5, 10, 0).getTime();
    out.push({ time: salT, amount: 18000, dir: 'in', cat: '收入', peer: 'XX 科技有限公司', desc: '工资', status: '交易成功', src: '手动', key: salT + '|18000|工资' });
    out.push({ time: new Date(y, m - 1, 20, 21, 30).getTime(), amount: 1200, dir: 'in', cat: '收入', peer: '闲鱼买家', desc: '出售旧显示器', status: '交易成功', src: '支付宝', key: 'x1200' });
    for (let i = 0; i < 168; i++) {
      const r = fr(i * 17 + m * 131 + y);
      const p = P[Math.floor(r * P.length) % P.length];
      const day = 1 + Math.floor(fr(i * 31 + y * 7) * dim);
      const hour = 7 + Math.floor(fr(i * 11 + day * 3) * 16);
      const t = new Date(y, m - 1, day, hour, Math.floor(fr(i * 5) * 60)).getTime();
      const amount = Math.round(p[2] * (p[2] > 300 ? .82 + r * .35 : .38 + r * 1.9) * 100) / 100;
      out.push({
        time: t, amount, dir: 'out', cat: p[1], peer: p[0], desc: p[3],
        status: '交易成功', src: i % 3 === 1 ? '微信' : '支付宝', key: t + '|' + amount + '|' + p[0]
      });
    }
    return out.sort((a, b) => a.time - b.time);
  }

  /* ============ 聚合 ============ */
  const monthKey = t => ym(new Date(t));
  const monthLabel = k => (+k.slice(0, 4)) + ' 年 ' + (+k.slice(5)) + ' 月';
  const months = () => [...new Set(TX.map(t => monthKey(t.time)))].sort().reverse();
  const inMonth = k => k === 'all' ? TX : TX.filter(t => monthKey(t.time) === k);
  function agg(rows) {
    let out = 0, inc = 0, n = 0, neutral = 0;
    const cats = {}, days = {}, srcs = {};
    rows.forEach(t => {
      n++; srcs[t.src] = (srcs[t.src] || 0) + 1;
      const dk = new Date(t.time), dk2 = dk.getFullYear() + '-' + String(dk.getMonth() + 1).padStart(2, '0') + '-' + String(dk.getDate()).padStart(2, '0');
      if (t.dir === 'in') { inc += t.amount; return; }
      if (t.dir !== 'out') { neutral++; return; }
      out += t.amount;
      cats[t.cat] = (cats[t.cat] || 0) + t.amount;
      days[dk2] = (days[dk2] || 0) + t.amount;
    });
    return { out, inc, n, neutral, cats, days, srcs };
  }

  /* ============ 渲染 ============ */
  function fillDemoMonths() {
    const sel = $('#demoMonth'); if (!sel) return;
    if (!sel.options.length) {
      const now = new Date(), opts = [];
      for (let i = 0; i < 18; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        opts.push(`<option value="${ym(d)}">${d.getFullYear()} 年 ${d.getMonth() + 1} 月</option>`);
      }
      sel.innerHTML = opts.join('');
    }
    const want = settings.demoMonth || ym(new Date());
    if ([...sel.options].some(o => o.value === want)) sel.value = want;
  }

  function render() {
    const ms = months();
    if (!cur || (cur !== 'all' && !ms.includes(cur))) cur = ms[0] || 'all';
    const rows = inMonth(cur), a = agg(rows);
    $('#monthChips').innerHTML = ms.map(k => `<div class="chip ${k === cur ? 'on' : ''}" data-k="${k}">${(+k.slice(5))}月</div>`).join('')
      + `<div class="chip ${cur === 'all' ? 'on' : ''}" data-k="all">全部</div>`;
    $$('#monthChips .chip').forEach(c => c.onclick = () => { cur = c.dataset.k; render(); });
    $('#rangeTxt').textContent = cur === 'all' ? `全部记录` : monthLabel(cur);

    const isCurMonth = cur === ym(new Date());
    const dim = cur === 'all'
      ? Math.round((Math.max(...TX.map(t => t.time), Date.now()) - Math.min(...TX.map(t => t.time))) / 864e5) + 1
      : new Date(+cur.slice(0, 4), +cur.slice(5), 0).getDate();
    const spendDays = Math.max(Object.keys(a.days).length, 1);
    const elapsed = isCurMonth ? new Date().getDate() : dim;

    $('#totalOut').textContent = money(a.out);
    $('#totalIn').textContent = money(a.inc);
    $('#net').textContent = money(a.inc - a.out);
    $('#cntLine').innerHTML = `${a.n} 笔 · 日均 <b class="t">¥${(a.out / Math.max(isCurMonth ? elapsed : spendDays, 1)).toFixed(0)}</b>`
      + (a.neutral ? ` · 不计收支 ${a.neutral} 笔` : '')
      + (isCurMonth ? `<div class="badge">本月已过 ${elapsed} / ${dim} 天 · 按此节奏预计 ${money(a.out / elapsed * dim)}</div>` : '')
      + (settings.hasReal ? '' : '<div class="badge">演示数据 · 到「导入」换成你的账单</div>');

    const mi = ms.indexOf(cur), prev = ms[mi + 1] ? agg(inMonth(ms[mi + 1])).out : null;
    const mom = $('#mom');
    if (prev > 0 && cur !== 'all' && !isCurMonth) {
      const d = (a.out - prev) / prev * 100;
      mom.className = 'mom ' + (d >= 0 ? 'up' : 'dn');
      mom.textContent = (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + '% 较 ' + (+ms[mi + 1].slice(5)) + ' 月';
      mom.style.display = '';
    } else mom.style.display = 'none';

    fillDemoMonths();
    donut(a); heat(a, cur, dim); trend(ms); srcList(a); list();
    $('#statSummary').textContent = `共 ${TX.length} 笔 · ${ms.length} 个月 · 累计支出 ${money(agg(TX).out)}`;
  }

  function donut(a) {
    const es = Object.entries(a.cats).sort((x, y) => y[1] - x[1]);
    const R = 46, C = 2 * Math.PI * R;
    let off = 0, s = `<circle cx="59" cy="59" r="${R}" fill="none" stroke="var(--line)" stroke-width="13"/>`;
    es.forEach(([k, v]) => {
      const len = a.out ? Math.max(v / a.out * C - 1.6, 0) : 0;
      s += `<circle cx="59" cy="59" r="${R}" fill="none" stroke="${colorOf(k)}" stroke-width="13" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"/>`;
      off += len + 1.6;
    });
    $('#donut').innerHTML = s;
    $('#donutTotal').textContent = money(a.out);
    $('#centerTxt').textContent = es.length + ' 类';
    $('#legend').innerHTML = es.slice(0, 8).map(([k, v]) =>
      `<div class="i"><span class="dot" style="background:${colorOf(k)}"></span>${esc(k)}<span class="v t">${num(v)}</span></div>`).join('')
      || '<div class="p" style="padding:8px 0">这个月还没有支出</div>';
  }

  function heat(a, mk, dim) {
    const mx = Math.max(...Object.values(a.days), 1);
    let first, start;
    if (mk === 'all') {
      const ks = Object.keys(a.days).sort();
      if (!ks.length) { $('#heat').innerHTML = '<div class="p">无数据</div>'; $('#dayInfo').classList.add('hidden'); return; }
      first = new Date(ks[0] + 'T00:00:00'); start = (first.getDay() + 6) % 7;
      dim = Math.min(dim, 90);
    } else { first = new Date(+mk.slice(0, 4), +mk.slice(5) - 1, 1); start = (first.getDay() + 6) % 7; }
    const keys = Array.from({ length: dim }, (_, i) => {
      const d = new Date(first.getFullYear(), first.getMonth(), 1 + i);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    });
    let h = Array.from({ length: start }, () => '<div class="h void"></div>').join('');
    keys.forEach(k => {
      const v = a.days[k] || 0;
      const al = v ? (.16 + Math.min(v / mx, 1) * .82).toFixed(2) : null;
      h += `<div class="h" ${al ? `style="background:rgba(255,149,0,${al})"` : ''} data-k="${k}" data-v="${v.toFixed(2)}"></div>`;
    });
    $('#heat').innerHTML = h;
    $$('#heat .h:not(.void)').forEach(e => e.onclick = () => {
      $$('#heat .h').forEach(x => x.classList.remove('sel')); e.classList.add('sel');
      const day = e.dataset.k, rows = TX.filter(t => dayKey(t) === day);
      $('#dayInfo').classList.remove('hidden');
      $('#dayT').textContent = day + ' · ' + money(+e.dataset.v);
      $('#dayP').textContent = rows.length
        ? rows.slice(0, 4).map(t => `${t.peer} ${t.amount.toFixed(2)}`).join('　') + (rows.length > 4 ? `　…共 ${rows.length} 笔` : '')
        : '这天没有支出';
    });
    ['l1', 'l2', 'l3'].forEach((id, i) => { const el = $('#' + id); if (el) el.style.background = `rgba(255,149,0,${.3 + i * .28})`; });
  }
  const dayKey = t => { const d = new Date(t.time); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function trend(ms) {
    const pts = ms.slice(0, 6).reverse().map(k => ({ k, v: agg(inMonth(k)).out }));
    const W = 320, H = 112, mx = Math.max(...pts.map(p => p.v), 1) * 1.18;
    const co = pts.map((p, i) => [16 + i * (W - 32) / Math.max(pts.length - 1, 1), H - p.v / mx * (H - 14)]);
    const d = co.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    $('#trend').innerHTML = pts.length < 2 ? '' :
      `<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--blue)" stop-opacity=".25"/><stop offset="1" stop-color="var(--blue)" stop-opacity="0"/></linearGradient></defs>
       ${[.3, .6, .9].map(f => `<line x1="0" y1="${(H * f).toFixed(0)}" x2="${W}" y2="${(H * f).toFixed(0)}" stroke="var(--line)" stroke-dasharray="3 4"/>`).join('')}
       <path d="${d} L${co.at(-1)[0].toFixed(1)} ${H} L${co[0][0].toFixed(1)} ${H}Z" fill="url(#tg)"/>
       <path d="${d}" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
       ${co.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === co.length - 1 ? 4.5 : 2.5}" fill="${i === co.length - 1 ? 'var(--blue)' : 'var(--card)'}" stroke="var(--blue)" stroke-width="2"/>`).join('')}`;
    $('#trendX').innerHTML = pts.map(p => `<span>${+p.k.slice(5)}月</span>`).join('');
    $('#trendHint').textContent = pts.length < 2 ? '· 需要至少两个月数据' : '';
  }

  function srcList(a) {
    const es = Object.entries(a.srcs).sort((x, y) => y[1] - x[1]);
    $('#srcStats').innerHTML = es.map(([k, n]) =>
      `<div class="src"><span class="dot" style="background:${SRC_COLOR[k] || '#8e8e93'}"></span>${esc(k)}<span class="cnt">${n} 笔 · ${esc(pct(n, es.reduce((s, e) => s + e[1], 0)))}</span></div>`).join('')
      + `<div class="p" style="margin-top:10px">全部记录存在这台设备的 localStorage（约 ${kb()}），不经过任何服务器。</div>`;
  }
  const pct = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '0%';
  function kb() { const n = JSON.stringify(TX).length / 1024; return n > 1024 ? (n / 1024).toFixed(1) + ' MB' : n.toFixed(0) + ' KB'; }

  function list() {
    const srcs = ['全部', ...new Set(TX.map(t => t.src))];
    if (!srcs.includes(filterSrc)) filterSrc = '全部';
    $('#srcChips').innerHTML = srcs.map(s => `<div class="chip ${s === filterSrc ? 'on' : ''}" data-s="${s}">${esc(s)}</div>`).join('');
    $$('#srcChips .chip').forEach(c => c.onclick = () => { filterSrc = c.dataset.s; list(); });
    const rows = inMonth(cur).filter(t => filterSrc === '全部' || t.src === filterSrc).sort((a, b) => b.time - a.time);
    const LIM = 300;
    $('#listCount').textContent = `${rows.length} 笔 · 净额 ${money(rows.reduce((s, t) => s + (t.dir === 'in' ? t.amount : t.dir === 'out' ? -t.amount : 0), 0))}`;
    let last = '';
    $('#txList').innerHTML = rows.slice(0, LIM).map(t => {
      const d = new Date(t.time);
      const dk = d.toLocaleDateString('zh-Hans', { month: '2-digit', day: '2-digit', weekday: 'short' });
      const grp = dk !== last ? `<div class="grp">${last = dk}</div>` : '';
      const sc = SRC_COLOR[t.src] || '#8e8e93';
      const sign = t.dir === 'in' ? '+' : t.dir === 'out' ? '−' : '';
      return grp + `<div class="tx"><div class="ic" style="background:${colorOf(t.cat)}">${glyphOf(t.cat)}</div>
        <div class="g"><div class="n">${esc(t.peer || t.desc || t.cat)}</div>
        <div class="s"><span class="tag" style="background:${sc}22;color:${sc}">${esc(t.src)}</span>${esc(t.desc || t.cat)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</div></div>
        <div class="a t" style="color:${t.dir === 'in' ? 'var(--green)' : t.dir === 'out' ? 'var(--ink)' : 'var(--sub)'}">${sign}${t.amount.toFixed(2)}</div></div>`;
    }).join('') + (rows.length > LIM ? `<div class="p" style="padding:10px 4px">仅显示前 ${LIM} 笔，其余可在「我的」导出 CSV 查看</div>` : '')
      || '<div class="p" style="padding:14px 4px">这个范围还没有记录</div>';
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ============ 导入 ============ */
  async function handleFiles(files) {
    const fs = [...files]; if (!fs.length) return;
    $('#progWrap').classList.remove('hidden'); $('#resCard').classList.add('hidden');
    $('#prog').style.width = '15%'; $('#progT').textContent = '读取 ' + fs.map(f => f.name).join('、');
    const all = [], logs = [], errs = [];
    for (const f of fs) {
      $('#prog').style.width = '50%'; $('#progT').textContent = `解析 ${f.name}（${(f.size / 1024).toFixed(0)} KB）…`;
      try { const r = await window.Parse.importFile(f); all.push(...r.tx); logs.push(...r.log); }
      catch (e) { errs.push(`${f.name}：${e.message}`); }
    }
    // 先批内去重，再与已有记录比对：一次选两个月份重叠的文件不应该重复计数
    const seen = new Set(), uniq = [];
    for (const t of all) { const k = t.key || (t.time + '|' + t.amount + '|' + t.peer); if (seen.has(k)) continue; seen.add(k); uniq.push(t); }
    const dupInBatch = all.length - uniq.length;
    const keys = new Set(TX.map(t => t.key || (t.time + '|' + t.amount + '|' + t.peer)));
    const fresh = uniq.filter(t => !keys.has(t.key));
    const dup = uniq.length - fresh.length;
    $('#prog').style.width = '100%';
    $('#progT').textContent = `完成 · 解析 ${all.length} 笔，新增 ${fresh.length} 笔`;
    pending = fresh;
    $('#resList').innerHTML =
      logs.map(l => `<div class="src"><span class="dot" style="background:var(--blue)"></span>${esc(l)}</div>`).join('')
      + (dupInBatch ? `<div class="src"><span class="dot" style="background:var(--purple)"></span>本次文件之间重复<span class="cnt">${dupInBatch} 笔</span></div>` : '')
      + (dup ? `<div class="src"><span class="dot" style="background:var(--sepia)"></span>与已有记录重复，已跳过<span class="cnt">${dup} 笔</span></div>` : '')
      + errs.map(e => `<div class="src"><span class="dot" style="background:var(--red)"></span><span class="err">${esc(e)}</span></div>`).join('')
      + `<div class="p" style="margin-top:10px">新增 <b>${fresh.length}</b> 笔，时间跨度 ${spanOf(fresh)}。原始文件不会被保存，只留结构化记录。</div>`;
    $('#btnConfirm').textContent = fresh.length ? `确认导入 ${fresh.length} 笔` : '没有可导入的新记录';
    $('#btnConfirm').disabled = !fresh.length;
    $('#resCard').classList.remove('hidden');
  }
  function spanOf(rows) {
    if (!rows.length) return '—';
    const t = rows.map(r => r.time).sort((a, b) => a - b);
    return new Date(t[0]).toLocaleDateString('zh-Hans') + ' → ' + new Date(t.at(-1)).toLocaleDateString('zh-Hans');
  }

  /* ============ 主题 / PWA ============ */
  function applyTheme() {
    const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark', dark);
    $('#themeBtn').textContent = dark ? '☀' : '◐';
    const m = $('meta[name=theme-color]'); if (m) m.setAttribute('content', dark ? '#000000' : '#f2f2f7');
    const ms = document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]');
    if (ms) ms.setAttribute('content', dark ? 'black-translucent' : 'default');
  }
  function cycleTheme() {
    settings.theme = settings.theme === 'auto' ? 'dark' : settings.theme === 'dark' ? 'light' : 'auto';
    applyTheme(); save(); toast('主题：' + { auto: '跟随系统', dark: '深色', light: '浅色' }[settings.theme]);
  }
  function setupPwa() {
    const solo = matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    document.body.classList.toggle('standalone', !!solo);
    $('#iosHint').classList.toggle('hidden', solo || !isIos() || localStorage.getItem('hideHint'));
    let deferred = null;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); deferred = e;
      $('#installBar').classList.remove('hidden');
      $('#installGo').onclick = () => { deferred.prompt(); deferred.userChoice.then(() => $('#installBar').classList.add('hidden')); };
    });
    window.addEventListener('appinstalled', () => { $('#installBar').classList.add('hidden'); toast('已安装'); });
  }
  const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function exportCsv() {
    if (!TX.length) return toast('还没有记录');
    const head = ['交易时间', '金额', '收/支', '分类', '交易对方', '商品说明', '状态', '来源'];
    const body = TX.slice().sort((a, b) => a.time - b.time).map(t => [
      new Date(t.time).toLocaleString('zh-Hans'), t.amount.toFixed(2),
      t.dir === 'in' ? '收入' : t.dir === 'out' ? '支出' : '中性', t.cat, t.peer, t.desc, t.status, t.src
    ].map(x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + head.join(',') + '\r\n' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = `账迹-备份-${dayKey({ time: Date.now() })}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('已导出 ' + TX.length + ' 笔 CSV');
  }
  function toast(m) { const el = $('#toast'); el.textContent = m; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 2300); }

  /* ============ 启动 ============ */
  function boot() {
    load(); applyTheme(); setupPwa(); render();
    $$('.tab').forEach(t => t.onclick = () => {
      $$('.tab').forEach(x => x.classList.remove('on')); t.classList.add('on');
      $$('.pane').forEach(p => p.classList.toggle('hidden', p.id !== 'p' + t.dataset.p));
    });
    $('#themeBtn').onclick = cycleTheme;
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => settings.theme === 'auto' && applyTheme());
    $('#drop').onclick = () => $('#file').click();
    // 必须先把 FileList 拷成数组：input.value='' 会同步清空它，异步解析就会拿到空列表
    $('#file').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; handleFiles(fs); };
    $('#drop').addEventListener('dragover', e => { e.preventDefault(); $('#drop').style.borderColor = 'var(--blue)'; });
    $('#drop').addEventListener('dragleave', () => $('#drop').style.borderColor = '');
    $('#drop').addEventListener('drop', e => { e.preventDefault(); $('#drop').style.borderColor = ''; handleFiles(e.dataTransfer.files); });
    $('#btnConfirm').onclick = () => {
      if (!pending || !pending.length) return;
      TX = TX.concat(pending).sort((a, b) => a.time - b.time);
      settings.hasReal = true; settings.demo = false; save();
      pending = null; $('#resCard').classList.add('hidden'); $('#progWrap').classList.add('hidden');
      render(); toast(`已写入 ${TX.length} 笔，统计已更新`);
      $('.tab[data-p="0"]').click();
    };
    $('#btnDemo').onclick = () => {
      const mk = $('#demoMonth').value || ym(new Date());
      TX = demoTx(mk); settings.demoMonth = mk; settings.hasReal = false; cur = null; save(); render();
      toast('演示数据：' + monthLabel(mk) + ' · ' + TX.length + ' 笔');
    };
    $('#btnClear').onclick = () => {
      if (!TX.length) return toast('本来就是空的');
      if (!confirm(`清空本机 ${TX.length} 笔记录？建议先去「我的」导出 CSV 备份。`)) return;
      TX = []; settings.hasReal = false; settings.demoMonth = ym(new Date()); cur = null; save(); render(); toast('已清空');
    };
    $('#btnExport').onclick = exportCsv;
    $('#btnHideHint').onclick = () => { localStorage.setItem('hideHint', '1'); $('#iosHint').classList.add('hidden'); };
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
