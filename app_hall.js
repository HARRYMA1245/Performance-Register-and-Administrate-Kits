/* 厅堂融合管家 · 独立网页版(H5)
 * 后端: 微信云开发 云函数 api(HTTP 触发器) + hall 集合
 * 员工类型: 柜员(hall)填表交接 / 理财经理(low)承接并标记营销结果
 */
(function () {
'use strict';

const API_BASE = 'https://blue-sky-reg-d5gcvp66235b47382-1465861599.ap-shanghai.app.tcloudbase.com/';

/* ================= 工具 ================= */
function $(s) { return document.querySelector(s); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function pad(n) { return n < 10 ? '0' + n : n; }
function fmtDT(d) { if (!d) return ''; var dt = new Date(d); return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes()); }
function fmtDay(d) { if (!d) return ''; return String(d).slice(0, 10); }
function bizDay(r) { return (r && r.bizDate) ? r.bizDate : fmtDay(r && (r.createTime || r.updateTime)); }
function todayKey() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmtMoney(v) { v = v || 0; if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿'; if (v >= 10000) return (v / 10000).toFixed(1) + '万'; return String(Math.round(v)); }
function toast(msg, ms) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, ms || 2000); }
function newId() { return 'H' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36); }
function lsGet(k, fb) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function isStrongPassword(p) { return typeof p === 'string' && p.length >= 6 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[^A-Za-z0-9]/.test(p); }
var PWD_RULE_MSG = '密码需6位以上,含大小写字母和特殊字符';
function handoffLabel(s) { return s === 'success' ? '营销成功' : (s === 'failed' ? '未营销成功' : (s === 'pending' ? '营销成果待定' : '未处理')); }
function handoffCls(s) { return s === 'success' ? 'green' : (s === 'failed' ? 'red' : (s === 'pending' ? 'blue' : 'amber')); }

/* ================= API ================= */
function getToken() { return localStorage.getItem('wb_hall_token') || ''; }
function setToken(t) { localStorage.setItem('wb_hall_token', t || ''); }
function api(method, path, body) {
  var sep = path.indexOf('?') >= 0 ? '&' : '?';
  var url = API_BASE + path + sep + 'token=' + encodeURIComponent(getToken());
  return fetch(url, { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() }, body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body || {}) })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { if (r.status >= 200 && r.status < 300) return data; throw new Error(data.error || ('请求失败(' + r.status + ')')); }); })
    .catch(function (e) { if (e.message === 'Failed to fetch') throw new Error('无法连接云服务'); throw e; });
}

/* ================= 会话 ================= */
var Session = { get: function () { return lsGet('wb_hall_session', null); }, set: function (role, id, name, type) { lsSet('wb_hall_session', { role: role, staffId: id, staffName: name, staffType: type }); }, clear: function () { localStorage.removeItem('wb_hall_session'); setToken(''); } };

/* ================= 厅堂融合常量 ================= */
var HALL_CUSTOMER_TYPES = ['新客户', '存量客户'];
var HALL_BUSINESSES = ['定期存款', '理财', '财私客户', '信用卡新客', '三代社保卡', '双卡绑定', '三方存管', '个养入金', '社保卡待遇代发', '代发工资'];

function hallStats(records) {
  var byType = {}; HALL_BUSINESSES.forEach(function (t) { byType[t] = { count: 0, amount: 0 }; });
  var byStaffMap = {};
  (records || []).forEach(function (r) {
    var biz = Array.isArray(r.businesses) ? r.businesses : [];
    biz.forEach(function (t) { if (!byType[t]) byType[t] = { count: 0, amount: 0 }; byType[t].count++; if (t === '定期存款') byType[t].amount += num(r.depositAmount); if (t === '理财') byType[t].amount += num(r.wealthAmount); });
    var sn = r.staffName || '未知员工';
    if (!byStaffMap[sn]) byStaffMap[sn] = { name: sn, total: 0, types: {}, deposit: 0, wealth: 0 };
    var s = byStaffMap[sn]; s.total++; biz.forEach(function (t) { s.types[t] = (s.types[t] || 0) + 1; }); s.deposit += num(r.depositAmount); s.wealth += num(r.wealthAmount);
  });
  var byStaff = Object.keys(byStaffMap).map(function (k) { return byStaffMap[k]; });
  byStaff.sort(function (a, b) { return b.total - a.total; });
  return { byType: byType, byStaff: byStaff };
}

