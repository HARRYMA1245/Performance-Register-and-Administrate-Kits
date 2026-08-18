// pages/manager/manager.js
const app = getApp();
const storage = require('../../utils/storage.js');
const api = require('../../utils/api.js');
const todoLib = require('../../utils/todo.js');
const statsLib = require('../../utils/stats.js');
const { toCSV, saveCSV } = require('../../utils/csv.js');

function todayKey(d) {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
}
// 记录是否属于本月: 优先登记日期,没填则按创建时间
function inThisMonth(c) {
  const s = (c.timeNodes && c.timeNodes.registerDate)
    || (c.createTime ? String(c.createTime).slice(0, 10) : '');
  if (!s) return false;
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
  const now = new Date();
  return !isNaN(d) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}
// 业务进度: 全部完成(必须六项工序 6/6 点完) / 进行中 / 未开始
function progressOf(c) {
  const tn = c.timeNodes || {}, st = c.status || {};
  const done6 = storage.progressCount(c.progress);
  if (done6 >= 6) return 'done';
  const started = done6 > 0 || tn.cardDate || tn.depositDesc || !!st.currentStatus;
  return started ? 'doing' : 'notStarted';
}
function classify(status) {
  if (!status) return { tag: '未跟进', cls: 'amber' };
  // 留存类(绿): 新状态 + 兼容旧的已签约/高意向
  if (/已签约|留存财富客户|留存5-50万|高意向/.test(status)) return { tag: status, cls: 'green' };
  // 流程中(amber): 待办卡/待入金/待填客户号/待转介/跟进中
  if (/待办卡|待入金|待填客户号|待转介|跟进中/.test(status)) return { tag: status, cls: 'amber' };
  // 流失类(红)
  if (/已流失|已转出/.test(status)) return { tag: status, cls: 'red' };
  // 中性(灰): 观望中/已调整管户归属
  if (/观望中|已调整管户归属/.test(status)) return { tag: status, cls: '' };
  return { tag: status, cls: '' };
}

// 密码强度: 至少8位,含大写、小写、特殊字符
function isStrongPassword(p) {
  return typeof p === 'string' && p.length >= 8
    && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[^A-Za-z0-9]/.test(p);
}
const PWD_RULE_MSG = '密码需8位以上,含大小写字母和特殊字符';

