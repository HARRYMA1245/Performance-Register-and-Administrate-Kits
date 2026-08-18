/* 客户档案管家 · 独立网页版(H5)
 * 后端: 微信云开发 云函数 api(HTTP 触发器) + clients 集合
 */
(function () {
'use strict';

const API_BASE = 'https://blue-sky-reg-d5gcvp66235b47382-1465861599.ap-shanghai.app.tcloudbase.com/';

/* ================= 工具 ================= */
function $(s) { return document.querySelector(s); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function pad(n) { return n < 10 ? '0' + n : n; }
function fmtDT(d) { if (!d) return ''; var dt = new Date(d); return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes()); }
function todayKey() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtMD(t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); }
function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmtMoney(v) { v = v || 0; if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿'; if (v >= 10000) return (v / 10000).toFixed(1) + '万'; return String(Math.round(v)); }
function toast(msg, ms) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, ms || 2000); }
function newId() { return 'C' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36); }
function lsGet(k, fb) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function isStrongPassword(p) { return typeof p === 'string' && p.length >= 6 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[^A-Za-z0-9]/.test(p); }
var PWD_RULE_MSG = '密码需6位以上,含大小写字母和特殊字符';

/* ================= API ================= */
function getToken() { return localStorage.getItem('wb_card_token') || ''; }
function setToken(t) { localStorage.setItem('wb_card_token', t || ''); }
function api(method, path, body) {
  var sep = path.indexOf('?') >= 0 ? '&' : '?', url = API_BASE + path + sep + 'token=' + encodeURIComponent(getToken());
  return fetch(url, { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() }, body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body || {}) })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (r.status >= 200 && r.status < 300) return d; throw new Error(d.error || ('请求失败(' + r.status + ')')); }); })
    .catch(function (e) { if (e.message === 'Failed to fetch') throw new Error('无法连接云服务'); throw e; });
}

/* ================= 会话 ================= */
var Session = { get: function () { return lsGet('wb_card_session', null); }, set: function (role, id, name) { lsSet('wb_card_session', { role: role, staffId: id, staffName: name }); }, clear: function () { localStorage.removeItem('wb_card_session'); setToken(''); } };

/* ================= 开卡常量 ================= */
var CLIENT_TYPES = [
  { value: '短期过渡型', desc: '三个月内需用钱买房,资金留不住' },
  { value: '观望等待型', desc: '有购房意愿但无明确时间,可中期留存' },
  { value: '长期留存型', desc: '暂无购房计划,资金可长期配置' },
  { value: '高净值型', desc: '托管金额>300万或他行VIP,可做私行方案' },
  { value: '其他', desc: '需在备注中说明具体情况' }
];
var OPT = {
  channel: ['营销经纪人', 'SOHO驻点', '光大通线索', '厅堂接待', '转介绍', '小渠道营销', '其他'],
  claimStatus: ['已认领', '未认领', '无需认领'],
  currentStatus: ['待办卡', '待入金', '待填客户号', '待转介', '留存财富客户', '留存5-50万', '已转出', '已调整管户归属'],
  retentionProduct: ['活期', '定存', '大额存单', '理财产品', '结构性存款', '基金', '保险', '组合配置'],
  vipPotential: ['潜在600万以上', '潜在100万-600万', '潜在50万-100万', '潜在20万-50万', '其他'],
  riskPreference: ['无风评', '谨慎型', '稳健型', '平衡型', '进取型', '激进型']
};
var PROGRESS_ITEMS = [{ key: 'queryClientNo', label: '查询客户号' }, { key: 'adjustLimit', label: '调整限额' }, { key: 'claimRelation', label: '认领关系' }, { key: 'fundRetention', label: '资金留存' }, { key: 'wecomBind', label: '企微绑定' }, { key: 'expiryFollowup', label: '到期跟进' }];
function emptyProgress() { var p = {}; PROGRESS_ITEMS.forEach(function (i) { p[i.key] = false; }); return p; }
function progressCount(p) { if (!p) return 0; return PROGRESS_ITEMS.reduce(function (n, i) { return n + (p[i.key] ? 1 : 0); }, 0); }

function classify(st) { st = st || ''; if (st.indexOf('已转') === 0) return { tag: '已转出', cls: 'red' }; if (st.indexOf('留存') === 0) return { tag: '已留存', cls: 'green' }; if (st.indexOf('待') === 0) return { tag: '进行中', cls: 'blue' }; return { tag: '未跟进', cls: 'amber' }; }
function isRetained(c) { var s = (c.status || {}); return (s.currentStatus || '').indexOf('留存') === 0 || !!s.retentionAmount; }
function isCardDone(c) { var s = (c.status || {}).currentStatus || ''; return s.indexOf('已转') === 0 || s.indexOf('已调整') === 0; }
function isDepositDone(c) { var s = c.status || {}, tn = c.timeNodes || {}; return (s.currentStatus && s.currentStatus.indexOf('待入金') < 0 && s.currentStatus.indexOf('待办卡') < 0 && s.currentStatus.indexOf('待转介') < 0) || !!tn.cardDate; }
function progressOf(c) { var pd = progressCount(c.progress); if (pd >= 6 || isCardDone(c)) return 'done'; return pd > 0 ? 'doing' : 'none'; }

/* ================= 待办系统 ================= */
var TODO_FILTERS = [{ key: 'all', label: '全部' }, { key: 'noClientNo', label: '缺客户号' }, { key: 'noCard', label: '待办卡' }, { key: 'noDeposit', label: '待入金' }, { key: 'noClaim', label: '待认领' }, { key: 'noRetention', label: '待留存' }];
var TODO_META = {
  noClientNo: { label: '缺客户号', cls: 'amber', desc: '请尽快补充客户号' }, noCard: { label: '待办卡', cls: 'blue', desc: '请确认开卡日期是否已过' },
  noDeposit: { label: '待入金', cls: 'blue', desc: '跟踪预计入账日期' }, noClaim: { label: '待认领', cls: 'amber', desc: '请跟进认领状态' }, noRetention: { label: '待留存', cls: 'amber', desc: '跟进留存情况并填报' }
};
function deriveTodos(records) {
  var todos = [];
  (records || []).forEach(function (c) { var b = c.basic || {}, st = c.status || {}, tn = c.timeNodes || {}, cs = st.currentStatus || '', pid = c.id, nm = b.name || '未命名';
    if (!b.clientNo && cs.indexOf('已转') < 0) todos.push({ clientId: pid, clientName: nm, type: 'noClientNo', typeLabel: '缺客户号', cls: 'amber', date: '', desc: '' });
    if (cs.indexOf('待办卡') === 0) todos.push({ clientId: pid, clientName: nm, type: 'noCard', typeLabel: '待办卡', cls: 'blue', date: tn.cardDate || '', desc: '' });
    if (cs.indexOf('待入金') === 0) todos.push({ clientId: pid, clientName: nm, type: 'noDeposit', typeLabel: '待入金', cls: 'blue', date: tn.expectedDepositDate || '', desc: tn.depositDesc || '' });
    if (cs.indexOf('待转介') === 0) todos.push({ clientId: pid, clientName: nm, type: 'noClaim', typeLabel: '待认领', cls: 'amber', date: '', desc: '' });
    if ((cs.indexOf('待填客户号') === 0 || (cs.indexOf('待办卡') < 0 && cs.indexOf('待入金') < 0 && cs.indexOf('待转介') < 0 && cs.indexOf('已转') < 0 && cs.indexOf('留存') < 0 && cs.indexOf('已调整') < 0)) && !st.retentionAmount)
      todos.push({ clientId: pid, clientName: nm, type: 'noRetention', typeLabel: '待留存', cls: 'amber', date: '', desc: '' });
  });
  todos.sort(function (a, b) { return a.date && !b.date ? -1 : !a.date && b.date ? 1 : (a.date || '').localeCompare(b.date || ''); });
  return todos;
}
function todoCounts(todos) { var c = { all: todos.length }; todos.forEach(function (t) { c[t.type] = (c[t.type] || 0) + 1; }); return c; }