/* ================= CSV ================= */
function downloadCSV(filename, rows) {
  var keys = Object.keys(rows[0]);
  var escCell = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var csv = '\ufeff' + keys.join(',') + '\n';
  rows.forEach(function (r) { csv += keys.map(function (k) { return escCell(r[k]); }).join(',') + '\n'; });
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

// 明细 CSV: 一笔业务一行(展开 businesses),按时间倒序
function hallCsvRows(records) {
  var rows = [];
  (records || []).forEach(function (r) {
    var biz = (r.businesses && r.businesses.length) ? r.businesses : [''];
    biz.forEach(function (b) {
      rows.push({
        '日期': bizDay(r),
        '客户名称': r.clientName,
        '柜员': r.staffName,
        '业务类型': b,
        '理财经理': r.contact,
        '理财经理是否营销成功': handoffLabel(r.handoffStatus),
        '补充内容': r.handoffNote || ''
      });
    });
  });
  rows.sort(function (a, b) { return (b['日期'] || '').localeCompare(a['日期'] || ''); });
  return rows;
}

function hallSummaryCsv(records) {
  var byStaff = {};
  (records || []).forEach(function (r) {
    var sn = r.staffName || '未知员工';
    if (!byStaff[sn]) byStaff[sn] = { name: sn, total: 0, types: {}, deposit: 0, wealth: 0 };
    var s = byStaff[sn]; s.total++; var biz = r.businesses || [];
    biz.forEach(function (t) { s.types[t] = (s.types[t] || 0) + 1; }); s.deposit += num(r.depositAmount); s.wealth += num(r.wealthAmount);
  });
  var list = Object.keys(byStaff).map(function (k) { return byStaff[k]; }).sort(function (a, b) { return b.total - a.total; });
  var cols = ['定期存款', '理财', '信用卡新客', '三代社保卡', '双卡绑定', '三方存管', '个养入金', '社保卡待遇代发', '代发工资', '财私客户'];
  return list.map(function (s) { var row = { '柜员': s.name, '总笔数': s.total, '定期存款金额': s.deposit, '理财金额': s.wealth }; cols.forEach(function (t) { row[t] = s.types[t] || 0; }); return row; });
}

/* ================= 状态 ================= */
var State = { hall: [], staffs: [], lowStaffs: [], serverStatus: '' };

/* ================= 路由 ================= */
function route() {
  var hash = location.hash || '#/login', s = Session.get(), pathOnly = hash.slice(1).split('?')[0];
  if (!s && pathOnly !== '/login') { location.hash = '#/login'; return; }
  if (pathOnly === '/login') return renderLogin();
  if (pathOnly === '/staff' && s.role === 'staff') return renderStaff();
  if (pathOnly === '/manager' && s.role === 'manager') return renderManager();
  if (pathOnly === '/hall') return renderHallForm();
  if (pathOnly === '/handoff') return renderHandoff();
  location.hash = s.role === 'manager' ? '#/manager' : '#/staff';
}
window.addEventListener('hashchange', route);

/* ================= 登录页 ================= */
function renderLogin() {
  var params = new URLSearchParams((location.hash.split('?')[1] || ''));
  var showAdmin = params.get('role') === 'manager';
  $('#app').innerHTML =
    '<div class="banner"><div class="t1">厅堂融合管家</div><div class="t2">厅堂业绩 · 数据统计 · 独立管理</div></div>' +
    '<div class="card"><div class="section-title">员工登录</div>' +
    '<div class="form-row"><div class="label">姓名</div><input id="li-name" placeholder="员工姓名"></div>' +
    '<div class="form-row"><div class="label">密码</div><input id="li-pwd" type="password" placeholder="登录密码"></div>' +
    '<button class="btn btn-primary btn-block" onclick="App.loginStaff()">进入工作台</button></div>' +
    '<div class="card"><div class="section-title">管理员</div>' +
    (showAdmin ? '<div class="form-row"><div class="label">管理密码</div><input id="li-admin" type="password" placeholder="管理密码"></div><button class="btn btn-primary btn-block" onclick="App.loginManager()">进入管理后台</button>'
      : '<button class="btn btn-ghost btn-block" onclick="App.showAdmin()">我是管理员</button>') + '</div>' +
    '<div class="card"><div class="section-title">云服务状态</div><div class="muted" id="li-status">检测中…</div></div>';
  api('GET', '/api/health').then(function (r) { var el = $('#li-status'); if (el) el.textContent = r && r.ok ? '✅ 云服务已连接' : '⚠️ 响应异常'; }).catch(function (e) { var el = $('#li-status'); if (el) el.textContent = '❌ ' + e.message; });
}

/* ================= 员工工作台(柜员/理财经理分派) ================= */
function renderStaff() {
  var s = Session.get(), cacheKey = 'wb_hall_s_' + s.staffId;
  api('GET', '/api/hall').then(function (list) { State.hall = list; lsSet(cacheKey, list); State.serverStatus = '✅ 已与云端同步'; drawStaff(); })
    .catch(function (e) { State.hall = lsGet(cacheKey, []); State.serverStatus = '⚠️ ' + e.message + '(显示本机缓存)'; drawStaff(); });
}
function drawStaff() {
  var s = Session.get();
  if (s.staffType === 'low') return drawLowStaff();
  drawHighStaff();
}

/* ---- 柜员工作台 ---- */
function drawHighStaff() {
  var s = Session.get();
  var mine = State.hall.slice().sort(function (a, b) { return (b.updateTime || '').localeCompare(a.updateTime || ''); });
  var totalDep = mine.reduce(function (sum, r) { return sum + num(r.depositAmount); }, 0);
  var totalWealth = mine.reduce(function (sum, r) { return sum + num(r.wealthAmount); }, 0);

  var h = '<div class="profile"><div class="avatar">' + esc((s.staffName || '员')[0]) + '</div>' +
    '<div><div class="name">' + esc(s.staffName) + '</div><div class="sub">柜员 · ID ' + esc(s.staffId) + '</div></div>' +
    '<button class="mini-btn" onclick="App.logout()">退出登录</button></div>' +
    '<div class="sync-bar">' + esc(State.serverStatus) + '</div>' +
    '<div class="kpi-grid">' +
    '<div class="kpi"><div class="num">' + mine.length + '</div><div class="label">厅堂记录</div></div>' +
    '<div class="kpi"><div class="num green">' + fmtMoney(totalDep) + '</div><div class="label">定期存款总额</div></div>' +
    '<div class="kpi"><div class="num blue">' + fmtMoney(totalWealth) + '</div><div class="label">理财总额</div></div></div>' +
    '<div class="card"><div class="subline">我的记录<span class="muted">共 ' + mine.length + ' 条</span></div>';
  if (mine.length) {
    mine.forEach(function (r) {
      var amts = [];
      if (num(r.depositAmount)) amts.push('定期¥' + fmtMoney(num(r.depositAmount)));
      if (num(r.wealthAmount)) amts.push('理财¥' + fmtMoney(num(r.wealthAmount)));
      h += '<div class="list-item" onclick="App.openHall(\'' + r.id + '\')"><div style="flex:1;min-width:0"><div style="font-weight:600">' + esc(r.clientName) + '<span class="tag green">' + esc(r.customerType || '') + '</span></div>' +
        '<div class="meta">' + esc((r.businesses || []).join(' + ')) + ' · 交接 ' + esc(r.contact || '—') + ' <span class="tag ' + handoffCls(r.handoffStatus) + '">' + handoffLabel(r.handoffStatus) + '</span></div>' +
        (amts.length ? '<div class="meta" style="color:#1f6feb">' + amts.join(' · ') + '</div>' : '') + '</div><div class="meta">' + bizDay(r) + '</div></div>';
    });
  } else { h += '<div class="empty">还没有厅堂记录,点右下角 + 开始第一条</div>'; }
  h += '</div><div class="btn-row"><button class="btn btn-ghost" onclick="App.exportHall()">导出我的 CSV</button><button class="btn btn-ghost" onclick="App.openPwd()">修改密码</button></div>' +
    '<div class="fab" onclick="App.newHall()">＋</div>';
  $('#app').innerHTML = h;
}

/* ---- 理财经理工作台 ---- */
function drawLowStaff() {
  var s = Session.get();
  var mine = State.hall.slice().sort(function (a, b) { return (b.updateTime || '').localeCompare(a.updateTime || ''); });
  var pending = mine.filter(function (r) { return !r.handoffStatus; }).length;
  var success = mine.filter(function (r) { return r.handoffStatus === 'success'; }).length;
  var failed = mine.filter(function (r) { return r.handoffStatus === 'failed'; }).length;

  var h = '<div class="profile"><div class="avatar">' + esc((s.staffName || '员')[0]) + '</div>' +
    '<div><div class="name">' + esc(s.staffName) + '</div><div class="sub">理财经理 · ID ' + esc(s.staffId) + '</div></div>' +
    '<button class="mini-btn" onclick="App.logout()">退出登录</button></div>' +
    '<div class="sync-bar">' + esc(State.serverStatus) + '</div>' +
    '<div class="kpi-grid">' +
    '<div class="kpi"><div class="num amber">' + pending + '</div><div class="label">待营销</div></div>' +
    '<div class="kpi"><div class="num green">' + success + '</div><div class="label">营销成功</div></div>' +
    '<div class="kpi"><div class="num red">' + failed + '</div><div class="label">未营销成功</div></div></div>' +
    '<div class="card"><div class="subline">交接给我的业务<span class="muted">共 ' + mine.length + ' 笔</span></div>';
  if (mine.length) {
    mine.forEach(function (r) {
      h += '<div class="list-item" onclick="App.openHandoff(\'' + r.id + '\')"><div style="flex:1;min-width:0"><div style="font-weight:600">' + esc(r.clientName) + '<span class="tag ' + handoffCls(r.handoffStatus) + '">' + handoffLabel(r.handoffStatus) + '</span></div>' +
        '<div class="meta">' + esc((r.businesses || []).join(' + ')) + ' · 柜员 ' + esc(r.staffName || '—') + '</div>' +
        '<div class="meta muted">' + bizDay(r) + '</div></div></div>';
    });
  } else { h += '<div class="empty">暂无交接给你的业务</div>'; }
  h += '</div><div class="btn-row"><button class="btn btn-ghost" onclick="App.exportHall()">导出我的 CSV</button><button class="btn btn-ghost" onclick="App.openPwd()">修改密码</button></div>';
  $('#app').innerHTML = h;
}

/* ================= 厅堂表单(柜员登记) ================= */
var HallForm = null;
function renderHallForm() {
  var s = Session.get();
  if (s.role !== 'manager' && (!State.lowStaffs || !State.lowStaffs.length)) {
    api('GET', '/api/staffs/low').then(function (list) { State.lowStaffs = list || []; renderHallForm(); }).catch(function () { State.lowStaffs = []; renderHallForm(); });
    return;
  }
  var params = new URLSearchParams((location.hash.split('?')[1] || '')), id = params.get('id') || '', readOnly = s.role === 'manager', existing = id ? State.hall.find(function (r) { return r.id === id; }) : null;
  HallForm = { id: id, readOnly: readOnly, staffId: existing ? existing.staffId : s.staffId, staffName: existing ? existing.staffName : s.staffName,
    clientName: existing ? existing.clientName : '', clientNo: existing ? existing.clientNo : '', customerType: existing ? existing.customerType : '',
    bizDate: existing ? (existing.bizDate || '') : todayKey(),
    businesses: existing ? (existing.businesses || []).slice() : [], depositAmount: existing ? existing.depositAmount : '', wealthAmount: existing ? existing.wealthAmount : '', contact: existing ? existing.contact : '' };
  var dis = readOnly ? ' disabled' : '';
  function sel(opts, cur) { var h = ''; opts.forEach(function (o) { h += '<option value="' + esc(o) + '"' + (cur === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }); return h; }

  var h = '<div class="card"><div class="section-title">' + (readOnly ? '厅堂记录(查看)' : (id ? '编辑记录' : '厅堂登记')) + '</div></div>' +
    '<div class="card"><div class="section-title">客户信息</div><div class="two-col">' +
    '<div class="form-row"><div class="label">客户姓名</div><input id="hf-name" placeholder="客户姓名" value="' + esc(HallForm.clientName) + '" oninput="App.hallInp(\'clientName\',this.value)"' + dis + '></div>' +
    '<div class="form-row"><div class="label">客户号</div><input id="hf-no" placeholder="客户号" value="' + esc(HallForm.clientNo) + '" oninput="App.hallInp(\'clientNo\',this.value)"' + dis + '></div></div>' +
    '<div class="form-row"><div class="label">客户来源<span class="req">*</span></div><select onchange="App.hallInp(\'customerType\',this.value)"' + dis + '><option value="">请选择</option>' + sel(HALL_CUSTOMER_TYPES, HallForm.customerType) + '</select></div>' +
    '<div class="form-row"><div class="label">业务日期<span class="req">*</span></div><input type="date" value="' + esc(HallForm.bizDate) + '" onchange="App.hallInp(\'bizDate\',this.value)"' + dis + '></div></div>';

  h += '<div class="card"><div class="section-title">业务类型<span class="req">*</span></div><div class="muted" style="margin-bottom:8px">可多选;选「定期存款」或「理财」需填金额</div>' +
    '<div class="chips" style="flex-wrap:wrap" id="hf-biz">';
  HALL_BUSINESSES.forEach(function (b) { var on = HallForm.businesses.indexOf(b) >= 0; h += '<button class="chip' + (on ? ' on' : '') + '" data-b="' + esc(b) + '" onclick="App.hallToggleBiz(\'' + esc(b) + '\')"' + (readOnly ? ' disabled' : '') + '>' + esc(b) + '</button>'; });
  h += '</div><div class="form-row" id="hf-dep-row" style="display:' + (HallForm.businesses.indexOf('定期存款') >= 0 ? 'block' : 'none') + '"><div class="label">定期存款金额(¥)</div><input type="number" placeholder="如 500000" value="' + esc(HallForm.depositAmount) + '" oninput="App.hallInp(\'depositAmount\',this.value)"' + dis + '></div>' +
    '<div class="form-row" id="hf-wealth-row" style="display:' + (HallForm.businesses.indexOf('理财') >= 0 ? 'block' : 'none') + '"><div class="label">理财金额(¥)</div><input type="number" placeholder="如 300000" value="' + esc(HallForm.wealthAmount) + '" oninput="App.hallInp(\'wealthAmount\',this.value)"' + dis + '></div></div>';

  // 对接人: 选择理财经理(交接对象)
  var lowOpts = (State.lowStaffs || []).map(function (x) { return x.name; });
  if (readOnly && HallForm.contact && lowOpts.indexOf(HallForm.contact) < 0) lowOpts.push(HallForm.contact);
  h += '<div class="card"><div class="section-title">交接给理财经理<span class="req">*</span></div><select onchange="App.hallInp(\'contact\',this.value)"' + dis + '><option value="">请选择</option>' + sel(lowOpts, HallForm.contact) + '</select>' +
    (readOnly && HallForm.contact ? '<div class="muted" style="margin-top:6px">营销结果: <span class="tag ' + handoffCls(existing ? existing.handoffStatus : '') + '">' + handoffLabel(existing ? existing.handoffStatus : '') + '</span>' + (existing && existing.handoffNote ? ' · ' + esc(existing.handoffNote) : '') + '</div>' : '') + '</div>';

  if (!readOnly) {
    h += '<div class="btn-row"><button class="btn btn-ghost" onclick="App.back()">返回</button><button class="btn btn-primary" onclick="App.saveHall()">保存</button></div>';
    if (id) h += '<div class="btn-row"><button class="btn btn-danger" onclick="App.delHall()">删除此记录</button></div>';
  } else { h += '<div class="btn-row"><button class="btn btn-ghost" onclick="App.back()">返回</button></div>'; }
  $('#app').innerHTML = h;
}

/* ================= 理财经理交接详情(标记营销结果) ================= */
var HandoffForm = null;
function renderHandoff() {
  var s = Session.get(), params = new URLSearchParams((location.hash.split('?')[1] || '')), id = params.get('id') || '';
  var rec = id ? State.hall.find(function (r) { return r.id === id; }) : null;
  if (!rec) { $('#app').innerHTML = '<div class="empty">记录不存在</div>'; return; }
  HandoffForm = { id: rec.id, status: rec.handoffStatus || '', note: rec.handoffNote || '' };

  var amts = [];
  if (num(rec.depositAmount)) amts.push('定期¥' + fmtMoney(num(rec.depositAmount)));
  if (num(rec.wealthAmount)) amts.push('理财¥' + fmtMoney(num(rec.wealthAmount)));

  var h = '<div class="card"><div class="section-title">业务详情</div>' +
    '<div class="detail-row"><span class="dl">客户姓名</span><span class="dv">' + esc(rec.clientName) + '</span></div>' +
    '<div class="detail-row"><span class="dl">客户号</span><span class="dv">' + esc(rec.clientNo || '—') + '</span></div>' +
    '<div class="detail-row"><span class="dl">客户来源</span><span class="dv">' + esc(rec.customerType || '—') + '</span></div>' +
    '<div class="detail-row"><span class="dl">业务类型</span><span class="dv">' + esc((rec.businesses || []).join(' + ')) + '</span></div>' +
    (amts.length ? '<div class="detail-row"><span class="dl">金额</span><span class="dv" style="color:#1f6feb">' + amts.join(' · ') + '</span></div>' : '') +
    '<div class="detail-row"><span class="dl">柜员</span><span class="dv">' + esc(rec.staffName || '—') + '</span></div>' +
    '<div class="detail-row"><span class="dl">日期</span><span class="dv">' + bizDay(rec) + '</span></div></div>';

  h += '<div class="card"><div class="section-title">营销结果</div><div class="chips" id="hf-status">' +
    '<button class="chip' + (HandoffForm.status === 'success' ? ' on' : '') + '" onclick="App.handoffSet(\'success\')">营销成功</button>' +
    '<button class="chip' + (HandoffForm.status === 'pending' ? ' on' : '') + '" onclick="App.handoffSet(\'pending\')">营销成果待定</button>' +
    '<button class="chip' + (HandoffForm.status === 'failed' ? ' on' : '') + '" onclick="App.handoffSet(\'failed\')">未营销成功</button></div>' +
    '<div class="form-row" style="margin-top:8px"><div class="label">补充内容(可选)</div><textarea id="hf-note" placeholder="补充说明营销情况" oninput="App.handoffNote(this.value)">' + esc(HandoffForm.note) + '</textarea></div></div>';

  h += '<div class="btn-row"><button class="btn btn-ghost" onclick="App.back()">返回</button><button class="btn btn-primary" onclick="App.saveHandoff()">保存营销结果</button></div>';
  $('#app').innerHTML = h;
}

/* ================= 管理员后台 ================= */
var hallFilterHigh = 'all', hallFilterLow = 'all', hallFilterBiz = 'all', hallFilterSrc = 'all', hallMonthFilter = 'all', hallFilterDate = 'all';
var chipExpand = {};  // 各筛选维度是否展开(默认折叠只显示前5个选项)
var hallListExpanded = false;  // 筛选后记录列表是否展开全部

function filterHallRecords(records) {
  var r = records || [];
  if (hallFilterHigh !== 'all') r = r.filter(function (x) { return x.staffName === hallFilterHigh; });
  if (hallFilterLow !== 'all') r = r.filter(function (x) { return x.contact === hallFilterLow; });
  if (hallFilterBiz !== 'all') r = r.filter(function (x) { return (x.businesses || []).indexOf(hallFilterBiz) >= 0; });
  if (hallFilterSrc !== 'all') r = r.filter(function (x) { return x.customerType === hallFilterSrc; });
  return r;
}

function renderManager() {
  State.serverStatus = '加载中…'; drawManagerLoading();
  Promise.all([api('GET', '/api/hall/all').catch(function () { return []; }), api('GET', '/api/staffs').catch(function () { return []; })])
    .then(function (rs) { State.hall = rs[0]; State.staffs = rs[1].filter(function (s) { return s.type === 'hall' || s.type === 'low'; }); lsSet('wb_hall_all', rs[0]); State.serverStatus = '✅ 云端数据已更新'; drawManager(); })
    .catch(function (e) { State.hall = lsGet('wb_hall_all', []); State.staffs = []; State.serverStatus = '⚠️ ' + e.message + '(显示本机缓存)'; drawManager(); });
}
function drawManagerLoading() { $('#app').innerHTML = '<div class="banner"><div class="t1">管理员视图</div><div class="t2">厅堂融合 · 实时数据</div></div><div class="sync-bar">加载中…</div>'; }

function drawManager() {
  var hallAll = State.hall || [], staffs = State.staffs;

  var hallMonths = {}; hallAll.forEach(function (r) { var m = bizDay(r).slice(0, 7); if (m && m.length === 7) hallMonths[m] = 1; });
  var hallMonthList = Object.keys(hallMonths).sort().reverse();
  var hallDates = {}; hallAll.forEach(function (r) { var d = bizDay(r); if (d && d.length === 10) hallDates[d] = 1; });
  var hallDateList = Object.keys(hallDates).sort().reverse();

  var hallFiltered = filterHallRecords(hallAll);
  if (hallMonthFilter !== 'all') hallFiltered = hallFiltered.filter(function (r) { return bizDay(r).slice(0, 7) === hallMonthFilter; });
  if (hallFilterDate !== 'all') hallFiltered = hallFiltered.filter(function (r) { return bizDay(r) === hallFilterDate; });

  var hs = hallStats(hallFiltered);
  var hallTotalDep = hallFiltered.reduce(function (s, r) { return s + num(r.depositAmount); }, 0);
  var hallTotalWealth = hallFiltered.reduce(function (s, r) { return s + num(r.wealthAmount); }, 0);

  // 柜员/理财经理筛选选项
  var highs = []; hallAll.forEach(function (r) { if (r.staffName && highs.indexOf(r.staffName) < 0) highs.push(r.staffName); });
  var lows = []; hallAll.forEach(function (r) { if (r.contact && lows.indexOf(r.contact) < 0) lows.push(r.contact); });
  var bizs = []; hallAll.forEach(function (r) { (r.businesses || []).forEach(function (b) { if (bizs.indexOf(b) < 0) bizs.push(b); }); });
  var srcs = []; hallAll.forEach(function (r) { if (r.customerType && srcs.indexOf(r.customerType) < 0) srcs.push(r.customerType); });

  var hallBizLabels = ['定期存款', '理财', '信用卡新客', '三代社保卡', '双卡绑定', '三方存管', '个养入金', '社保卡待遇代发', '代发工资', '财私客户'];
  var hallBizShort = ['定存', '理财', '信用卡', '三代卡', '双卡', '存管', '个养', '代发卡', '代发薪', '财私'];

  var h = '<div class="banner"><div class="t1">管理员视图</div><div class="t2">厅堂融合 · 实时数据</div></div><div class="sync-bar">' + esc(State.serverStatus) + '</div>';

  h += '<div class="card"><div class="subline">筛选与统计<span class="muted">全量 ' + hallAll.length + ' 笔,当前 ' + hallFiltered.length + ' 笔</span></div>' +
    '<div class="kpi-grid" style="margin-top:8px">' +
    '<div class="kpi"><div class="num">' + hallFiltered.length + '</div><div class="label">当前笔数</div></div>' +
    '<div class="kpi"><div class="num green">' + fmtMoney(hallTotalDep) + '</div><div class="label">定期存款总额</div></div>' +
    '<div class="kpi"><div class="num blue">' + fmtMoney(hallTotalWealth) + '</div><div class="label">理财总额</div></div></div>';

  // 筛选: 柜员
  h += chipRow('柜员', highs, hallFilterHigh, 'high');
  // 筛选: 理财经理
  h += chipRow('理财经理', lows, hallFilterLow, 'low');
  // 筛选: 业务类型
  h += chipRow('业务类型', bizs, hallFilterBiz, 'biz');
  // 筛选: 客户来源
  h += chipRow('客户来源', srcs, hallFilterSrc, 'src');
  // 筛选: 月份
  if (hallMonthList.length > 0) {
    var mExp = !!chipExpand['month'];
    var mShown = mExp ? hallMonthList : hallMonthList.slice(0, 5);
    h += '<div class="chips" style="margin-bottom:6px"><span class="muted" style="flex-shrink:0;line-height:30px;margin-right:4px">月份:</span><button class="chip' + (hallMonthFilter === 'all' ? ' on' : '') + '" onclick="App.hallMonth(\'all\')">全部</button>';
    mShown.forEach(function (m) { h += '<button class="chip' + (hallMonthFilter === m ? ' on' : '') + '" onclick="App.hallMonth(\'' + m + '\')">' + m + '</button>'; });
    if (hallMonthList.length > 5) h += '<button class="chip more" onclick="App.toggleChip(\'month\')">' + (mExp ? '收起' : '更多 +' + (hallMonthList.length - 5)) + '</button>';
    h += '</div>';
  }
  // 筛选: 日期
  if (hallDateList.length > 0) {
    var dExp = !!chipExpand['date'];
    var dShown = dExp ? hallDateList : hallDateList.slice(0, 5);
    h += '<div class="chips" style="margin-bottom:6px"><span class="muted" style="flex-shrink:0;line-height:30px;margin-right:4px">日期:</span><button class="chip' + (hallFilterDate === 'all' ? ' on' : '') + '" onclick="App.hallDate(\'all\')">全部</button>';
    dShown.forEach(function (d) { h += '<button class="chip' + (hallFilterDate === d ? ' on' : '') + '" onclick="App.hallDate(\'' + d + '\')">' + d.slice(5) + '</button>'; });
    if (hallDateList.length > 5) h += '<button class="chip more" onclick="App.toggleChip(\'date\')">' + (dExp ? '收起' : '更多 +' + (hallDateList.length - 5)) + '</button>';
    h += '</div>';
  }

  // 按业务类型
  h += '<div class="section-title" style="margin-top:6px">按业务类型</div>';
  HALL_BUSINESSES.forEach(function (t) { var d = hs.byType[t]; if (d && d.count) h += '<div class="frow"><div class="flabel">' + t + '</div><div class="ftrack"><div class="ffill" style="width:' + Math.max(2, Math.round(d.count / Math.max(hallFiltered.length, 1) * 100)) + '%"></div></div><div class="fval">' + d.count + ' 笔' + (d.amount ? ' ¥' + fmtMoney(d.amount) : '') + '</div></div>'; });

  // 按员工(柜员)表格
  h += '<div class="section-title" style="margin-top:10px">按柜员</div>';
  if (hs.byStaff.length) {
    h += '<div class="table-scroll"><table class="hall-tbl"><thead><tr><th>柜员</th><th>总笔数</th>';
    hallBizShort.forEach(function (t) { h += '<th>' + t + '</th>'; }); h += '<th>定存金额</th><th>理财金额</th></tr></thead><tbody>';
    hs.byStaff.forEach(function (s) { h += '<tr><td>' + esc(s.name) + '</td><td class="t-bold">' + s.total + '</td>'; hallBizLabels.forEach(function (t) { h += '<td>' + (s.types[t] || 0) + '</td>'; }); h += '<td>' + (s.deposit ? fmtMoney(s.deposit) : '') + '</td><td>' + (s.wealth ? fmtMoney(s.wealth) : '') + '</td></tr>'; });
    h += '</tbody></table></div>';
  } else { h += '<div class="empty">暂无数据</div>'; }

  // 记录列表(默认只显示最新5条,可展开全部)
  var hSorted = hallFiltered.slice().sort(function (a, b) { return (bizDay(b) || '').localeCompare(bizDay(a) || ''); });
  var listExpanded = !!hallListExpanded;
  var showSorted = listExpanded ? hSorted : hSorted.slice(0, 5);
  h += '<div class="section-title" style="margin-top:10px">筛选后的记录<span class="muted">共 ' + hSorted.length + ' 条</span></div>';
  if (showSorted.length) { showSorted.forEach(function (r) { h += '<div class="list-item" onclick="App.openHall(\'' + r.id + '\')"><div style="flex:1;min-width:0"><div style="font-weight:600">' + esc(r.clientName) + '<span class="muted" style="margin-left:5px">柜员 ' + esc(r.staffName) + '</span></div><div class="meta">' + esc((r.businesses || []).join(' + ')) + ' · ' + esc(r.customerType || '') + ' · 理财经理 ' + esc(r.contact || '—') + ' <span class="tag ' + handoffCls(r.handoffStatus) + '">' + handoffLabel(r.handoffStatus) + '</span></div></div><div class="meta" style="text-align:right">' + bizDay(r) + '</div></div>'; }); }
  else { h += '<div class="empty">暂无记录</div>'; }
  if (hSorted.length > 5) h += '<button class="btn btn-ghost btn-block" style="margin-top:6px" onclick="App.toggleList()">' + (listExpanded ? '收起' : '展开全部 ' + hSorted.length + ' 条') + '</button>';

  h += '<div class="btn-row" style="margin-top:8px"><button class="btn btn-primary" onclick="App.exportHallSummary()">导出汇总 CSV</button><button class="btn btn-ghost" onclick="App.exportHall()">导出明细 CSV</button></div></div>';

  // 员工账号
  var highsStaff = staffs.filter(function (s) { return s.type === 'hall'; });
  var lowsStaff = staffs.filter(function (s) { return s.type === 'low'; });
  h += '<div class="card"><div class="section-title">员工账号</div><div class="muted" style="margin-bottom:8px">创建后员工即可用「姓名+密码」登录</div>';
  h += '<div class="section-title" style="margin-top:6px">柜员<span class="muted">' + highsStaff.length + ' 人</span></div>';
  highsStaff.forEach(function (s) { h += acctRow(s); });
  if (!highsStaff.length) h += '<div class="empty">暂无柜员</div>';
  h += '<div class="section-title" style="margin-top:10px">理财经理<span class="muted">' + lowsStaff.length + ' 人</span></div>';
  lowsStaff.forEach(function (s) { h += acctRow(s); });
  if (!lowsStaff.length) h += '<div class="empty">暂无理财经理</div>';
  h += '<div class="form-row" style="margin-top:10px"><input id="ns-name" placeholder="员工姓名"></div>' +
    '<div class="form-row"><input id="ns-pwd" placeholder="登录密码(6位以上,含大小写+特殊字符)"></div>' +
    '<div class="form-row"><select id="ns-type"><option value="hall">柜员</option><option value="low">理财经理</option></select></div>' +
    '<button class="btn btn-primary btn-block" onclick="App.createStaff()">创建 / 重置</button></div>';

  // 数据管理
  h += '<div class="card"><div class="section-title">数据管理</div><div class="muted" style="margin-bottom:8px">对云端厅堂数据操作,请谨慎</div>' +
    '<div class="btn-row"><button class="btn btn-ghost" onclick="App.clearDemo()">清空演示数据</button><button class="btn btn-danger" onclick="App.resetAll()">重置全部数据</button></div></div>' +
    '<div class="btn-row"><button class="btn btn-ghost" onclick="App.logout()">退出管理员</button></div>' +
    '<div class="btn-row"><button class="btn btn-ghost" onclick="App.changeAdminPwd()">修改管理密码</button></div>';

  $('#app').innerHTML = h;
}
function chipRow(label, opts, cur, dim) {
  var h = '<div class="chips" style="margin-bottom:4px"><span class="muted" style="flex-shrink:0;line-height:30px;margin-right:4px">' + label + ':</span><button class="chip' + (cur === 'all' ? ' on' : '') + '" onclick="App.hallFilter(\'' + dim + '\',\'all\')">全部</button>';
  var expanded = !!chipExpand[dim];
  var shown = expanded ? opts : opts.slice(0, 5);
  shown.forEach(function (o) { h += '<button class="chip' + (cur === o ? ' on' : '') + '" onclick="App.hallFilter(\'' + dim + '\',\'' + esc(o) + '\')">' + esc(o) + '</button>'; });
  if (opts.length > 5) h += '<button class="chip more" onclick="App.toggleChip(\'' + dim + '\')">' + (expanded ? '收起' : '更多 +' + (opts.length - 5)) + '</button>';
  return h + '</div>';
}
function acctRow(s) {
  return '<div class="acct-row"><div class="acct-name">' + esc(s.name) + '</div><div class="muted">' + esc(s.id) + '</div><button class="mini-btn" onclick="App.shareLink(\'' + esc(s.name) + '\')">分享链接</button><button class="mini-btn danger" onclick="App.delStaff(\'' + s.id + '\',\'' + esc(s.name) + '\')">删除</button></div>';
}

/* ================= 全局动作 ================= */
window.App = {
  showAdmin: function () { location.hash = '#/login?role=manager'; },
  loginStaff: function () { var n = $('#li-name').value.trim(), p = $('#li-pwd').value.trim(); if (!n || !p) return toast('请输入姓名和密码'); api('POST', '/api/login', { role: 'staff', name: n, password: p }).then(function (r) { var t = r.staffType || 'card'; if (t === 'card') return toast('该账号是开卡员工,请用开卡系统', 3000); setToken(r.token); Session.set('staff', r.staffId, r.staffName, t); location.hash = '#/staff'; }).catch(function (e) { toast(e.message, 2500); }); },
  loginManager: function () { var p = $('#li-admin').value.trim(); if (!p) return toast('请输入管理密码'); api('POST', '/api/login', { role: 'manager', password: p, type: 'hall' }).then(function (r) { setToken(r.token); Session.set('manager', 'admin', '管理员'); location.hash = '#/manager'; }).catch(function (e) { toast(e.message, 2500); }); },
  logout: function () { if (!confirm('确认退出?')) return; Session.clear(); location.hash = '#/login'; },

  openHall: function (id) { location.hash = '#/hall' + (id ? '?id=' + id : ''); },
  openHandoff: function (id) { location.hash = '#/handoff?id=' + id; },
  newHall: function () { location.hash = '#/hall'; },
  exportHall: function () { var l = State.hall || []; if (!l.length) return toast('暂无数据'); downloadCSV('\u5385\u5802\u660e\u7ec6-' + todayKey() + '.csv', hallCsvRows(l)); },
  openPwd: function () { var o = prompt('请输入原密码:'); if (!o) return; var n = prompt('请输入新密码(' + PWD_RULE_MSG + '):'); if (!n) return; if (!isStrongPassword(n)) return toast(PWD_RULE_MSG, 2500); api('POST', '/api/change-password', { oldPassword: o, newPassword: n }).then(function () { toast('密码已修改'); }).catch(function (e) { toast(e.message, 2500); }); },

  hallInp: function (f, v) { HallForm[f] = v; },
  hallToggleBiz: function (k) { if (HallForm.readOnly) return; var i = HallForm.businesses.indexOf(k); if (i >= 0) HallForm.businesses.splice(i, 1); else HallForm.businesses.push(k); var cs = document.querySelectorAll('#hf-biz .chip'); cs.forEach(function (el) { el.className = 'chip' + (HallForm.businesses.indexOf(el.dataset.b) >= 0 ? ' on' : ''); }); var dr = $('#hf-dep-row'), wr = $('#hf-wealth-row'); if (dr) dr.style.display = HallForm.businesses.indexOf('\u5b9a\u671f\u5b58\u6b3e') >= 0 ? 'block' : 'none'; if (wr) wr.style.display = HallForm.businesses.indexOf('\u7406\u8d22') >= 0 ? 'block' : 'none'; },
  saveHall: function () { if (!HallForm.customerType) return toast('请选择客户来源'); if (!HallForm.bizDate) return toast('请选择业务日期'); if (!HallForm.businesses.length) return toast('请至少选一项业务类型'); if (!HallForm.contact) return toast('请选择交接的理财经理'); api('POST', '/api/hall/sync', { records: [{ id: HallForm.id || newId(), staffId: HallForm.staffId, staffName: HallForm.staffName, clientName: HallForm.clientName, clientNo: HallForm.clientNo, customerType: HallForm.customerType, bizDate: HallForm.bizDate, businesses: HallForm.businesses.slice(), depositAmount: num(HallForm.depositAmount), wealthAmount: num(HallForm.wealthAmount), contact: HallForm.contact }] }).then(function () { toast('已保存'); setTimeout(App.back, 500); }).catch(function (e) { toast(e.message, 2500); }); },
  delHall: function () { if (!confirm('确认删除?')) return; api('DELETE', '/api/hall?id=' + encodeURIComponent(HallForm.id)).then(function () { toast('已删除'); setTimeout(App.back, 500); }).catch(function (e) { toast(e.message, 2500); }); },

  handoffSet: function (st) { HandoffForm.status = st; var cs = document.querySelectorAll('#hf-status .chip'); cs.forEach(function (el) { el.className = 'chip'; }); if (st === 'success') cs[0].className = 'chip on'; if (st === 'pending') cs[1].className = 'chip on'; if (st === 'failed') cs[2].className = 'chip on'; },
  handoffNote: function (v) { HandoffForm.note = v; },
  saveHandoff: function () { if (!HandoffForm.status) return toast('请选择营销结果'); api('POST', '/api/hall/handoff', { id: HandoffForm.id, handoffStatus: HandoffForm.status, handoffNote: HandoffForm.note }).then(function () { toast('已保存'); setTimeout(App.back, 500); }).catch(function (e) { toast(e.message, 2500); }); },
  back: function () { history.back(); },

  hallFilter: function (d, v) { if (d === 'high') hallFilterHigh = v; else if (d === 'low') hallFilterLow = v; else if (d === 'biz') hallFilterBiz = v; else if (d === 'src') hallFilterSrc = v; drawManager(); },
  toggleChip: function (dim) { chipExpand[dim] = !chipExpand[dim]; drawManager(); },
  toggleList: function () { hallListExpanded = !hallListExpanded; drawManager(); },
  hallMonth: function (m) { hallMonthFilter = m; drawManager(); },
  hallDate: function (d) { hallFilterDate = d; drawManager(); },
  exportHallSummary: function () { var l = State.hall || []; if (!l.length) return toast('暂无数据'); downloadCSV('\u5385\u5802\u6c47\u603b-' + todayKey() + '.csv', hallSummaryCsv(l)); },
  createStaff: function () { var n = $('#ns-name').value.trim(), p = $('#ns-pwd').value.trim(), t = $('#ns-type').value; if (!n || !p) return toast('姓名和密码必填'); if (!isStrongPassword(p)) return toast(PWD_RULE_MSG, 2500); api('POST', '/api/staffs', { name: n, password: p, type: t }).then(function (r) { toast(r.updated ? '密码已重置' : '已创建 ' + n); renderManager(); }).catch(function (e) { toast(e.message, 2500); }); },
  delStaff: function (id, name) { if (!confirm('确认删除「' + name + '」?')) return; api('DELETE', '/api/staffs?id=' + encodeURIComponent(id)).then(function () { toast('已删除'); renderManager(); }).catch(function (e) { toast(e.message, 2500); }); },
  shareLink: function (name) { var u = location.origin + location.pathname + '#/login?name=' + encodeURIComponent(name), d = function () { toast('链接已复制'); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(d, function () { prompt('复制链接:', u); }); else prompt('复制链接:', u); },
  clearDemo: function () { if (!confirm('将删除演示记录,真实数据不受影响。')) return; api('POST', '/api/admin/clear-demo').then(function (r) { toast('已清除 ' + r.removed + ' 条'); renderManager(); }).catch(function (e) { toast(e.message, 2500); }); },
  resetAll: function () { if (!confirm('⚠️ 将删除云端全部厅堂数据且不可恢复!')) return; api('GET', '/api/hall/all').then(function (r) { return Promise.all((r || []).map(function (h) { return api('DELETE', '/api/hall?id=' + encodeURIComponent(h.id)); })); }).then(function () { toast('已全部清空'); renderManager(); }).catch(function (e) { toast(e.message, 2500); }); },
  changeAdminPwd: function () { var o = prompt('请输入当前管理密码:'); if (!o) return; var n = prompt('请输入新管理密码(' + PWD_RULE_MSG + '):'); if (!n) return; api('POST', '/api/admin/change-password', { oldPassword: o, newPassword: n, type: 'hall' }).then(function (r) { toast(r.msg || '已修改'); }).catch(function (e) { toast(e.message, 2500); }); }
};

/* ================= 启动 ================= */
if (API_BASE.indexOf('\u8bf7\u586b\u5165') >= 0) {
  $('#app').innerHTML = '<div class="card" style="margin-top:40px"><div class="section-title">尚未配置云函数地址</div><div class="muted" style="line-height:1.8">打开 web-hall/app.js,把顶部 API_BASE 改成云函数 HTTP 触发器地址。</div></div>';
} else { route(); }
})();