Page({
  data: {
    kpi: { staffs: 0, clients: 0, today: 0, signed: 0, intent: 0, following: 0 },
    staffSummary: [],
    channelStats: [],
    allList: [],
    keyword: '',
    serverStatus: '加载中…',

    // 本月概览
    monthStats: { total: 0, retained: 0, todo: 0, done: 0, doing: 0, notStarted: 0 },

    // 工作台(按员工分类,全部之外每个员工一个 Tab,新员工自动出现)
    wbTabs: [{ key: 'all', label: '全部', count: 0 }],
    wbFilter: 'all',
    wbList: [],

    // 统计看板
    dash: null,
    topStatsText: { totalManaged: '0', retainedAum: '0' },

    // 待办
    todos: [], filteredTodos: [], todoTypes: todoLib.FILTERS, todoCounts: {}, todoFilter: 'all',

    // 员工账号管理
    staffAccounts: [],
    newStaffName: '',
    newStaffPwd: '',

    // 小程序码
    qrList: [],
    qrVisible: false,

    // 修改管理密码弹窗
    pwdVisible: false, pwdLoading: false,
    oldPwd: '', newPwd: '', newPwd2: ''
  },

  onShow() {
    if (!app.globalData.role || app.globalData.role !== 'manager') {
      wx.redirectTo({ url: '/pages/index/index' });
      return;
    }
    this.loadAll();
  },

  // 从服务器拉全量数据 + 员工花名册
  loadAll() {
    var that = this;
    this.setData({ serverStatus: '加载中…' });
    Promise.all([
      api.get('/api/clients/all'),
      api.get('/api/staffs')
    ]).then(function (rs) {
      var clients = rs[0], staffs = rs[1];
      storage.setClients(clients);
      storage.setStaffs(staffs);
      that.setData({ serverStatus: '✅ 服务器数据已更新', staffAccounts: staffs });
      that.refresh();
    }).catch(function (err) {
      that.setData({ serverStatus: '⚠️ ' + err.message + '(显示本机缓存)' });
      that.refresh();
    });
  },

  refresh() {
    const all = storage.getClients();
    const staffs = storage.getStaffs();
    const today = todayKey();
    let signed = 0, intent = 0, following = 0, todayCount = 0;

    const decorated = all.map((c) => {
      const st = c.status || {};
      const tag = classify(st.currentStatus);
      const ctime = storage.formatDateTime(c.createTime);
      if (ctime.indexOf(today) === 0) todayCount++;
      if (tag.cls === 'green') signed++;
      if (tag.tag === '高意向') intent++;
      if (tag.cls === 'amber' && tag.tag !== '未跟进') following++;
      const b = c.basic || {};
      const acq = c.acquisition || {};
      return {
        id: c.id,
        staffId: c.staffId,
        staffName: c.staffName,
        basic: b,
        acquisition: acq,
        conditionTag: tag.tag,
        tagClass: tag.cls,
        acqText: acq.channel || '—',
        managedText: statsLib.fmtMoney(statsLib.num(b.managedAmount)),
        progressDone: storage.progressCount(c.progress),
        progress: progressOf(c),
        updateTimeText: storage.formatDateTime(c.updateTime)
      };
    });
    decorated.sort((a, b) => b.updateTimeText.localeCompare(a.updateTimeText));

    // ---------- 本月概览 ----------
    const monthRecords = all.filter(inThisMonth);
    let mRetained = 0, mDone = 0, mDoing = 0, mNotStarted = 0;
    monthRecords.forEach((c) => {
      if (statsLib.isRetained(c)) mRetained++;
      const p = progressOf(c);
      if (p === 'done') mDone++;
      else if (p === 'doing') mDoing++;
      else mNotStarted++;
    });
    const monthStats = {
      total: monthRecords.length,
      retained: mRetained,
      todo: todoLib.deriveTodos(monthRecords).length,
      done: mDone,
      doing: mDoing,
      notStarted: mNotStarted
    };

    // ---------- 工作台员工分类(动态: 花名册 + 数据里出现过的员工) ----------
    const tabMap = {};
    staffs.forEach((s) => { tabMap[s.id] = { key: s.id, label: s.name, count: 0 }; });
    decorated.forEach((c) => {
      if (!tabMap[c.staffId]) {
        tabMap[c.staffId] = { key: c.staffId, label: (c.staffName || '未知') + '(已删)', count: 0 };
      }
      tabMap[c.staffId].count++;
    });
    const wbTabs = [{ key: 'all', label: '全部', count: decorated.length }]
      .concat(staffs.map((s) => tabMap[s.id]))
      .concat(Object.keys(tabMap)
        .filter((k) => !staffs.some((s) => s.id === k))
        .map((k) => tabMap[k]));

    const summary = staffs.map((s) => {
      const list = decorated.filter((c) => c.staffId === s.id);
      return {
        id: s.id,
        name: s.name,
        count: list.length,
        recentText: list.length
          ? `最近: ${list[0].basic.name || ''} · ${list[0].updateTimeText.slice(5, 10)}`
          : '尚未提交客户'
      };
    }).sort((a, b) => b.count - a.count);

    const chMap = {};
    decorated.forEach((c) => {
      const ch = c.acquisition.channel || '未填写';
      chMap[ch] = (chMap[ch] || 0) + 1;
    });
    const total = decorated.length || 1;
    const channelStats = Object.keys(chMap)
      .map((k) => ({ channel: k, count: chMap[k], percent: Math.round(chMap[k] / total * 100) }))
      .sort((a, b) => b.count - a.count);

    // 统计看板(图表宽度按屏幕算)
    var winW = 375;
    try {
      var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      winW = info.windowWidth || 375;
    } catch (e) {}
    var dash = statsLib.buildDashboard(all, winW - 64);

    // 待办(全团队)
    var todos = todoLib.deriveTodos(all);

    this.setData({
      kpi: { staffs: staffs.length, clients: all.length, today: todayCount, signed, intent, following },
      staffSummary: summary,
      channelStats,
      allList: decorated,
      monthStats: monthStats,
      wbTabs: wbTabs,
      dash: dash,
      topStatsText: {
        totalManaged: statsLib.fmtMoney(dash.top.totalManaged),
        retainedAum: statsLib.fmtMoney(dash.top.retainedAum)
      },
      todos: todos,
      todoCounts: todoLib.countByType(todos)
    });
    this.applyFilter();
    this.applyTodoFilter();
  },

  // ---------- 工作台(员工分类 + 搜索) ----------
  onWbFilter(e) {
    this.setData({ wbFilter: e.currentTarget.dataset.key });
    this.applyFilter();
  },
  applyFilter() {
    const w = (this.data.keyword || '').trim();
    const f = this.data.wbFilter;
    const list = this.data.allList.filter((c) => {
      if (f !== 'all' && c.staffId !== f) return false;
      if (!w) return true;
      return (c.basic.name || '').includes(w)
        || (c.basic.clientNo || '').includes(w)
        || (c.basic.handler || '').includes(w)
        || (c.staffName || '').includes(w);
    });
    this.setData({ wbList: list });
  },

  // ---------- 待办 ----------
  onTodoFilter(e) {
    this.setData({ todoFilter: e.currentTarget.dataset.key });
    this.applyTodoFilter();
  },
  applyTodoFilter() {
    var f = this.data.todoFilter;
    var list = f === 'all' ? this.data.todos : this.data.todos.filter(function (t) { return t.type === f; });
    this.setData({ filteredTodos: list });
  },
  openTodo(e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/form/form?mode=edit&id=' + id });
  },

  // ---------- 搜索 ----------
  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },
  clearKeyword() { this.setData({ keyword: '' }); this.applyFilter(); },

  drillStaff(e) {
    const sid = e.currentTarget.dataset.sid;
    const list = this.data.allList.filter((c) => c.staffId === sid);
    const summary = this.data.staffSummary.find((s) => s.id === sid);
    let msg = `员工 ${summary ? summary.name : sid} 共 ${list.length} 位客户:\n`;
    list.slice(0, 30).forEach((c, i) => {
      msg += `${i + 1}. ${c.basic.name}  ${c.basic.clientNo || ''}  [${c.conditionTag}]\n`;
    });
    wx.showModal({ title: '员工详情', content: msg, showCancel: false, confirmText: '好的' });
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/form/form?mode=edit&id=' + id });
  },

  // ---------- 员工账号管理 ----------
  onNewStaffName(e) { this.setData({ newStaffName: e.detail.value }); },
  onNewStaffPwd(e)  { this.setData({ newStaffPwd: e.detail.value }); },

  createStaff() {
    var that = this;
    var name = (this.data.newStaffName || '').trim();
    var pwd = (this.data.newStaffPwd || '').trim();
    if (!name || !pwd) { wx.showToast({ title: '姓名和密码必填', icon: 'none' }); return; }
    if (!isStrongPassword(pwd)) { wx.showToast({ title: PWD_RULE_MSG, icon: 'none', duration: 2500 }); return; }
    api.post('/api/staffs', { name: name, password: pwd })
      .then(function (res) {
        wx.showToast({ title: res.updated ? '密码已重置' : '已创建 ' + name });
        that.setData({ newStaffName: '', newStaffPwd: '' });
        that.loadAll();
      })
      .catch(function (err) {
        wx.showModal({ title: '操作失败', content: err.message, showCancel: false });
      });
  },

  deleteStaff(e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    var name = e.currentTarget.dataset.name;
    wx.showModal({
      title: '删除员工账号',
      content: '确认删除「' + name + '」的登录账号?该员工已上传的客户数据会保留。',
      success: function (res) {
        if (!res.confirm) return;
        api.del('/api/staffs?id=' + encodeURIComponent(id))
          .then(function () {
            wx.showToast({ title: '已删除' });
            that.loadAll();
          })
          .catch(function (err) {
            wx.showModal({ title: '删除失败', content: err.message, showCancel: false });
          });
      }
    });
  },

  // ---------- 数据管理 ----------
  clearDemo() {
    var that = this;
    wx.showModal({
      title: '清空演示数据',
      content: '将删除所有演示客户记录(id 以 demo_ 开头),员工真实数据不受影响。',
      success: function (res) {
        if (!res.confirm) return;
        api.post('/api/admin/clear-demo')
          .then(function (r) {
            wx.showToast({ title: '已清除 ' + r.removed + ' 条' });
            that.loadAll();
          })
          .catch(function (err) {
            wx.showModal({ title: '操作失败', content: err.message, showCancel: false });
          });
      }
    });
  },

  resetAll() {
    var that = this;
    wx.showModal({
      title: '⚠️ 危险操作',
      content: '将删除服务器上全部客户数据,且不可恢复!确认继续?',
      confirmColor: '#e54848',
      success: function (res) {
        if (!res.confirm) return;
        api.post('/api/admin/reset-all')
          .then(function () {
            wx.showToast({ title: '已全部清空' });
            that.loadAll();
          })
          .catch(function (err) {
            wx.showModal({ title: '操作失败', content: err.message, showCancel: false });
          });
      }
    });
  },

  // ---------- 小程序码(云函数生成,返回 base64) ----------
  generateQRCode() {
    var that = this;
    var staffs = this.data.staffAccounts;
    if (!staffs.length) {
      wx.showToast({ title: '请先创建员工账号', icon: 'none' }); return;
    }
    var qrList = staffs.map(function (s) {
      return { staffId: s.id, staffName: s.name, url: '', loading: true, error: '' };
    });
    this.setData({ qrVisible: true, qrList: qrList });

    staffs.forEach(function (s, i) {
      api.get('/api/qrcode?staffId=' + encodeURIComponent(s.id) + '&staffName=' + encodeURIComponent(s.name))
        .then(function (res) {
          var upd = {};
          if (!res.imageBase64) {
            upd['qrList[' + i + '].loading'] = false;
            upd['qrList[' + i + '].error'] = '生成失败';
            that.setData(upd);
            return;
          }
          // base64 写入本地临时文件再展示
          var fsm = wx.getFileSystemManager();
          var filePath = wx.env.USER_DATA_PATH + '/qr_' + s.id + '.png';
          fsm.writeFile({
            filePath: filePath,
            data: res.imageBase64,
            encoding: 'base64',
            success() {
              var u2 = {};
              u2['qrList[' + i + '].url'] = filePath;
              u2['qrList[' + i + '].loading'] = false;
              that.setData(u2);
            },
            fail() {
              var u3 = {};
              u3['qrList[' + i + '].loading'] = false;
              u3['qrList[' + i + '].error'] = '保存图片失败';
              that.setData(u3);
            }
          });
        })
        .catch(function (e) {
          var upd = {};
          upd['qrList[' + i + '].loading'] = false;
          upd['qrList[' + i + '].error'] = e.message || '无法连接云服务';
          that.setData(upd);
        });
    });
  },

  closeQr() { this.setData({ qrVisible: false }); },

  saveQrImage(e) {
    var filePath = e.currentTarget.dataset.path;
    if (!filePath) return;
    wx.saveImageToPhotosAlbum({
      filePath: filePath,
      success() { wx.showToast({ title: '已存到相册' }); },
      fail() { wx.showToast({ title: '保存失败,请授权相册权限', icon: 'none' }); }
    });
  },

  // ---------- 导出 ----------
  exportAllCSV() {
    const all = storage.getClients();
    if (!all.length) { wx.showToast({ title: '暂无数据', icon: 'none' }); return; }
    const csv = toCSV(
      all.map((c) => ({
        '姓名': c.basic && c.basic.name,
        '客户号': c.basic && c.basic.clientNo,
        '托管金额': c.basic && c.basic.managedAmount,
        '经办人': c.basic && c.basic.handler,
        '客户类型': c.basic && c.basic.clientType,
        '登记日期': c.timeNodes && c.timeNodes.registerDate,
        '开卡日期': c.timeNodes && c.timeNodes.cardDate,
        '预计入账日期': c.timeNodes && c.timeNodes.expectedDepositDate,
        '限额失效日期': c.timeNodes && c.timeNodes.limitExpiryDate,
        '入账时间描述': c.timeNodes && c.timeNodes.depositDesc,
        '获客方式': c.acquisition && c.acquisition.channel,
        '链家签约经理': c.acquisition && c.acquisition.acquirer,
        '转介理财经理': c.acquisition && c.acquisition.referralManager,
        '认领状态': c.acquisition && c.acquisition.claimStatus,
        '认领日期': c.acquisition && c.acquisition.claimDate,
        '当前状态': c.status && c.status.currentStatus,
        '留存产品类型': c.status && c.status.retentionProductType,
        'AUM': c.status && c.status.aum,
        '留存填报日期': c.status && c.status.retentionReportDate,
        '留存量': c.status && c.status.retentionAmount,
        '他行VIP潜力': c.status && c.status.vipPotential,
        '风险偏好': c.status && c.status.riskPreference,
        '备注': c.status && c.status.remark,
        '工作进度': storage.progressCount(c.progress) + '/6',
        '所属员工': c.staffName,
        '创建时间': storage.formatDateTime(c.createTime),
        '更新时间': storage.formatDateTime(c.updateTime)
      }))
    );
    saveCSV(`全量数据-${todayKey()}.csv`, csv);
  },

  exportStaffSummary() {
    const staffs = storage.getStaffs();
    const all = storage.getClients();
    const csv = toCSV(
      staffs.map((s) => {
        const list = all.filter((c) => c.staffId === s.id);
        const today = todayKey();
        const todayAdd = list.filter((c) => storage.formatDateTime(c.createTime).indexOf(today) === 0).length;
        const signed = list.filter((c) => c.status && /已签约/.test(c.status.currentStatus || '')).length;
        const totalAUM = list.reduce((sum, c) => sum + (parseFloat(c.status && c.status.aum) || 0), 0);
        const totalManaged = list.reduce((sum, c) => sum + (parseFloat(c.basic && c.basic.managedAmount) || 0), 0);
        return { '员工ID': s.id, '姓名': s.name, '客户总数': list.length, '今日新增': todayAdd, '已签约': signed, 'AUM合计': totalAUM, '托管金额合计': totalManaged };
      })
    );
    saveCSV(`员工业绩-${todayKey()}.csv`, csv);
  },

  // ---------- 修改管理密码 ----------
  openPwd() {
    this.setData({ pwdVisible: true, oldPwd: '', newPwd: '', newPwd2: '', pwdLoading: false });
  },
  closePwd() { this.setData({ pwdVisible: false }); },
  onOldPwd(e)  { this.setData({ oldPwd: e.detail.value }); },
  onNewPwd(e)  { this.setData({ newPwd: e.detail.value }); },
  onNewPwd2(e) { this.setData({ newPwd2: e.detail.value }); },

  submitPwd() {
    var that = this;
    var oldPwd = this.data.oldPwd, newPwd = (this.data.newPwd || '').trim(), newPwd2 = (this.data.newPwd2 || '').trim();
    if (!oldPwd) { wx.showToast({ title: '请输入原密码', icon: 'none' }); return; }
    if (!isStrongPassword(newPwd)) { wx.showToast({ title: PWD_RULE_MSG, icon: 'none', duration: 2500 }); return; }
    if (newPwd !== newPwd2) { wx.showToast({ title: '两次输入的新密码不一致', icon: 'none' }); return; }
    this.setData({ pwdLoading: true });
    api.post('/api/admin/change-password', { oldPassword: oldPwd, newPassword: newPwd })
      .then(function () {
        that.setData({ pwdVisible: false, pwdLoading: false });
        wx.showModal({
          title: '密码已修改',
          content: '下次登录请使用新密码。建议同步修改 server/config.json 里的记录。',
          showCancel: false
        });
      })
      .catch(function (err) {
        that.setData({ pwdLoading: false });
        wx.showModal({ title: '修改失败', content: err.message, showCancel: false });
      });
  },

  logout() {
    wx.showModal({
      title: '退出管理员?',
      success: (res) => {
        if (res.confirm) {
          app.clearSession();
          wx.redirectTo({ url: '/pages/index/index' });
        }
      }
    });
  }
});