/* ================= 统计图表 ================= */
function parseDay(s) { if (!s) return null; var t = new Date(String(s).slice(0, 10) + 'T00:00:00').getTime(); return isNaN(t) ? null : t; }
function topStats(records) {
  var aum = 0, managed = 0, ret = 0;
  records.forEach(function (c) { aum += num(c.status && c.status.aum); managed += num(c.basic && c.basic.managedAmount); if (isRetained(c)) ret++; });
  return { total: records.length, managed: managed, aum: aum, retained: ret };
}
var DAY = 86400000;
function weekly(records) {
  var now = new Date(); now.setHours(0, 0, 0, 0);
  var buckets = [];
  for (var i = 0; i < 8; i++) { var end = now.getTime() - (7 - i) * 7 * DAY; buckets.push({ start: end - 6 * DAY, end: end + DAY - 1, label: fmtMD(end - 6 * DAY), managed: 0, deposit: 0, retention: 0, aum: 0, cntReg: 0, cntDep: 0, cntRet: 0 }); }
  records.forEach(function (c) {
    var b = c.basic || {}, tn = c.timeNodes || {}, st = c.status || {};
    var tReg = parseDay(tn.registerDate) || parseDay(c.createTime), depDone = isDepositDone(c), tDep = parseDay(tn.expectedDepositDate) || (depDone ? parseDay(c.updateTime || c.createTime) : null), retained = isRetained(c), tRet = parseDay(st.retentionReportDate) || (retained ? parseDay(c.updateTime || c.createTime) : null);
    buckets.forEach(function (bk) {
      if (tReg !== null && tReg >= bk.start && tReg <= bk.end) { bk.managed += num(b.managedAmount); bk.aum += num(st.aum); bk.retention += num(st.retentionAmount); bk.cntReg++; }
      if (tDep !== null && tDep >= bk.start && tDep <= bk.end && depDone) { bk.deposit += num(b.managedAmount); bk.cntDep++; }
      if (tRet !== null && tRet >= bk.start && tRet <= bk.end && retained) { bk.cntRet++; }
    });
  });
  return buckets;
}
function funnel(records) {
  var reg = 0, card = 0, dep = 0, ret = 0;
  records.forEach(function (c) { var m = num(c.basic && c.basic.managedAmount); reg += m; if (isCardDone(c)) card += m; if (isDepositDone(c)) dep += m; ret += num(c.status && c.status.retentionAmount); });
  var base = reg || 1;
  return [{ label: '登记', n: reg, pct: Math.round(reg / base * 100) + '%' }, { label: '开卡', n: card, pct: Math.round(card / base * 100) + '%' }, { label: '入金', n: dep, pct: Math.round(dep / base * 100) + '%' }, { label: '留存', n: ret, pct: Math.round(ret / base * 100) + '%' }];
}
function lineGeometry(series, labels, W, H) {
  var padL = 8, padR = 8, padT = 30, padB = 8, n = labels.length, maxV = 1;
  series.forEach(function (s) { s.values.forEach(function (v) { if (v > maxV) maxV = v; }); });
  var stepX = n > 1 ? (W - padL - padR) / (n - 1) : 0, points = [], segments = [];
  series.forEach(function (s) {
    var pts = s.values.map(function (v, i) { return { x: padL + i * stepX, y: padT + (1 - v / maxV) * (H - padT - padB), v: v }; });
    pts.forEach(function (p, i) { points.push({ x: p.x, y: p.y, color: s.color, text: fmtMoney(p.v) }); if (i > 0) { var q = pts[i - 1], dx = p.x - q.x, dy = p.y - q.y; segments.push({ x: q.x, y: q.y, len: Math.sqrt(dx * dx + dy * dy), angle: Math.atan2(dy, dx) * 180 / Math.PI, color: s.color }); } });
  });
  return { points: points, segments: segments, labels: labels, width: W, height: H };
}
function countChart(buckets) {
  var maxV = 1; buckets.forEach(function (b) { maxV = Math.max(maxV, b.cntReg, b.cntDep, b.cntRet); });
  return buckets.map(function (b) { return { label: b.label, bars: [{ name: '登记款', value: b.cntReg, color: '#1f6feb', h: Math.round(b.cntReg / maxV * 100) }, { name: '入金款', value: b.cntDep, color: '#f5a623', h: Math.round(b.cntDep / maxV * 100) }, { name: '留存款', value: b.cntRet, color: '#1c8a4f', h: Math.round(b.cntRet / maxV * 100) }] }; });
}
function normName(s) { return String(s == null ? '' : s).replace(/[\u3000\s]+/g, ''); }
function rankBy(records, getter) {
  var map = {};
  (records || []).forEach(function (c) { var name = normName(getter(c)); if (!name) return; if (!map[name]) map[name] = { name: name, count: 0, managed: 0 }; map[name].count++; map[name].managed += num(c.basic && c.basic.managedAmount); });
  var list = Object.keys(map).map(function (k) { return map[k]; }); list.sort(function (a, b) { return b.count - a.count || b.managed - a.managed; }); return list;
}
function rankTableHtml(rows) {
  if (!rows.length) return '<div class="empty">暂无数据</div>';
  var h = '<div class="rank-head"><span></span><span>姓名</span><span>办理量</span><span>托管合计</span></div>';
  rows.forEach(function (r, i) { h += '<div class="rank-row"><span class="rank-no' + (i < 3 ? ' top' + (i + 1) : '') + '">' + (i + 1) + '</span><span class="rank-name">' + esc(r.name) + '</span><span class="rank-count">' + r.count + '</span><span class="rank-amt">' + fmtMoney(r.managed) + '</span></div>'; });
  return h;
}

