/* app.js — H5 preview for 客户档案管家 */
(function () {
  'use strict';

  const STORAGE = {
    CLIENTS: 'h5_clients',
    STAFFS:  'h5_staffs',
    SESSION: 'h5_session',
    SEED:    'h5_seed_initialized'
  };

  // ---------- storage ----------
  const store = {
    get(k, fb) {
      try {
        const v = localStorage.getItem(k);
        return v === null || v === undefined ? fb : JSON.parse(v);
      } catch (e) { return fb; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    remove(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // ---------- session ----------
  const session = {
    get() { return store.get(STORAGE.SESSION); },
    set(s) { store.set(STORAGE.SESSION, s); },
    clear() { store.remove(STORAGE.SESSION); }
  };

  // ---------- custom UI dialogs (replace alert/confirm/prompt) ----------
  function toast(msg, duration) {
    duration = duration || 2000;
    var el = document.getElementById('wb-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wb-toast';
      el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(31,35,40,0.88);color:#fff;padding:10px 22px;border-radius:20px;font-size:14px;max-width:85vw;text-align:center;pointer-events:none;transition:opacity 0.3s;opacity:0;white-space:pre-line';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.display = '';
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.style.opacity = '0'; }, duration);
  }

  function confirmDialog(msg, onOk, onCancel) {
    // 如果已有弹窗则先移除
    var old = document.getElementById('wb-confirm');
    if (old) old.remove();
    var mask = document.createElement('div');
    mask.id = 'wb-confirm';
    mask.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center';
    mask.innerHTML = '<div style="background:#fff;border-radius:14px;padding:24px 20px 18px;max-width:300px;width:85%;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,0.18)">' +
      '<div style="font-size:15px;color:#1f2328;margin-bottom:20px;line-height:1.6;white-space:pre-line">' + escapeHTML(msg) + '</div>' +
      '<div style="display:flex;gap:12px">' +
        '<button id="wb-confirm-no" style="flex:1;height:42px;border-radius:10px;border:0;background:#eef0f7;color:#4a5160;font-size:15px;cursor:pointer;font-family:inherit">取消</button>' +
        '<button id="wb-confirm-yes" style="flex:1;height:42px;border-radius:10px;border:0;background:linear-gradient(90deg,#1f6feb,#4d8bff);color:#fff;font-size:15px;cursor:pointer;font-family:inherit">确认</button>' +
      '</div></div>';
    document.body.appendChild(mask);
    function close() { mask.remove(); }
    document.getElementById('wb-confirm-yes').addEventListener('click', function () { close(); if (onOk) onOk(); });
    document.getElementById('wb-confirm-no').addEventListener('click', function () { close(); if (onCancel) onCancel(); });
    mask.addEventListener('click', function (e) { if (e.target === mask) { close(); if (onCancel) onCancel(); } });
  }

  // ---------- utils ----------
  function nowIso() { return new Date().toISOString(); }
  function fmtDateTime(d) {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    const p = (n) => (n < 10 ? '0' + n : n);
    return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
  }
  function fmtDate(d) {
    const dt = new Date(d);
    const p = (n) => (n < 10 ? '0' + n : n);
    return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}`;
  }
  function today() { return fmtDate(new Date()); }
  function escapeHTML(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  }
  function escField(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(records, columns) {
    if (!records.length) return '';
    if (!columns) columns = Object.keys(records[0]).map((k) => ({ key: k, label: k }));
    const lines = [];
    lines.push(columns.map((c) => escField(c.label || c.key)).join(','));
    records.forEach((r) => lines.push(columns.map((c) => escField(r[c.key])).join(',')));
    return '\uFEFF' + lines.join('\n');
  }
  function downloadCSV(filename, csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  function newClientId() {
    return 'C' + Date.now().toString(36) + Math.floor(Math.random()*1000).toString(36);
  }

  // ---------- data ops ----------
  function getClients() { return store.get(STORAGE.CLIENTS, []); }
  function setClients(list) { store.set(STORAGE.CLIENTS, list); }
  function upsertClient(r) {
    const list = getClients();
    const i = list.findIndex((c) => c.id === r.id);
    r.updateTime = nowIso();
    if (i >= 0) {
      list[i] = Object.assign({}, list[i], r);
    } else {
      r.createTime = nowIso();
      list.unshift(r);
    }
    setClients(list);
  }
  function deleteClient(id) {
    setClients(getClients().filter((c) => c.id !== id));
  }
  function getStaffs() { return store.get(STORAGE.STAFFS, []); }
  function setStaffs(list) { store.set(STORAGE.STAFFS, list); }

  function classifyCondition(status) {
    // Now based on currentStatus field instead of free-text condition
    if (!status) return { tag: '未跟进', cls: 'tag amber' };
    if (/已签约|签约/.test(status)) return { tag: '已签约', cls: 'tag green' };
    if (/高意向/.test(status)) return { tag: '高意向', cls: 'tag green' };
    if (/跟进中/.test(status)) return { tag: '跟进中', cls: 'tag amber' };
    if (/已流失/.test(status)) return { tag: '已流失', cls: 'tag red' };
    if (/观望中/.test(status)) return { tag: '观望中', cls: 'tag gray' };
    return { tag: status, cls: 'tag' };
  }

  function seedDemoData() {
    const staffs = [
      { id: 'S001', name: '张丽',   total: 12, today: 1 },
      { id: 'S002', name: '李伟',   total: 9,  today: 2 },
      { id: 'S003', name: '王芳',   total: 7,  today: 0 },
      { id: 'S004', name: '陈强',   total: 15, today: 3 }
    ];
    setStaffs(staffs);
    const dt = (offset) => new Date(Date.now() - offset * 86400000).toISOString();
    const seed = [
      {
        id: 'demo_1', staffId: 'S001', staffName: '张丽',
        basic: { name: '刘建国', clientNo: 'K2025001', managedAmount: 500000, handler: '张丽' },
        timeNodes: {
          registerDate: '2025-03-15', cardDate: '2025-03-20',
          expectedDepositDate: '2025-04-01',
          depositDesc: '他行理财到期转入，预计金额 50万'
        },
        acquisition: {
          channel: '转介绍', acquirer: '张丽',
          referralManager: '王经理(建行)', claimStatus: '已认领', claimDate: '2025-03-16'
        },
        status: {
          currentStatus: '已签约',
          retentionProductType: '大额存单 + 基金定投',
          aum: 1200000, retentionReportDate: '2025-04-05',
          vipPotential: '中', riskPreference: '稳健型',
          remark: '资金实力强，偏好低风险配置，子女教育金储备需求'
        },
        createTime: dt(5), updateTime: dt(0)
      },
      {
        id: 'demo_2', staffId: 'S002', staffName: '李伟',
        basic: { name: '周敏', clientNo: 'K2025002', managedAmount: 0, handler: '李伟' },
        timeNodes: {
          registerDate: '2025-06-02', cardDate: '2025-06-05',
          expectedDepositDate: '2025-07-15',
          depositDesc: '出售房产回款，预计到账 300万'
        },
        acquisition: {
          channel: '抖音/快手', acquirer: '李伟',
          referralManager: '', claimStatus: '已认领', claimDate: '2025-06-03'
        },
        status: {
          currentStatus: '高意向',
          retentionProductType: '结构性存款 + 保险',
          aum: 800000, retentionReportDate: '',
          vipPotential: '高', riskPreference: '平衡型',
          remark: '7月直播引流获客，对结构性产品兴趣浓厚，需抓紧跟进出方案'
        },
        createTime: dt(3), updateTime: dt(3)
      },
      {
        id: 'demo_3', staffId: 'S002', staffName: '李伟',
        basic: { name: '孙浩', clientNo: 'K2025003', managedAmount: 300000, handler: '李伟' },
        timeNodes: {
          registerDate: '2025-02-10', cardDate: '2025-02-12',
          expectedDepositDate: '2025-02-28',
          depositDesc: '年终奖到账，一次性存入 30万'
        },
        acquisition: {
          channel: '电销', acquirer: '李伟',
          referralManager: '', claimStatus: '无需认领', claimDate: ''
        },
        status: {
          currentStatus: '跟进中',
          retentionProductType: '短期理财',
          aum: 600000, retentionReportDate: '2025-03-01',
          vipPotential: '低', riskPreference: '保守型',
          remark: '公司分配名单，偏好短期灵活产品，在对比竞品利率'
        },
        createTime: dt(10), updateTime: dt(1)
      },
      {
        id: 'demo_4', staffId: 'S004', staffName: '陈强',
        basic: { name: '黄丽', clientNo: 'K2025004', managedAmount: 800000, handler: '陈强' },
        timeNodes: {
          registerDate: '2025-05-20', cardDate: '2025-05-25',
          expectedDepositDate: '2025-06-10',
          depositDesc: '综合资产归集，覆盖存款+理财+保险'
        },
        acquisition: {
          channel: '小红书', acquirer: '陈强',
          referralManager: '李明(工行)', claimStatus: '已认领', claimDate: '2025-05-22'
        },
        status: {
          currentStatus: '已签约',
          retentionProductType: '信托计划 + 终身寿险 + 基金组合',
          aum: 2000000, retentionReportDate: '2025-06-12',
          vipPotential: '高', riskPreference: '进取型',
          remark: '私行级潜力客户，需深度经营，每季度面访一次'
        },
        createTime: dt(7), updateTime: dt(1)
      }
    ];
    seed.forEach((c) => upsertClient(c));
  }

  // seed once
  if (!store.get(STORAGE.SEED)) {
    seedDemoData();
    store.set(STORAGE.SEED, true);
  }

  // ---------- form field groups ----------
  var GROUPS = ['basic', 'timeNodes', 'acquisition', 'status'];

  function collectByGroup(group) {
    var obj = {};
    document.querySelectorAll('#tabFill [data-group="' + group + '"]').forEach(function (el) {
      var v = el.value.trim();
      if (el.type === 'number') v = parseFloat(v) || 0;
      obj[el.dataset.key] = v;
    });
    return obj;
  }

  // ---------- routing ----------
  const ROUTES = {
    '':           'renderHome',
    'home':       'renderHome',
    'staff':      'renderStaff',
    'form':       'renderForm',
    'manager':    'renderManager',
    'detail':     'renderDetail'
  };

  let currentRoute = '';
  let currentRecordId = '';

  function getQuery() {
    const p = new URLSearchParams(location.search);
    const obj = {};
    p.forEach((v, k) => { obj[k] = v; });
    return obj;
  }
  function setRoute(name, query) {
    const q = query ? ('?' + new URLSearchParams(query).toString()) : '';
    history.pushState({}, '', location.pathname + q + (name ? '#' + name : ''));
    renderRoute();
  }
  function parseHash() {
    const h = location.hash.replace(/^#/, '');
    return h;
  }
  function renderRoute() {
    const hash = parseHash();
    currentRoute = hash;
    const fn = ROUTES[hash] || 'renderHome';
    window[fn]();
  }
  window.addEventListener('popstate', renderRoute);
  window.addEventListener('hashchange', renderRoute);

  // ---------- shared helpers ----------
  function mount(html) {
    document.getElementById('app').innerHTML = html;
    window.scrollTo(0, 0);
  }
  function ensureStaff() {
    const s = session.get();
    if (!s || s.role !== 'staff') {
      toast('请先用员工身份登录');
      setRoute('');
      return null;
    }
    return s;
  }
  function ensureManager() {
    const s = session.get();
    if (!s || s.role !== 'manager') {
      toast('请先用管理员身份登录');
      setRoute('');
      return null;
    }
    return s;
  }

  // ---------- pages ----------
  window.renderHome = function () {
    const tpl = document.getElementById('tpl-home');
    mount(tpl.innerHTML);

    // 绑定所有 data-action 按钮
    document.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', onAction);
    });

    // 员工姓名内联表单
    var nameForm  = document.getElementById('staffNameForm');
    var nameInput = document.getElementById('staffNameInput');
    var nameBtn   = document.getElementById('staffNameConfirm');
    var nameErr   = document.getElementById('staffNameError');
    if (nameBtn) {
      nameBtn.addEventListener('click', function () {
        var n = (nameInput.value || '').trim();
        if (!n) {
          nameErr.style.display = ''; nameErr.textContent = '请输入姓名';
          return;
        }
        nameErr.style.display = 'none';
        doEnterStaff(n);
      });
      nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { nameBtn.click(); }
      });
    }
  };

  window.renderStaff = function () {
    var s = ensureStaff(); if (!s) return;
    var tpl = document.getElementById('tpl-staff');
    mount(tpl.innerHTML);

    // Profile
    document.getElementById('staffName').textContent = s.staffName;
    document.getElementById('staffId').textContent   = s.staffId;
    document.getElementById('staffInitial').textContent = (s.staffName || '员')[0];

    // Tab switching
    currentRecordId = '';
    switchTab('fill'); // 默认显示填报

    document.querySelectorAll('.tabbar-item').forEach(function (el) {
      el.addEventListener('click', function () {
        switchTab(this.dataset.tab);
      });
    });

    // 绑定全部按钮事件
    document.querySelectorAll('[data-action]').forEach(function (el) {
      el.addEventListener('click', onStaffAction);
    });

    // 记录页搜索
    var searchEl = document.getElementById('recSearch');
    if (searchEl) {
      searchEl.addEventListener('input', function () { refreshRecords(); });
    }
  };

  function switchTab(tab) {
    // 更新 tab 样式
    document.querySelectorAll('.tabbar-item').forEach(function (el) {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    // 切换内容区
    document.querySelectorAll('.tab-content').forEach(function (el) {
      el.style.display = 'none';
    });
    var contentMap = { fill: 'tabFill', records: 'tabRecords', stats: 'tabStats' };
    var target = document.getElementById(contentMap[tab]);
    if (target) target.style.display = 'block';

    // 刷新对应内容
    if (tab === 'records') refreshRecords();
    if (tab === 'stats')   refreshMyStats();
  }

  // ────── 填报表单 ──────
  function collectStaffForm() {
    return {
      basic:       collectByGroup('basic'),
      timeNodes:   collectByGroup('timeNodes'),
      acquisition: collectByGroup('acquisition'),
      status:      collectByGroup('status')
    };
  }

  function clearStaffForm() {
    document.querySelectorAll('#tabFill .finput, #tabFill .ftextarea').forEach(function (el) {
      el.value = '';
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
    });
  }

  function loadRecordIntoForm(rec) {
    currentRecordId = rec.id;
    GROUPS.forEach(function (group) {
      var data = rec[group] || {};
      Object.keys(data).forEach(function (k) {
        var el = document.querySelector('#tabFill [data-key="' + k + '"][data-group="' + group + '"]');
        if (el) el.value = data[k] !== undefined && data[k] !== null ? data[k] : '';
      });
    });
    document.getElementById('delRow').style.display = '';
    window.scrollTo(0, 0);
  }

  // ────── 记录 ──────
  function refreshRecords() {
    var s = session.get();
    var kw = (document.getElementById('recSearch') || {}).value || '';
    kw = kw.trim();
    var all = getClients().filter(function (c) { return c.staffId === s.staffId; });
    all.sort(function (a, b) { return (b.createTime || '').localeCompare(a.createTime || ''); });

    var list = kw ? all.filter(function (c) {
      var b = c.basic || {};
      return (b.name || '').indexOf(kw) !== -1
          || (b.clientNo || '').indexOf(kw) !== -1
          || (b.handler || '').indexOf(kw) !== -1
          || (c.status && c.status.retentionProductType || '').indexOf(kw) !== -1;
    }) : all;

    var box = document.getElementById('recList');
    if (!list.length) {
      box.innerHTML = '<div class="empty">' + (kw ? '没有匹配记录' : '暂无填报记录') + '</div>';
      return;
    }

    var fmoney = function (v) {
      if (!v) return '';
      if (v >= 10000) return '¥' + (v / 10000).toFixed(1) + '万';
      return '¥' + v.toLocaleString();
    };

    box.innerHTML = list.map(function (c) {
      var b = c.basic || {};
      var st = c.status || {};
      var acq = c.acquisition || {};
      var tag = classifyCondition(st.currentStatus);
      var amt = [];
      if (b.managedAmount) amt.push('托管: ' + fmoney(b.managedAmount));
      if (st.aum) amt.push('AUM: ' + fmoney(st.aum));
      var extra = [];
      if (st.retentionProductType) extra.push(st.retentionProductType);
      if (st.vipPotential) extra.push('VIP' + st.vipPotential);
      return '<div class="rec-item" data-id="' + c.id + '">' +
        '<div class="rec-header">' +
          '<div><span class="rec-name">' + escapeHTML(b.name || '(未填写)') + '</span>' +
            ' <span class="' + tag.cls + '">' + tag.tag + '</span></div>' +
          '<div class="rec-date">' + escapeHTML(fmtDateTime(c.createTime).slice(0, 16)) + '</div>' +
        '</div>' +
        '<div class="rec-meta">' +
          escapeHTML(b.clientNo || '') + ' · 经办: ' + escapeHTML(b.handler || '—') +
          (acq.channel ? ' · ' + escapeHTML(acq.channel) : '') +
        '</div>' +
        (extra.length ? '<div class="rec-meta">' + escapeHTML(extra.join(' · ')) + '</div>' : '') +
        (amt.length ? '<div class="rec-meta" style="color:#1f6feb">' + escapeHTML(amt.join(' · ')) + '</div>' : '') +
        '<div class="rec-actions">' +
          '<button class="btn-edit" style="background:#eaf0ff;color:#1f6feb" data-action="editRec" data-id="' + c.id + '">编辑</button>' +
          '<button class="btn-del" style="background:#ffeaea;color:#e54848" data-action="delRec" data-id="' + c.id + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-action="editRec"]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = this.dataset.id;
        var rec = getClients().find(function (c) { return c.id === id; });
        if (rec) { loadRecordIntoForm(rec); switchTab('fill'); }
      });
    });
    box.querySelectorAll('[data-action="delRec"]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = this.dataset.id;
        confirmDialog('确认删除这条记录？\n删除后不可恢复', function () {
          setClients(getClients().filter(function (c) { return c.id !== id; }));
          toast('已删除');
          refreshRecords();
          refreshMyStats();
        });
      });
    });
  }

  // ────── 统计 ──────
  function refreshMyStats() {
    var s = session.get();
    var all = getClients().filter(function (c) { return c.staffId === s.staffId; });
    var totalCount = all.length;

    // 留存 = 有留存产品类型或已签约的
    var retained = all.filter(function (c) {
      var st = c.status || {};
      return st.retentionProductType || /已签约/.test(st.currentStatus || '');
    }).length;

    // 待处理 = 跟进中/高意向/观望中(非签约非流失)
    var pending = all.filter(function (c) {
      var st = c.status || {};
      return st.currentStatus && !/已签约|已流失/.test(st.currentStatus);
    }).length;

    var managedAmount = 0, totalAUM = 0, retentionAmount = 0;
    all.forEach(function (c) {
      managedAmount += (c.basic && c.basic.managedAmount) || 0;
      totalAUM      += (c.status && c.status.aum) || 0;
      retentionAmount += (c.status && c.status.retentionAmount) || 0;
    });

    var fmoney = function (v) {
      if (!v) return '0';
      if (v >= 10000) return (v / 10000).toFixed(1) + '万';
      return v.toLocaleString();
    };

    document.getElementById('statsGrid').innerHTML =
      '<div class="stat-card highlight" onclick="window._staffStatDetail(\'all\')">' +
        '<div class="s-num">' + totalCount + '</div><div class="s-label">总笔数</div></div>' +
      '<div class="stat-card" onclick="window._staffStatDetail(\'retained\')">' +
        '<div class="s-num">' + retained + '</div><div class="s-label">留存</div></div>' +
      '<div class="stat-card" onclick="window._staffStatDetail(\'pending\')">' +
        '<div class="s-num">' + pending + '</div><div class="s-label">待处理</div></div>' +
      '<div class="stat-card">' +
        '<div class="s-num">¥' + fmoney(managedAmount) + '</div><div class="s-label">托管金额</div></div>' +
      '<div class="stat-card">' +
        '<div class="s-num">¥' + fmoney(totalAUM) + '</div><div class="s-label">AUM</div></div>' +
      '<div class="stat-card">' +
        '<div class="s-num">¥' + fmoney(retentionAmount) + '</div><div class="s-label">留存量</div></div>';

    // 渠道分布
    var cm = {};
    all.forEach(function (c) {
      var ch = (c.acquisition && c.acquisition.channel) ? c.acquisition.channel : '未填写';
      cm[ch] = (cm[ch] || 0) + 1;
    });
    var total = Math.max(all.length, 1);
    var channelStats = Object.keys(cm).map(function (k) {
      return { channel: k, count: cm[k], percent: Math.round(cm[k] / total * 100) };
    }).sort(function (a, b) { return b.count - a.count; });

    document.getElementById('myChannelStats').innerHTML = channelStats.length
      ? channelStats.map(function (c) {
          return '<div class="bar-row">' +
            '<div class="bar-label">' + escapeHTML(c.channel) + '</div>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + c.percent + '%"></div></div>' +
            '<div class="bar-num">' + c.count + '</div></div>';
        }).join('')
      : '<div class="empty">暂无渠道数据</div>';
    document.getElementById('myChannelCount').textContent = channelStats.length + ' 个渠道';
  }

  // 点击统计卡片查看明细
  window._staffStatDetail = function (type) {
    var s = session.get();
    var all = getClients().filter(function (c) { return c.staffId === s.staffId; });
    var filtered;
    if (type === 'retained') {
      filtered = all.filter(function (c) {
        var st = c.status || {};
        return st.retentionProductType || /已签约/.test(st.currentStatus || '');
      });
    } else if (type === 'pending') {
      filtered = all.filter(function (c) {
        var st = c.status || {};
        return st.currentStatus && !/已签约|已流失/.test(st.currentStatus);
      });
    } else {
      filtered = all;
    }
    var labels = { all: '全部', retained: '留存', pending: '待处理' };
    var msg = (labels[type] || '') + '客户 (' + filtered.length + ' 条):\n';
    filtered.sort(function (a, b) { return (b.createTime || '').localeCompare(a.createTime || ''); });
    filtered.slice(0, 50).forEach(function (c, i) {
      var b = c.basic || {};
      var st = c.status || {};
      msg += (i+1) + '. ' + b.name + '  ' + (b.clientNo || '') + '  [' + (st.currentStatus || '未跟进') + ']\n';
    });
    toast(msg, 5000);
  };

  // ────── 按钮派发 ──────
  function onStaffAction(e) {
    var a = e.currentTarget.dataset.action;
    if (a === 'saveDraft' || a === 'submit')   { return doSaveStaffForm(a); }
    if (a === 'del')                            { return doDelCurrent(); }
    if (a === 'logout')                         { confirmDialog('确认退出当前账号?', function () { session.clear(); setRoute(''); }); return; }
    if (a === 'exportMyCSV')                    { return doExportMyCSV(); }
    if (a === 'uploadMine')                     { return doUploadMine(); }
    if (a === 'clearRecSearch')                 { var el = document.getElementById('recSearch'); if (el) { el.value = ''; refreshRecords(); } return; }
  }

  function doSaveStaffForm(act) {
    var s  = session.get();
    var data = collectStaffForm();
    if (!data.basic.name) { toast('客户姓名必填'); return; }
    if (!data.basic.clientNo) { toast('客户号必填'); return; }
    if (!data.basic.handler) { toast('经办人必填'); return; }
    var rec = {
      id: currentRecordId || newClientId(),
      staffId: s.staffId, staffName: s.staffName,
      basic: data.basic, timeNodes: data.timeNodes,
      acquisition: data.acquisition, status: data.status
    };
    upsertClient(rec);

    if (!currentRecordId) {
      var staffs = getStaffs();
      var me = staffs.find(function (x) { return x.id === s.staffId; });
      if (me) { me.total = (me.total || 0) + 1; setStaffs(staffs); }
    }

    if (act === 'submit') {
      toast('已保存');
      clearStaffForm();
      currentRecordId = '';
      document.getElementById('delRow').style.display = 'none';
      switchTab('records');
    } else {
      toast('草稿已存');
    }
  }

  function doDelCurrent() {
    if (!currentRecordId) return;
    confirmDialog('确认删除此客户？\n删除后不可恢复', function () {
      deleteClient(currentRecordId);
      currentRecordId = '';
      clearStaffForm();
      document.getElementById('delRow').style.display = 'none';
      toast('已删除');
      refreshRecords();
      refreshMyStats();
    });
  }

  function doExportMyCSV() {
    var s = session.get();
    var list = getClients().filter(function (c) { return c.staffId === s.staffId; });
    if (!list.length) { toast('暂无可导出数据'); return; }
    var csv = toCSV(list.map(function (c) { return {
      name:                c.basic.name,
      clientNo:            c.basic.clientNo,
      managedAmount:       c.basic.managedAmount,
      handler:             c.basic.handler,
      registerDate:        c.timeNodes.registerDate,
      cardDate:            c.timeNodes.cardDate,
      expectedDepositDate: c.timeNodes.expectedDepositDate,
      depositDesc:         c.timeNodes.depositDesc,
      channel:             c.acquisition.channel,
      acquirer:            c.acquisition.acquirer,
      referralManager:     c.acquisition.referralManager,
      claimStatus:         c.acquisition.claimStatus,
      claimDate:           c.acquisition.claimDate,
      currentStatus:       c.status.currentStatus,
      retentionProductType:c.status.retentionProductType,
      aum:                 c.status.aum,
      retentionReportDate: c.status.retentionReportDate,
      retentionAmount:     c.status.retentionAmount,
      vipPotential:        c.status.vipPotential,
      riskPreference:      c.status.riskPreference,
      remark:              c.status.remark,
      staffName:           c.staffName,
      createTime:          fmtDateTime(c.createTime),
      updateTime:          fmtDateTime(c.updateTime)
    }; }));
    downloadCSV('员工-'+s.staffName+'-'+today()+'.csv', csv);
  }

  function doUploadMine() {
    var s = session.get();
    var list = getClients().filter(function (c) { return c.staffId === s.staffId; });
    confirmDialog('即将上传 ' + list.length + ' 条客户数据到总部服务器，是否继续？', function () {
      // fetch('https://your-server.com/api/clients/upload', {
      //   method:'POST',
      //   headers:{'Content-Type':'application/json'},
      //   body: JSON.stringify({ staff: s.staffId, list })
      // });
      toast('(模拟) 已上传 ' + list.length + ' 条数据\n接入真实服务器时取消 fetch 注释即可');
    });
  }

  // ---------- form ----------
  window.renderForm = function () {
    const s = ensureStaff(); if (!s) return;
    const q = getQuery();
    const tpl = document.getElementById('tpl-form');
    mount(tpl.innerHTML);

    const editing = q.mode === 'edit' && q.id;
    const isQr = q.from === 'qrcode';

    document.getElementById('formTitle').textContent = editing ? '编辑客户' : '新建客户';
    if (isQr) {
      document.getElementById('qrTip').style.display = '';
      document.getElementById('qrTipName').textContent = s.staffName;
    }

    if (editing) {
      const rec = getClients().find((c) => c.id === q.id);
      if (rec) {
        currentRecordId = rec.id;
        hydrateForm(rec);
      }
      document.getElementById('delRow').style.display = '';
    } else {
      currentRecordId = '';
    }

    document.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', onFormAction);
    });
  };

  function hydrateForm(rec) {
    GROUPS.forEach(function (group) {
      var data = rec[group] || {};
      Object.keys(data).forEach(function (k) {
        var el = document.querySelector('[data-key="' + k + '"][data-group="' + group + '"]');
        if (el) el.value = data[k] !== undefined && data[k] !== null ? data[k] : '';
      });
    });
  }

  function collectForm() {
    var data = {};
    GROUPS.forEach(function (g) {
      data[g] = {};
      document.querySelectorAll('[data-group="' + g + '"]').forEach(function (el) {
        var v = el.value.trim();
        if (el.type === 'number') v = parseFloat(v) || 0;
        data[g][el.dataset.key] = v;
      });
    });
    return data;
  }

  function onFormAction(e) {
    var a = e.currentTarget.dataset.action;
    var s = session.get();
    if (a === 'saveDraft' || a === 'submit') {
      var data = collectForm();
      if (!data.basic.name || !data.basic.clientNo || !data.basic.handler) {
        toast('姓名/客户号/经办人必填'); return;
      }
      var rec = { id: currentRecordId || newClientId(), staffId: s.staffId, staffName: s.staffName };
      GROUPS.forEach(function (g) { rec[g] = data[g]; });
      upsertClient(rec);
      if (a === 'submit') {
        if (!currentRecordId) {
          var staffs = getStaffs();
          var me = staffs.find(function (x) { return x.id === s.staffId; });
          if (me) { me.total = (me.total || 0) + 1; setStaffs(staffs); }
        }
        toast('已保存');
        setRoute('staff');
      } else {
        toast('草稿已存,数据保存在本机');
      }
    }
    if (a === 'del') {
      if (!currentRecordId) return;
      confirmDialog('确认删除此客户?', function () {
        deleteClient(currentRecordId);
        toast('已删除');
        setRoute('staff');
      });
    }
  }

  // ---------- manager ----------
  window.renderManager = function () {
    ensureManager();
    const tpl = document.getElementById('tpl-manager');
    mount(tpl.innerHTML);
    refreshManagerPage();
    document.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', onManagerAction);
    });
    const kw = document.getElementById('mKw');
    if (kw) kw.addEventListener('input', () => applyFilter(kw.value));
  };

  function refreshManagerPage() {
    const all = getClients();
    const staffs = getStaffs();
    const todayS = today();
    let todayCount = 0, signed = 0, intent = 0, following = 0;

    const decorated = all.map((c) => {
      const st = c.status || {};
      const tag = classifyCondition(st.currentStatus);
      if (fmtDateTime(c.createTime).indexOf(todayS) === 0) todayCount++;
      if (tag.tag === '已签约') signed++;
      if (tag.tag === '高意向') intent++;
      if (tag.tag === '跟进中') following++;
      return { c, tag, upd: fmtDateTime(c.updateTime) };
    });

    document.getElementById('mKpiStaffs').textContent   = staffs.length;
    document.getElementById('mKpiClients').textContent  = all.length;
    document.getElementById('mKpiToday').textContent    = todayCount;
    document.getElementById('mKpiSigned').textContent   = signed;
    document.getElementById('mKpiIntent').textContent   = intent;
    document.getElementById('mKpiFollowing').textContent= following;
    document.getElementById('mAllCount').textContent    = all.length;

    // staff summary
    const summary = staffs.map((s) => {
      const list = decorated.filter((x) => x.c.staffId === s.id)
        .sort((a, b) => b.upd.localeCompare(a.upd));
      return {
        id: s.id, name: s.name, count: list.length,
        recent: list.length ? '最近: ' + (list[0].c.basic ? list[0].c.basic.name : '') + ' · ' + list[0].upd.slice(5, 16) : '尚未提交客户'
      };
    }).sort((a, b) => b.count - a.count);

    document.getElementById('staffSummary').innerHTML = summary.length
      ? summary.map((s, i) => `
        <div class="staff-row" data-sid="${s.id}">
          <div class="staff-rank">${i + 1}</div>
          <div class="staff-info">
            <div class="staff-name">${escapeHTML(s.name)}</div>
            <div class="muted" style="font-size:12px">${escapeHTML(s.recent)}</div>
          </div>
          <div class="staff-meta">
            <div class="staff-num">${s.count}</div>
            <div class="muted" style="font-size:12px">客户数</div>
          </div>
        </div>
      `).join('') : '<div class="empty">暂无员工业绩</div>';

    document.querySelectorAll('#staffSummary .staff-row').forEach((el) => {
      el.addEventListener('click', () => {
        const sid = el.dataset.sid;
        const list = decorated.filter((x) => x.c.staffId === sid);
        const sm = summary.find((x) => x.id === sid);
        let msg = `员工 ${sm ? sm.name : sid} 共 ${list.length} 位客户:\n`;
        list.slice(0, 30).forEach((it, i) => {
          var b = it.c.basic || {};
          var st = it.c.status || {};
          msg += `${i+1}. ${b.name}  ${b.clientNo || ''}  [${st.currentStatus || '未跟进'}]\n`;
        });
        toast(msg);
      });
    });

    // channel stats
    const cm = {};
    decorated.forEach((x) => {
      const ch = (x.c.acquisition && x.c.acquisition.channel) ? x.c.acquisition.channel : '未填写';
      cm[ch] = (cm[ch] || 0) + 1;
    });
    const total = Math.max(decorated.length, 1);
    const channelStats = Object.keys(cm)
      .map((k) => ({ channel: k, count: cm[k], percent: Math.round(cm[k] / total * 100) }))
      .sort((a, b) => b.count - a.count);
    document.getElementById('channelStats').innerHTML = channelStats.length
      ? channelStats.map((c) => `
        <div class="bar-row">
          <div class="bar-label">${escapeHTML(c.channel)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${c.percent}%"></div></div>
          <div class="bar-num">${c.count}</div>
        </div>
      `).join('') : '<div class="empty">暂无论据</div>';
    document.getElementById('channelCount').textContent = `${channelStats.length} 个渠道`;

    // allList
    window.__mgrAll = decorated;
    applyFilter(document.getElementById('mKw') ? document.getElementById('mKw').value : '');
  }

  function applyFilter(kw) {
    const decorated = window.__mgrAll || [];
    const w = (kw || '').trim();
    const list = !w ? decorated : decorated.filter((x) => {
      var b = x.c.basic || {};
      return (b.name || '').includes(w)
          || (b.clientNo || '').includes(w)
          || (b.handler || '').includes(w)
          || (x.c.staffName || '').includes(w);
    });
    const html = list.length ? list.map((it) => {
      var b = it.c.basic || {};
      var acq = it.c.acquisition || {};
      return `
      <div class="list-item" data-id="${it.c.id}">
        <div>
          <div style="font-weight:600">
            <span class="${it.tag.cls}">${it.tag.tag}</span>
            ${escapeHTML(b.name)}
            <span class="muted" style="font-size:11px;margin-left:6px">by ${escapeHTML(it.c.staffName)}</span>
          </div>
          <div class="meta">${escapeHTML(b.clientNo)} · 经办: ${escapeHTML(b.handler || '—')} · ${escapeHTML(acq.channel || '—')}</div>
        </div>
        <div class="meta">${escapeHTML(it.upd.slice(5, 16))}</div>
      </div>
    `; }).join('') : '<div class="empty">没有匹配记录</div>';

    document.getElementById('allList').innerHTML = html;
    document.querySelectorAll('#allList .list-item').forEach((el) => {
      el.addEventListener('click', () => {
        currentRecordId = el.dataset.id;
        setRoute('form', { mode: 'edit', id: el.dataset.id });
      });
    });
  }

  function onManagerAction(e) {
    const a = e.currentTarget.dataset.action;
    if (a === 'exportAllCSV')      return doExportAll();
    if (a === 'exportStaffSummary')return doExportStaffSummary();
    if (a === 'generateQRCode')    return doShowQrModal();
    if (a === 'closeQr')           { document.getElementById('qrModal').style.display = 'none'; return; }
    if (a === 'clearKw')           { const kw = document.getElementById('mKw'); if (kw) { kw.value=''; applyFilter(''); } return; }
    if (a === 'logout')            { confirmDialog('退出管理员?', function () { session.clear(); setRoute(''); }); return; }
  }

  function doExportAll() {
    const all = getClients();
    if (!all.length) { toast('暂无数据'); return; }
    const csv = toCSV(all.map((c) => ({
      name:                c.basic.name,
      clientNo:            c.basic.clientNo,
      managedAmount:       c.basic.managedAmount,
      handler:             c.basic.handler,
      registerDate:        c.timeNodes.registerDate,
      cardDate:            c.timeNodes.cardDate,
      expectedDepositDate: c.timeNodes.expectedDepositDate,
      depositDesc:         c.timeNodes.depositDesc,
      channel:             c.acquisition.channel,
      acquirer:            c.acquisition.acquirer,
      referralManager:     c.acquisition.referralManager,
      claimStatus:         c.acquisition.claimStatus,
      claimDate:           c.acquisition.claimDate,
      currentStatus:       c.status.currentStatus,
      retentionProductType:c.status.retentionProductType,
      aum:                 c.status.aum,
      retentionReportDate: c.status.retentionReportDate,
      retentionAmount:     c.status.retentionAmount,
      vipPotential:        c.status.vipPotential,
      riskPreference:      c.status.riskPreference,
      remark:              c.status.remark,
      staffName:           c.staffName,
      createTime:          fmtDateTime(c.createTime),
      updateTime:          fmtDateTime(c.updateTime)
    })));
    downloadCSV(`全量数据-${today()}.csv`, csv);
  }

  function doExportStaffSummary() {
    const staffs = getStaffs();
    const all = getClients();
    const csv = toCSV(staffs.map((s) => {
      const list = all.filter((c) => c.staffId === s.id);
      return {
        id: s.id, name: s.name,
        total: list.length,
        todayAdd: list.filter((c) => fmtDateTime(c.createTime).indexOf(today()) === 0).length,
        signed: list.filter((c) => (c.status && /已签约/.test(c.status.currentStatus || ''))).length,
        totalAUM: list.reduce((sum, c) => sum + ((c.status && c.status.aum) || 0), 0),
        totalManaged: list.reduce((sum, c) => sum + ((c.basic && c.basic.managedAmount) || 0), 0)
      };
    }));
    downloadCSV(`员工业绩-${today()}.csv`, csv);
  }

  // ---------- QR Code modal ----------
  function doShowQrModal() {
    const staffs = getStaffs();
    const hostBase = location.origin + location.pathname;
    document.getElementById('qrList').innerHTML = staffs.length
      ? staffs.map((s) => {
          const url = `${hostBase}?role=staff&sid=${s.id}&sname=${encodeURIComponent(s.name)}#form`;
          const id = 'qr_' + s.id;
          setTimeout(() => {
            const canvas = document.getElementById(id);
            if (!canvas) return;
            try {
              QRCode.toCanvas(canvas, url, { width: 84, margin: 1, color: { dark: '#1f2328', light: '#fff' } });
            } catch (e) { /* ignore */ }
          }, 0);
          return `
            <div class="qr-block">
              <canvas id="${id}"></canvas>
              <div class="qr-info">
                <b>${escapeHTML(s.name)} <span class="muted" style="font-weight:400">(${escapeHTML(s.id)})</span></b>
                <small>${escapeHTML(url)}</small>
              </div>
            </div>
          `;
        }).join('')
      : '<div class="empty">暂无员工</div>';
    document.getElementById('qrModal').style.display = '';
  }

  // ---------- detail (single page) ----------
  window.renderDetail = function () {
    // 直接重定向到表单(支持编辑)
    setRoute('form', { mode: 'edit', id: currentRecordId });
  };

  function doEnterStaff(name) {
    var staffs = getStaffs();
    var s = staffs.find(function (x) { return x.name === name; });
    if (!s) {
      s = { id: 'S' + Date.now().toString().slice(-5), name: name, total: 0, today: 0 };
      staffs.push(s); setStaffs(staffs);
    }
    session.set({ role: 'staff', staffId: s.id, staffName: s.name });
    setRoute('staff');
  }

  // ---------- home actions ----------
  function onAction(e) {
    var a = e.currentTarget.dataset.action;
    if (a === 'enterStaff') {
      // 显示/隐藏内联姓名表单
      var form = document.getElementById('staffNameForm');
      var input = document.getElementById('staffNameInput');
      var err = document.getElementById('staffNameError');
      if (!form || !input) return;
      if (form.style.display === 'none' || !form.style.display) {
        form.style.display = 'flex';
        if (err) err.style.display = 'none';
        input.value = '张丽';
        setTimeout(function () { input.focus(); input.select(); }, 50);
      } else {
        form.style.display = 'none';
        if (err) err.style.display = 'none';
      }
      return;
    }
    if (a === 'enterManager') {
      session.set({ role: 'manager', staffId: '', staffName: '管理员' });
      setRoute('manager');
    }
    if (a === 'simulateQrStaff') {
      const s = getStaffs()[0] || { id: 'S001', name: '张丽' };
      session.set({ role: 'staff', staffId: s.id, staffName: s.name });
      currentRecordId = '';
      setRoute('form', { from: 'qrcode' });
    }
    if (a === 'simulateQrAdmin') {
      session.set({ role: 'manager', staffId: '', staffName: '管理员' });
      setRoute('manager');
    }
    if (a === 'resetData') {
      confirmDialog('将清空所有数据并重新植入演示数据。继续?', function () {
        [STORAGE.CLIENTS, STORAGE.STAFFS, STORAGE.SESSION, STORAGE.SEED].forEach(function (k) { store.remove(k); });
        seedDemoData();
        store.set(STORAGE.SEED, true);
        toast('已重置');
        setRoute('');
      }); return;
    }
  }

  // ---------- onload ----------
  document.addEventListener('DOMContentLoaded', () => {
    const q = getQuery();
    if (q.role === 'staff' && q.sid) {
      session.set({ role: 'staff', staffId: q.sid, staffName: decodeURIComponent(q.sname || '') });
      currentRecordId = '';
      setRoute(q.from === 'qrcode' ? 'form' : 'staff', { from: 'qrcode' });
      return;
    }
    if (q.role === 'manager') {
      session.set({ role: 'manager', staffId: '', staffName: '管理员' });
      setRoute('manager');
      return;
    }
    renderRoute();
  });
})();