/* ================= CSV ================= */
function downloadCSV(filename, rows) {
  var keys = Object.keys(rows[0]), escCell = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var csv = '\ufeff' + keys.join(',') + '\n'; rows.forEach(function (r) { csv += keys.map(function (k) { return escCell(r[k]); }).join(',') + '\n'; });
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
function clientRow(c) {
  return { '姓名': c.basic && c.basic.name, '客户号': c.basic && c.basic.clientNo, '托管金额': c.basic && c.basic.managedAmount, '经办人': c.basic && c.basic.handler,
    '客户类型': c.basic && c.basic.clientType, '登记日期': c.timeNodes && c.timeNodes.registerDate, '开卡日期': c.timeNodes && c.timeNodes.cardDate,
    '预计入账日期': c.timeNodes && c.timeNodes.expectedDepositDate, '限额失效日期': c.timeNodes && c.timeNodes.limitExpiryDate, '入账时间描述': c.timeNodes && c.timeNodes.depositDesc,
    '获客方式': c.acquisition && c.acquisition.channel, '链家签约经理': c.acquisition && c.acquisition.acquirer, '转介理财经理': c.acquisition && c.acquisition.referralManager,
    '认领状态': c.acquisition && c.acquisition.claimStatus, '认领日期': c.acquisition && c.acquisition.claimDate, '当前状态': c.status && c.status.currentStatus,
    '留存产品类型': c.status && c.status.retentionProductType, 'AUM': c.status && c.status.aum, '留存填报日期': c.status && c.status.retentionReportDate,
    '留存量': c.status && c.status.retentionAmount, '他行VIP潜力': c.status && c.status.vipPotential, '风险偏好': c.status && c.status.riskPreference,
    '备注': c.status && c.status.remark, '工作进度': progressCount(c.progress) + '/6', '所属员工': c.staffName, '创建时间': fmtDT(c.createTime), '更新时间': fmtDT(c.updateTime) };
}

/* ================= 状态 ================= */
var State = { clients: [], staffs: [], serverStatus: '' };

/* ================= 路由 ================= */
function route() {
  var hash = location.hash || '#/login', s = Session.get(), pathOnly = hash.slice(1).split('?')[0];
  if (!s && pathOnly !== '/login') { location.hash = '#/login'; return; }
  if (pathOnly === '/login') return renderLogin();
  if (pathOnly === '/staff' && s.role === 'staff') return renderStaff();
  if (pathOnly === '/manager' && s.role === 'manager') return renderManager();
  if (pathOnly === '/form') return renderForm();
  location.hash = s.role === 'manager' ? '#/manager' : '#/staff';
}
window.addEventListener('hashchange', route);

/* ================= 登录页 ================= */
function renderLogin() {
  var params = new URLSearchParams((location.hash.split('?')[1] || '')), showAdmin = params.get('role') === 'manager', preName = params.get('name') || '';
  $('#app').innerHTML =
    '<div class="banner"><div class="t1">开卡客户档案管家</div><div class="t2">开卡业务 · 客户跟进 · 团队协作</div></div>' +
    '<div class="card"><div class="section-title">员工登录</div>' +
    '<div class="form-row"><div class="label">姓名</div><input id="li-name" placeholder="员工姓名" value="' + esc(preName) + '"></div>' +
    '<div class="form-row"><div class="label">密码</div><input id="li-pwd" type="password" placeholder="登录密码"></div>' +
    '<button class="btn btn-primary btn-block" onclick="App.loginStaff()">进入工作台</button></div>' +
    '<div class="card"><div class="section-title">管理员</div>' +
    (showAdmin ? '<div class="form-row"><div class="label">管理密码</div><input id="li-admin" type="password" placeholder="管理密码"></div><button class="btn btn-primary btn-block" onclick="App.loginManager()">进入管理后台</button>'
      : '<button class="btn btn-ghost btn-block" onclick="App.showAdmin()">我是管理员</button>') + '</div>' +
    '<div class="card"><div class="section-title">云服务状态</div><div class="muted" id="li-status">检测中…</div></div>';
  api('GET', '/api/health').then(function (r) { var el = $('#li-status'); if (el) el.textContent = r && r.ok ? '✅ 云服务已连接' : '⚠️ 响应异常'; }).catch(function (e) { var el = $('#li-status'); if (el) el.textContent = '❌ ' + e.message; });
}

/* ================= 员工工作台 ================= */
var staffTodoFilter = 'all';
var staffTodoExpanded = false;
function renderStaff() {
  var s = Session.get(), cacheKey = 'wb_card_s_' + s.staffId;
  api('GET', '/api/clients').then(function (list) { State.clients = list; lsSet(cacheKey, list); State.serverStatus = '✅ 已与云端同步'; drawStaff(); })
    .catch(function (e) { State.clients = lsGet(cacheKey, []); State.serverStatus = '⚠️ ' + e.message + '(显示本机缓存)'; drawStaff(); });
}
function drawStaff() {
  var s = Session.get(), mine = State.clients.slice().sort(function (a, b) { return (b.updateTime || '').localeCompare(a.updateTime || ''); }), today = todayKey(), todayCount = 0, retainedCount = 0;
  mine.forEach(function (c) { if (String(c.createTime || '').slice(0, 10) === today) todayCount++; if (isRetained(c)) retainedCount++; });
  var todos = deriveTodos(mine), counts = todoCounts(todos), showTodos = staffTodoFilter === 'all' ? todos : todos.filter(function (t) { return t.type === staffTodoFilter; });
  var showTodoList = staffTodoExpanded ? showTodos : showTodos.slice(0, 5);

  var h = '<div class="profile"><div class="avatar">' + esc((s.staffName || '员')[0]) + '</div>' +
    '<div><div class="name">' + esc(s.staffName) + '</div><div class="sub">开卡员工 · ID ' + esc(s.staffId) + '</div></div>' +
    '<button class="mini-btn" onclick="App.logout()">退出登录</button></div>' +
    '<div class="sync-bar">' + esc(State.serverStatus) + '</div>' +
    '<div class="kpi-grid"><div class="kpi"><div class="num">' + mine.length + '</div><div class="label">我的客户</div></div><div class="kpi"><div class="num">' + todayCount + '</div><div class="label">今日新增</div></div><div class="kpi"><div class="num green">' + retainedCount + '</div><div class="label">已留存</div></div></div>';

  h += '<div class="card"><div class="subline">待办事项<span class="muted">' + todos.length + ' 项</span></div><div class="chips">';
  TODO_FILTERS.forEach(function (f) { h += '<button class="chip' + (staffTodoFilter === f.key ? ' on' : '') + '" onclick="App.staffTodoFilter(\'' + f.key + '\')">' + f.label + (counts[f.key] ? '<span class="chip-n">' + counts[f.key] + '</span>' : '') + '</button>'; });
  h += '</div>';
  if (showTodoList.length) { showTodoList.forEach(function (t) { h += '<div class="todo-item" onclick="App.openForm(\'' + t.clientId + '\')"><div class="todo-head"><span class="tag ' + t.cls + '">' + t.typeLabel + '</span><span class="todo-name">' + esc(t.clientName) + '</span><span class="todo-date">' + esc(t.date) + '</span></div><div class="muted">' + esc(t.desc) + '</div></div>'; }); }
  else { h += '<div class="empty">暂无待办 🎉</div>'; }
  if (showTodos.length > 5) h += '<button class="btn btn-ghost btn-block" style="margin-top:6px" onclick="App.toggleStaffTodo()">' + (staffTodoExpanded ? '收起' : '展开全部 ' + showTodos.length + ' 项') + '</button>';
  h += '</div>';

  h += '<div class="card"><div class="subline">客户列表<span class="muted">共 ' + mine.length + ' 条</span></div>';
  if (mine.length) { mine.forEach(function (c) { var b = c.basic || {}, st = c.status || {}, tag = classify(st.currentStatus), pd = progressCount(c.progress), amts = [];
    if (num(b.managedAmount)) amts.push('托管¥' + fmtMoney(num(b.managedAmount))); if (num(st.aum)) amts.push('AUM¥' + fmtMoney(num(st.aum)));
    h += '<div class="list-item" onclick="App.openForm(\'' + c.id + '\')"><div style="flex:1;min-width:0"><div style="font-weight:600">' + esc(b.name) + '<span class="prog-badge' + (pd === 6 ? ' full' : '') + '">进度 ' + pd + '/6</span></div>' +
      '<div class="meta"><span class="tag ' + tag.cls + '">' + tag.tag + '</span>' + esc(b.clientNo || '无客户号') + ' · 经办 ' + esc(b.handler || '—') + '</div>' + (amts.length ? '<div class="meta" style="color:#1f6feb">' + amts.join(' · ') + '</div>' : '') + '</div><div class="meta">' + fmtDT(c.updateTime) + '</div></div>'; });
  } else { h += '<div class="empty">还没有客户记录,点右下角 + 开始第一条</div>'; }
  h += '</div><div class="btn-row"><button class="btn btn-ghost" onclick="App.exportMine()">导出我的 CSV</button><button class="btn btn-ghost" onclick="App.openPwd()">修改密码</button></div><div class="fab" onclick="App.openForm(\'\')">＋</div>';
  $('#app').innerHTML = h;
}

/* ================= 客户表单 ================= */
var Form = null;
function renderForm() {
  var s = Session.get(), params = new URLSearchParams((location.hash.split('?')[1] || '')), id = params.get('id') || '', readOnly = s.role === 'manager', existing = id ? State.clients.find(function (c) { return c.id === id; }) : null;
  Form = { id: id, readOnly: readOnly, staffId: existing ? existing.staffId : s.staffId, staffName: existing ? existing.staffName : s.staffName,
    basic: Object.assign({ name: '', clientNo: '', managedAmount: '', handler: '', clientType: '' }, existing && existing.basic),
    timeNodes: Object.assign({ registerDate: '', cardDate: '', expectedDepositDate: '', limitExpiryDate: '', depositDesc: '' }, existing && existing.timeNodes),
    acquisition: Object.assign({ channel: '', acquirer: '', referralManager: '', claimStatus: '未认领', claimDate: '' }, existing && existing.acquisition),
    status: Object.assign({ currentStatus: '', retentionProductType: '', aum: '', retentionReportDate: '', retentionAmount: '', vipPotential: '', riskPreference: '', remark: '' }, existing && existing.status),
    progress: Object.assign(emptyProgress(), existing && existing.progress) };
  var dis = readOnly ? ' disabled' : '';
  function sel(f, opts, cur) { var h = '<select data-f="' + f + '" onchange="App.formSel(this)"' + dis + '><option value="">请选择</option>'; opts.forEach(function (o) { var v = typeof o === 'string' ? o : o.value, l = typeof o === 'string' ? o : (o.value + ' - ' + o.desc); h += '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(l) + '</option>'; }); return h + '</select>'; }
  function inp(f, ph, t) { var p = f.split('.'); return '<input data-f="' + f + '" type="' + (t || 'text') + '" placeholder="' + esc(ph) + '" value="' + esc(Form[p[0]][p[1]]) + '" onchange="App.formInp(this)"' + dis + '>'; }
  function dinp(f) { return inp(f, 'yyyy-mm-dd', 'date'); }

  var h = '<div class="card"><div class="section-title">' + (readOnly ? '客户详情(只读)' : (id ? '编辑客户' : '新增客户')) + (id ? '<span class="muted" style="font-weight:400;margin-left:6px">由 ' + esc(Form.staffName) + ' 填报</span>' : '') + '</div>';
  h += '<div class="card"><div class="section-title">基本信息</div><div class="two-col"><div class="form-row"><div class="label">客户姓名<span class="req">*</span></div>' + inp('basic.name', '客户姓名') + '</div><div class="form-row"><div class="label">客户号</div>' + inp('basic.clientNo', '客户号') + '</div></div><div class="form-row"><div class="label">托管金额(¥)</div>' + inp('basic.managedAmount', '如 300000', 'number') + '</div><div class="two-col"><div class="form-row"><div class="label">经办客户经理<span class="req">*</span></div>' + inp('basic.handler', '经办人姓名') + '</div><div class="form-row"><div class="label">客户类型</div>' + sel('basic.clientType', CLIENT_TYPES, Form.basic.clientType) + '<div class="muted" id="ctype-hint" style="margin-top:4px;display:' + (Form.basic.clientType === '其他' ? 'block' : 'none') + '">选择"其他"请备注</div></div></div>';
  h += '<div class="card"><div class="section-title">时间节点</div><div class="two-col"><div class="form-row"><div class="label">登记日期</div>' + dinp('timeNodes.registerDate') + '</div><div class="form-row"><div class="label">开卡日期</div>' + dinp('timeNodes.cardDate') + '</div></div><div class="two-col"><div class="form-row"><div class="label">预计入账日期</div>' + dinp('timeNodes.expectedDepositDate') + '</div><div class="form-row"><div class="label">限额失效日期</div>' + dinp('timeNodes.limitExpiryDate') + '</div></div><div class="form-row"><div class="label">入账时间描述</div><textarea data-f="timeNodes.depositDesc" placeholder="如 理财到期转入 · 预计金额 200万" onchange="App.formInp(this)"' + dis + '>' + esc(Form.timeNodes.depositDesc) + '</textarea></div></div>';
  h += '<div class="card"><div class="section-title">获客与转介</div><div class="two-col"><div class="form-row"><div class="label">获客方式</div>' + sel('acquisition.channel', OPT.channel, Form.acquisition.channel) + '</div><div class="form-row"><div class="label">链家签约经理<span class="req">*</span></div>' + inp('acquisition.acquirer', '链家签约经理姓名') + '</div></div><div class="form-row"><div class="label">转介理财经理</div>' + inp('acquisition.referralManager', '转介绍方理财经理') + '</div><div class="two-col"><div class="form-row"><div class="label">认领状态</div>' + sel('acquisition.claimStatus', OPT.claimStatus, Form.acquisition.claimStatus) + '</div><div class="form-row"><div class="label">认领日期</div>' + dinp('acquisition.claimDate') + '</div></div></div>';
  h += '<div class="card"><div class="section-title">状态与留存</div><div class="two-col"><div class="form-row"><div class="label">当前状态</div>' + sel('status.currentStatus', OPT.currentStatus, Form.status.currentStatus) + '</div><div class="form-row"><div class="label">AUM(¥)</div>' + inp('status.aum', '资产管理规模', 'number') + '</div></div><div class="form-row"><div class="label">留存产品类型</div>' + sel('status.retentionProductType', OPT.retentionProduct, Form.status.retentionProductType) + '</div><div class="two-col"><div class="form-row"><div class="label">留存填报日期</div>' + dinp('status.retentionReportDate') + '</div><div class="form-row"><div class="label">留存量(¥)</div>' + inp('status.retentionAmount', '', 'number') + '</div></div><div class="two-col"><div class="form-row"><div class="label">他行VIP潜力</div>' + sel('status.vipPotential', OPT.vipPotential, Form.status.vipPotential) + '</div><div class="form-row"><div class="label">风险偏好</div>' + sel('status.riskPreference', OPT.riskPreference, Form.status.riskPreference) + '</div></div><div class="form-row"><div class="label">备注</div><textarea data-f="status.remark" placeholder="补充信息" onchange="App.formInp(this)"' + dis + '>' + esc(Form.status.remark) + '</textarea></div></div>';
  h += '<div class="card"><div class="section-title">工作进度</div><div id="prog-list">';
  PROGRESS_ITEMS.forEach(function (it) { var done = !!Form.progress[it.key]; h += '<div class="prog-row' + (done ? ' done' : '') + (readOnly ? ' readonly' : '') + '" onclick="App.toggleProgress(\'' + it.key + '\')"><div class="prog-check' + (done ? ' on' : '') + '">' + (done ? '✓' : '') + '</div><div class="prog-label">' + it.label + '</div><div class="prog-state">' + (done ? '已完成' : '未完成') + '</div></div>'; });
  h += '</div><div class="muted" id="prog-count" style="margin-top:4px">完成 ' + progressCount(Form.progress) + ' / 6</div></div>';

  if (!readOnly) { h += '<div class="btn-row"><button class="btn btn-ghost" onclick="App.back()">返回</button><button class="btn btn-primary" onclick="App.saveForm()">保存</button></div>'; if (id) h += '<div class="btn-row"><button class="btn btn-danger" onclick="App.delForm()">删除此客户</button></div>'; }
  else { h += '<div class="btn-row"><button class="btn btn-ghost" onclick="App.back()">返回</button></div>'; }
  $('#app').innerHTML = h;
}

/* ================= 管理员后台 ================= */
var wbFilter = 'all', wbKeyword = '', mgrTodoFilter = 'all', cardMonthFilter = 'all';
var mgrTodoExpanded = false;
var regListExpanded = false;  // 已登记业务列表是否展开

function renderManager() {
  State.serverStatus = '加载中…'; $('#app').innerHTML = '<div class="banner"><div class="t1">管理员视图</div><div class="t2">开卡业务 · 实时数据</div></div><div class="sync-bar">加载中…</div>';
  Promise.all([api('GET', '/api/clients/all').catch(function () { return []; }), api('GET', '/api/staffs').catch(function () { return []; })])
    .then(function (rs) { State.clients = rs[0]; State.staffs = rs[1].filter(function (s) { return s.type !== 'hall'; }); lsSet('wb_card_all', rs[0]); State.serverStatus = '✅ 云端数据已更新'; drawManager(); })
    .catch(function (e) { State.clients = lsGet('wb_card_all', []); State.staffs = []; State.serverStatus = '⚠️ ' + e.message + '(显示本机缓存)'; drawManager(); });
}

function drawManager() {
  var all = State.clients, staffs = State.staffs;

  // 月份
  var cardMonths = {}; all.forEach(function (c) { var d = (c.timeNodes && c.timeNodes.registerDate) || c.createTime || '', m = String(d).slice(0, 7); if (m && m.length === 7) cardMonths[m] = 1; });
  var cardMonthList = Object.keys(cardMonths).sort().reverse();
  var allFiltered = all;
  if (cardMonthFilter !== 'all') allFiltered = all.filter(function (c) { var d = (c.timeNodes && c.timeNodes.registerDate) || c.createTime || ''; return String(d).slice(0, 7) === cardMonthFilter; });

  // 本月概览
  var now = new Date(), monthRecords = allFiltered.filter(function (c) { var d = c.createTime; if (!d) return false; return new Date(d).getMonth() === now.getMonth() && new Date(d).getFullYear() === now.getFullYear(); });
  var mRet = 0, mDone = 0, mDoing = 0, mNot = 0;
  monthRecords.forEach(function (c) { if (isRetained(c)) mRet++; var p = progressOf(c); if (p === 'done') mDone++; else if (p === 'doing') mDoing++; else mNot++; });

  var decorated = allFiltered.map(function (c) { var st = c.status || {}, b = c.basic || {}, tag = classify(st.currentStatus); return { id: c.id, staffId: c.staffId, staffName: c.staffName, basic: b, tag: tag.tag, cls: tag.cls, pd: progressCount(c.progress), managed: num(b.managedAmount), upd: fmtDT(c.updateTime) }; }).sort(function (a, b) { return b.upd.localeCompare(a.upd); });
  var tabMap = {}; staffs.forEach(function (s) { tabMap[s.id] = { key: s.id, label: s.name, count: 0 }; }); decorated.forEach(function (c) { if (!tabMap[c.staffId]) tabMap[c.staffId] = { key: c.staffId, label: (c.staffName || '未知') + '(已删)', count: 0 }; tabMap[c.staffId].count++; });
  var tabs = [{ key: 'all', label: '全部', count: decorated.length }].concat(staffs.map(function (s) { return tabMap[s.id]; })).concat(Object.keys(tabMap).filter(function (k) { return !staffs.some(function (s) { return s.id === k; }); }).map(function (k) { return tabMap[k]; }));
  var wbList = decorated.filter(function (c) { if (wbFilter !== 'all' && c.staffId !== wbFilter) return false; var w = wbKeyword.trim(); if (!w) return true; return (c.basic.name || '').indexOf(w) >= 0 || (c.staffName || '').indexOf(w) >= 0; });
  var top = topStats(allFiltered), weeks = weekly(allFiltered);

  // 趋势图
  var chartW = 320;
  var trend = lineGeometry([
    { name: '托管金额', color: '#1f6feb', values: weeks.map(function (w) { return w.managed; }) },
    { name: '入金金额', color: '#f5a623', values: weeks.map(function (w) { return w.deposit; }) },
    { name: '留存金额', color: '#1c8a4f', values: weeks.map(function (w) { return w.retention; }) }
  ], weeks.map(function (w) { return w.label; }), chartW, 180);
  var compare = lineGeometry([
    { name: '托管金额', color: '#1f6feb', values: weeks.map(function (w) { return w.managed; }) },
    { name: '留存AUM', color: '#8a5cf6', values: weeks.map(function (w) { return w.aum; }) }
  ], weeks.map(function (w) { return w.label; }), chartW, 180);
  var counts = countChart(weeks);
  var todos = deriveTodos(allFiltered), tCounts = todoCounts(todos), showTodos = mgrTodoFilter === 'all' ? todos : todos.filter(function (t) { return t.type === mgrTodoFilter; });
  var showTodoList2 = mgrTodoExpanded ? showTodos : showTodos.slice(0, 5);
  var chMap = {}; allFiltered.forEach(function (c) { var ch = (c.acquisition && c.acquisition.channel) || '未填写'; chMap[ch] = (chMap[ch] || 0) + 1; });
  var chStats = Object.keys(chMap).map(function (k) { return { channel: k, count: chMap[k], percent: Math.round(chMap[k] / (allFiltered.length || 1) * 100) }; }).sort(function (a, b) { return b.count - a.count; });

  /* ====== HTML ====== */
  var h = '<div class="banner"><div class="t1">管理员视图</div><div class="t2">开卡业务 · 实时数据</div></div><div class="sync-bar">' + esc(State.serverStatus) + '</div>';

  h += '<div class="card"><div class="subline">本月概览<span class="muted">按登记日期统计</span></div><div class="kpi-grid"><div class="kpi"><div class="num">' + monthRecords.length + '</div><div class="label">本月登记</div></div><div class="kpi"><div class="num green">' + mRet + '</div><div class="label">已留存</div></div><div class="kpi"><div class="num blue">' + mDoing + '</div><div class="label">进行中</div></div><div class="kpi"><div class="num amber">' + mDone + '</div><div class="label">已完成</div></div></div></div>';

  // 工作台
  h += '<div class="card"><div class="subline">开卡客户业务<span class="muted">' + wbList.length + ' 条</span></div>';
  if (cardMonthList.length > 0) { h += '<div class="chips"><button class="chip' + (cardMonthFilter === 'all' ? ' on' : '') + '" onclick="App.cardMonth(\'all\')">全部</button>'; cardMonthList.forEach(function (m) { h += '<button class="chip' + (cardMonthFilter === m ? ' on' : '') + '" onclick="App.cardMonth(\'' + m + '\')">' + m + '</button>'; }); h += '</div>'; }
  h += '<div class="chips">'; tabs.forEach(function (t) { h += '<button class="chip' + (wbFilter === t.key ? ' on' : '') + '" onclick="App.wbFilter(\'' + t.key + '\')">' + esc(t.label) + (t.count ? '<span class="chip-n">' + t.count + '</span>' : '') + '</button>'; }); h += '</div>';
  h += '<div class="kpi-grid" style="margin-top:8px"><div class="kpi"><div class="num">' + top.total + '</div><div class="label">客户总数</div></div><div class="kpi"><div class="num green">' + fmtMoney(top.managed) + '</div><div class="label">托管金额</div></div><div class="kpi"><div class="num blue">' + fmtMoney(top.aum) + '</div><div class="label">AUM合计</div></div><div class="kpi"><div class="num amber">' + top.retained + '</div><div class="label">已留存</div></div><div class="kpi"><div class="num">' + chStats.length + '</div><div class="label">渠道数</div></div><div class="kpi"><div class="num green">' + (allFiltered.length ? Math.round(monthRecords.length / allFiltered.length * 100) + '%' : '0%') + '</div><div class="label">当月占比</div></div></div>';

  h += '<div class="section-title" style="margin-top:4px">近八周资金变化趋势</div>' +
    '<svg viewBox="0 0 ' + trend.width + ' ' + trend.height + '" style="width:100%;max-width:320px;display:block;margin:0 auto">' +
    trend.segments.map(function (s) { return '<line x1="' + s.x + '" y1="' + s.y + '" x2="' + (s.x + s.len * Math.cos(s.angle * Math.PI / 180)) + '" y2="' + (s.y + s.len * Math.sin(s.angle * Math.PI / 180)) + '" stroke="' + s.color + '" stroke-width="2"/>'; }).join('') +
    trend.labels.map(function (l, i) { return '<text x="' + (8 + i * (chartW - 16) / Math.max(weeks.length - 1, 1)) + '" y="' + (trend.height - 6) + '" text-anchor="middle" font-size="9" fill="#999">' + l + '</text>'; }).join('') + '</svg>';

  var funnelSteps = funnel(allFiltered);
  h += '<div class="section-title" style="margin-top:8px">转化漏斗</div>';
  funnelSteps.forEach(function (s) { h += '<div class="frow"><div class="flabel">' + s.label + '</div><div class="ftrack"><div class="ffill" style="width:' + parseInt(s.pct) + '%"></div></div><div class="fval">' + fmtMoney(s.n) + ' (' + s.pct + ')</div></div>'; });

  h += '<div class="section-title" style="margin-top:8px">笔数趋势</div><div class="bchart">';
  counts.forEach(function (g) { h += '<div class="bgroup"><div class="bcols">'; g.bars.forEach(function (b) { h += '<div class="bcol">' + (b.value ? '<span class="bval">' + b.value + '</span>' : '') + '<div class="bbar" style="height:' + b.h + '%;background:' + b.color + (b.value ? ';min-height:4px' : '') + '"></div></div>'; }); h += '</div><span class="bx">' + g.label + '</span></div>'; });
  h += '</div><div class="legend"><div class="lg-item"><div class="lg-dot" style="background:#1f6feb"></div>登记款</div><div class="lg-item"><div class="lg-dot" style="background:#f5a623"></div>入金款</div><div class="lg-item"><div class="lg-dot" style="background:#1c8a4f"></div>留存款</div></div>';

  h += '<div class="section-title" style="margin-top:8px">托管金额 vs 留存AUM</div>' +
    '<svg viewBox="0 0 ' + compare.width + ' ' + compare.height + '" style="width:100%;max-width:320px;display:block;margin:0 auto">' +
    compare.segments.map(function (s) { return '<line x1="' + s.x + '" y1="' + s.y + '" x2="' + (s.x + s.len * Math.cos(s.angle * Math.PI / 180)) + '" y2="' + (s.y + s.len * Math.sin(s.angle * Math.PI / 180)) + '" stroke="' + s.color + '" stroke-width="2"/>'; }).join('') +
    compare.labels.map(function (l, i) { return '<text x="' + (8 + i * (chartW - 16) / Math.max(weeks.length - 1, 1)) + '" y="' + (compare.height - 6) + '" text-anchor="middle" font-size="9" fill="#999">' + l + '</text>'; }).join('') + '</svg>' +
    '<div class="legend"><div class="lg-item"><div class="lg-dot" style="background:#1f6feb"></div>托管金额</div><div class="lg-item"><div class="lg-dot" style="background:#8a5cf6"></div>留存AUM</div></div></div>';

  // 已登记业务(所有员工提交的业务,点击进入查看待办)
  var regSorted = allFiltered.slice().sort(function (a, b) { return (b.createTime || '').localeCompare(a.createTime || ''); });
  var regShown = regListExpanded ? regSorted : regSorted.slice(0, 5);
  h += '<div class="card"><div class="subline">已登记业务<span class="muted">' + regSorted.length + ' 笔</span></div>';
  if (regShown.length) {
    regShown.forEach(function (c) {
      var b = c.basic || {}, st = c.status || {}, tag = classify(st.currentStatus), pd = progressCount(c.progress);
      h += '<div class="list-item" onclick="App.openForm(\'' + c.id + '\')"><div style="flex:1;min-width:0"><div style="font-weight:600">' + esc(b.name) + '<span class="muted" style="margin-left:5px">by ' + esc(c.staffName || '') + '</span></div><div class="meta"><span class="tag ' + tag.cls + '">' + tag.tag + '</span>进度 ' + pd + '/6 · ' + esc(b.handler || '') + '</div></div><div class="meta" style="text-align:right">' + fmtDT(c.updateTime) + '</div></div>';
    });
  } else { h += '<div class="empty">暂无登记业务</div>'; }
  if (regSorted.length > 5) h += '<button class="btn btn-ghost btn-block" style="margin-top:6px" onclick="App.toggleRegList()">' + (regListExpanded ? '收起' : '展开全部 ' + regSorted.length + ' 笔') + '</button>';
  h += '</div>';

  // 业绩排名
  var handlerRank = rankBy(allFiltered, function (c) { return c.basic && c.basic.handler; }), acquirerRank = rankBy(allFiltered, function (c) { return c.acquisition && c.acquisition.acquirer; });
  h += '<div class="card"><div class="subline">业绩排名<span class="muted">每张客单均计入</span></div><div class="section-title" style="margin-top:4px">开卡经理 · 办理量排名<span class="muted" style="margin-left:8px">共 ' + handlerRank.reduce(function (s, r) { return s + r.count; }, 0) + ' 单</span></div>' + rankTableHtml(handlerRank) +
    '<div class="section-title" style="margin-top:16px">链家签约经理 · 约卡数排名<span class="muted" style="margin-left:8px">共 ' + acquirerRank.reduce(function (s, r) { return s + r.count; }, 0) + ' 单</span></div>' + rankTableHtml(acquirerRank) + '<div class="muted" style="margin-top:8px">同名自动合并(忽略空格)</div></div>';

  // 渠道分布
  h += '<div class="card"><div class="subline">获客渠道分布<span class="muted">' + chStats.length + ' 个渠道</span></div>'; chStats.forEach(function (c) { h += '<div class="bar-row"><div class="bar-label">' + esc(c.channel) + '</div><div class="bar-track"><div class="bar-fill" style="width:' + c.percent + '%"></div></div><div class="bar-num">' + c.count + '</div></div>'; }); if (!chStats.length) h += '<div class="empty">暂无渠道数据</div>'; h += '</div>';

  // 数据导出
  h += '<div class="card"><div class="section-title">数据导出</div><div class="btn-row"><button class="btn btn-primary" onclick="App.exportAll()">导出全量 CSV</button></div><div class="btn-row"><button class="btn btn-ghost" onclick="App.exportStaff()">导出员工业绩</button></div></div>';

  // 员工账号
  h += '<div class="card"><div class="section-title">员工账号</div><div class="muted" style="margin-bottom:8px">创建后员工即可用「姓名+密码」登录</div>';
  staffs.forEach(function (s) { h += '<div class="acct-row"><div class="acct-name">' + esc(s.name) + '</div><div class="muted">' + esc(s.id) + '</div><button class="mini-btn" onclick="App.shareLink(\'' + esc(s.name) + '\')">分享链接</button><button class="mini-btn danger" onclick="App.delStaff(\'' + s.id + '\',\'' + esc(s.name) + '\')">删除</button></div>'; });
  if (!staffs.length) h += '<div class="empty">还没有员工账号</div>';
  h += '<div class="form-row" style="margin-top:10px"><input id="ns-name" placeholder="员工姓名"></div><div class="form-row"><input id="ns-pwd" placeholder="登录密码(8位以上,含大小写+特殊字符)"></div><button class="btn btn-primary btn-block" onclick="App.createStaff()">创建 / 重置</button></div>';

  // 数据管理
  h += '<div class="card"><div class="section-title">数据管理</div><div class="muted" style="margin-bottom:8px">对云端全量数据操作,请谨慎</div>' +
    '<div class="btn-row"><button class="btn btn-ghost" onclick="App.clearDemo()">清空演示数据</button><button class="btn btn-danger" id="btn-reset" onclick="App.resetAll()">重置全部数据</button></div></div>' +
    '<div class="btn-row"><button class="btn btn-ghost" onclick="App.logout()">退出管理员</button></div>' +
    '<div class="btn-row"><button class="btn btn-ghost" onclick="App.changeAdminPwd()">修改管理密码</button></div>' +
    '<div class="muted" style="text-align:center;margin-top:8px">管理员密码在云开发控制台 → 云函数 api → 环境变量 ADMIN_PASSWORD 修改</div>';

  $('#app').innerHTML = h;
}

/* ================= App 动作 ================= */
window.App = {
  showAdmin: function () { location.hash = '#/login?role=manager'; },
  loginStaff: function () { var n = $('#li-name').value.trim(), p = $('#li-pwd').value.trim(); if (!n || !p) return toast('请输入姓名和密码'); api('POST', '/api/login', { role: 'staff', name: n, password: p }).then(function (r) { if ((r.staffType || 'card') === 'hall') return toast('该账号是厅堂融合员工', 3000); setToken(r.token); Session.set('staff', r.staffId, r.staffName); location.hash = '#/staff'; }).catch(function (e) { toast(e.message, 2500); }); },
  loginManager: function () { var p = $('#li-admin').value.trim(); if (!p) return toast('请输入管理密码'); api('POST', '/api/login', { role: 'manager', password: p, type: 'card' }).then(function (r) { setToken(r.token); Session.set('manager', 'admin', '管理员'); location.hash = '#/manager'; }).catch(function (e) { toast(e.message, 2500); }); },
  logout: function () { if (!confirm('确认退出?')) return; Session.clear(); location.hash = '#/login'; },

  staffTodoFilter: function (k) { staffTodoFilter = k; drawStaff(); },
  toggleStaffTodo: function () { staffTodoExpanded = !staffTodoExpanded; drawStaff(); },
  openForm: function (id) { location.hash = '#/form' + (id ? '?id=' + id : ''); },
  exportMine: function () { if (!State.clients.length) return toast('暂无数据'); downloadCSV('开卡-' + Session.get().staffName + '-' + todayKey() + '.csv', State.clients.map(clientRow)); },
  openPwd: function () { var o = prompt('请输入原密码:'); if (!o) return; var n = prompt('请输入新密码(' + PWD_RULE_MSG + '):'); if (!n) return; if (!isStrongPassword(n)) return toast(PWD_RULE_MSG, 2500); api('POST', '/api/change-password', { oldPassword: o, newPassword: n }).then(function () { toast('密码已修改'); }).catch(function (e) { toast(e.message, 2500); }); },

  formInp: function (el) { var p = el.dataset.f.split('.'); Form[p[0]][p[1]] = el.value; },
  formSel: function (el) { var p = el.dataset.f.split('.'); Form[p[0]][p[1]] = el.value; if (p[1] === 'clientType') { var h = $('#ctype-hint'); if (h) h.style.display = el.value === '其他' ? 'block' : 'none'; } },
  toggleProgress: function (k) { if (Form.readOnly) return; Form.progress[k] = !Form.progress[k]; var items = document.querySelectorAll('#prog-list .prog-row'); PROGRESS_ITEMS.forEach(function (it, i) { var d = !!Form.progress[it.key]; if (items[i]) { items[i].className = 'prog-row' + (d ? ' done' : ''); var c = items[i].querySelector('.prog-check'); if (c) { c.className = 'prog-check' + (d ? ' on' : ''); c.textContent = d ? '✓' : ''; } var s = items[i].querySelector('.prog-state'); if (s) s.textContent = d ? '已完成' : '未完成'; } }); var pc = $('#prog-count'); if (pc) pc.textContent = '完成 ' + progressCount(Form.progress) + ' / 6'; },
  saveForm: function () { if (!Form.basic.name) return toast('客户姓名必填'); if (!Form.basic.handler) return toast('请填写经办客户经理'); if (!Form.acquisition.acquirer) return toast('请填写链家签约经理'); api('POST', '/api/clients/sync', { records: [{ id: Form.id || newId(), staffId: Form.staffId, staffName: Form.staffName, basic: Object.assign({}, Form.basic), timeNodes: Object.assign({}, Form.timeNodes), acquisition: Object.assign({}, Form.acquisition), status: Object.assign({}, Form.status, { aum: num(Form.status.aum), retentionAmount: num(Form.status.retentionAmount) }), progress: Object.assign({}, Form.progress) }] }).then(function () { toast('已保存'); setTimeout(App.back, 500); }).catch(function (e) { toast(e.message, 2500); }); },
  delForm: function () { if (!confirm('确认删除?')) return; api('DELETE', '/api/clients?id=' + encodeURIComponent(Form.id)).then(function () { toast('已删除'); setTimeout(App.back, 500); }).catch(function (e) { toast(e.message, 2500); }); },
  back: function () { history.back(); },

  wbFilter: function (k) { wbFilter = k; drawManager(); },
  mgrTodoFilter: function (k) { mgrTodoFilter = k; drawManager(); },
  toggleMgrTodo: function () { mgrTodoExpanded = !mgrTodoExpanded; drawManager(); },
  toggleRegList: function () { regListExpanded = !regListExpanded; drawManager(); },
  cardMonth: function (m) { cardMonthFilter = m; drawManager(); },
  exportAll: function () { if (!State.clients.length) return toast('暂无数据'); downloadCSV('开卡全量-' + todayKey() + '.csv', State.clients.map(clientRow)); },
  exportStaff: function () { downloadCSV('员工业绩-' + todayKey() + '.csv', State.staffs.map(function (s) { var list = State.clients.filter(function (c) { return c.staffId === s.id; }); return { '员工ID': s.id, '姓名': s.name, '客户总数': list.length, '待办数': deriveTodos(list).length, '已留存': list.filter(isRetained).length, 'AUM合计': list.reduce(function (sum, c) { return sum + num(c.status && c.status.aum); }, 0), '托管合计': list.reduce(function (sum, c) { return sum + num(c.basic && c.basic.managedAmount); }, 0) }; })); },
  createStaff: function () { var n = $('#ns-name').value.trim(), p = $('#ns-pwd').value.trim(); if (!n || !p) return toast('姓名和密码必填'); if (!isStrongPassword(p)) return toast(PWD_RULE_MSG, 2500); api('POST', '/api/staffs', { name: n, password: p, type: 'card' }).then(function (r) { toast(r.updated ? '密码已重置' : '已创建 ' + n); renderManager(); }).catch(function (e) { toast(e.message, 2500); }); },
  delStaff: function (id, name) { if (!confirm('确认删除「' + name + '」?')) return; api('DELETE', '/api/staffs?id=' + encodeURIComponent(id)).then(function () { toast('已删除'); renderManager(); }).catch(function (e) { toast(e.message, 2500); }); },
  shareLink: function (name) { var u = location.origin + location.pathname + '#/login?name=' + encodeURIComponent(name), d = function () { toast('链接已复制'); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(d, function () { prompt('复制链接:', u); }); else prompt('复制链接:', u); },
  clearDemo: function () { if (!confirm('将删除演示记录,真实数据不受影响。')) return; api('POST', '/api/admin/clear-demo').then(function (r) { toast('已清除 ' + r.removed + ' 条'); renderManager(); }).catch(function (e) { toast(e.message, 2500); }); },
  resetAll: function () {
    var btn = document.querySelector('#btn-reset');
    if (btn && btn.dataset.ready === '1') {
      var p = prompt('请输入管理员密码以确认重置全部数据:');
      if (!p) return;
      api('POST', '/api/admin/verify-password', { password: p, type: 'card' }).then(function () {
        api('GET', '/api/clients/all').then(function (r) {
          return Promise.all((r || []).map(function (c) { return api('DELETE', '/api/clients?id=' + encodeURIComponent(c.id)); }));
        }).then(function () { toast('已全部清空'); renderManager(); }).catch(function (e) { toast(e.message, 2500); });
      }).catch(function () { toast('密码错误', 2500); });
      return;
    }
    if (!confirm('⚠️ 将删除云端全部开卡数据且不可恢复!确认继续?')) return;
    if (!btn) return;
    var left = 5;
    btn.disabled = true;
    btn.textContent = '请等待 ' + left + ' 秒…';
    var timer = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = '输入密码并确认重置';
        btn.dataset.ready = '1';
      } else {
        btn.textContent = '请等待 ' + left + ' 秒…';
      }
    }, 1000);
  },
  changeAdminPwd: function () { var o = prompt('请输入当前管理密码:'); if (!o) return; var n = prompt('请输入新管理密码(' + PWD_RULE_MSG + '):'); if (!n) return; api('POST', '/api/admin/change-password', { oldPassword: o, newPassword: n, type: 'card' }).then(function (r) { toast(r.msg || '已修改'); }).catch(function (e) { toast(e.message, 2500); }); }
};

/* ================= 启动 ================= */
if (API_BASE.indexOf('请填入') >= 0) { $('#app').innerHTML = '<div class="card" style="margin-top:40px"><div class="section-title">尚未配置云函数地址</div><div class="muted" style="line-height:1.8">打开 web-card/app.js,把顶部 API_BASE 改成云函数 HTTP 触发器地址。</div></div>'; }
else { route(); }
})();
