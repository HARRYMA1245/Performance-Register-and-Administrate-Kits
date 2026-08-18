// pages/staff/staff.js
const app = getApp();
const storage = require('../../utils/storage.js');
const api = require('../../utils/api.js');
const todoLib = require('../../utils/todo.js');
const { toCSV, saveCSV } = require('../../utils/csv.js');

function todayKey(d) {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
}

function classifyStatus(status) {
  if (!status) return { tag: '未跟进', cls: 'amber' };
  // 留存类(绿): 新状态 + 兼容旧的已签约/高意向
  if (/已签约|留存财富客户|留存5-50万|高意向/.test(status)) return { tag: status, cls: 'green' };
  // 流程中(amber)
  if (/待办卡|待入金|待填客户号|待转介|跟进中/.test(status)) return { tag: status, cls: 'amber' };
  // 流失类(红)
  if (/已流失|已转出/.test(status)) return { tag: status, cls: 'red' };
  // 中性(灰)
  if (/观望中|已调整管户归属/.test(status)) return { tag: status, cls: '' };
  return { tag: status, cls: '' };
}

// 密码强度: 至少8位,含大写、小写、特殊字符
function isStrongPassword(p) {
  return typeof p === 'string' && p.length >= 8
    && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[^A-Za-z0-9]/.test(p);
}

Page({
  data: {
    staffId: '', staffName: '',
    mineList: [], mineCount: 0, todayCount: 0, signedCount: 0,
    initial: '',
    syncStatus: '',
    // 待办
    todos: [], filteredTodos: [], todoTypes: todoLib.FILTERS, todoCounts: {}, todoFilter: 'all',
    // 修改密码弹窗
    pwdVisible: false, pwdLoading: false,
    oldPwd: '', newPwd: '', newPwd2: ''
  },

  onShow() {
    if (!app.globalData.role || app.globalData.role !== 'staff') {
      wx.redirectTo({ url: '/pages/index/index' });
      return;
    }
    this.syncWithServer();
  },

  // 与服务器双向同步: 拉取服务器数据覆盖本地; 本地多出来的记录推上去
  syncWithServer() {
    var that = this;
    var myId = app.globalData.staffId;
    if (!api.getToken()) {
      // 扫码免密进入,没有 token: 只看本地,提示登录后可同步
      that.setData({ syncStatus: '未登录,数据仅存本机' });
      that.refresh();
      return;
    }
    this.setData({ syncStatus: '同步中…' });
    api.get('/api/clients')
      .then(function (serverList) {
        // 本地我的记录
        var localAll = storage.getClients();
        var mineLocal = localAll.filter(function (c) { return c.staffId === myId; });
        var serverIds = {};
        serverList.forEach(function (c) { serverIds[c.id] = true; });
        // 本地有而服务器没有 → 推上去
        var toPush = mineLocal.filter(function (c) { return !serverIds[c.id]; });
        // 合并: 服务器数据为权威 + 本地独有的稍后推送
        var othersLocal = localAll.filter(function (c) { return c.staffId !== myId; });
        storage.setClients(othersLocal.concat(serverList).concat(toPush));
        if (toPush.length) {
          api.post('/api/clients/sync', { records: toPush }).then(function () {
            that.setData({ syncStatus: '✅ 已同步(补传 ' + toPush.length + ' 条)' });
            that.refresh();
          }).catch(function () { that.refresh(); });
          return;
        }
        that.setData({ syncStatus: '✅ 已与服务器同步' });
        that.refresh();
      })
      .catch(function (err) {
        that.setData({ syncStatus: '⚠️ ' + err.message + '(显示本机数据)' });
        that.refresh();
      });
  },

  refresh() {
    const { staffId, staffName } = app.globalData;
    const all = storage.getClients();
    const mine = all.filter((c) => c.staffId === staffId);
    mine.sort((a, b) => (b.updateTime || '').localeCompare(a.updateTime || ''));
    const today = todayKey();
    let todayCount = 0, signedCount = 0;
    const decorated = mine.map((c) => {
      const st = c.status || {};
      const tag = classifyStatus(st.currentStatus);
      const upd = storage.formatDateTime(c.updateTime);
      const ctime = storage.formatDateTime(c.createTime);
      if (ctime.indexOf(today) === 0) todayCount++;
      if (tag.cls === 'green') signedCount++;
      const amounts = [];
      if (c.basic && c.basic.managedAmount) amounts.push('托管¥' + (c.basic.managedAmount / 10000).toFixed(0) + '万');
      if (st.aum) amounts.push('AUM¥' + (st.aum / 10000).toFixed(0) + '万');
      return {
        id: c.id,
        basic: c.basic || {},
        conditionTag: tag.tag,
        tagClass: tag.cls,
        amountText: amounts.join(' · '),
        progressDone: storage.progressCount(c.progress),
        updateTimeText: upd
      };
    });
    // 待办: 只看我名下的客单
    const todos = todoLib.deriveTodos(mine);
    this.setData({
      staffId, staffName,
      initial: staffName ? staffName[0] : '员',
      mineList: decorated,
      mineCount: mine.length,
      todayCount, signedCount,
      todos: todos,
      todoCounts: todoLib.countByType(todos)
    });
    this.applyTodoFilter();
  },

  // 待办筛选
  onTodoFilter(e) {
    this.setData({ todoFilter: e.currentTarget.dataset.key });
    this.applyTodoFilter();
  },
  applyTodoFilter() {
    const f = this.data.todoFilter;
    const list = f === 'all' ? this.data.todos : this.data.todos.filter((t) => t.type === f);
    this.setData({ filteredTodos: list });
  },
  // 点击待办 → 直接打开该客户编辑页
  openTodo(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/form/form?mode=edit&id=' + id });
  },

  addOne() {
    wx.navigateTo({ url: '/pages/form/form' });
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/form/form?mode=edit&id=' + id });
  },

  logout() {
    wx.showModal({
      title: '确认退出当前账号?',
      success: (res) => {
        if (!res.confirm) return;
        app.clearSession();
        wx.redirectTo({ url: '/pages/index/index' });
      }
    });
  },

  exportMyCSV() {
    if (!this.data.mineList.length) {
      wx.showToast({ title: '暂无可导出数据', icon: 'none' }); return;
    }
    const all = storage.getClients();
    const mine = all.filter((c) => c.staffId === app.globalData.staffId);
    const csv = toCSV(
      mine.map((c) => ({
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
        '创建时间': storage.formatDateTime(c.createTime),
        '更新时间': storage.formatDateTime(c.updateTime)
      }))
    );
    saveCSV(`员工-${app.globalData.staffName}-${todayKey()}.csv`, csv);
  },

  uploadMine() {
    var that = this;
    if (!api.getToken()) {
      wx.showToast({ title: '请先登录再同步', icon: 'none' }); return;
    }
    wx.showLoading({ title: '同步中…' });
    const mine = storage.getClients().filter((c) => c.staffId === app.globalData.staffId);
    api.post('/api/clients/sync', { records: mine })
      .then(function (res) {
        wx.hideLoading();
        wx.showToast({ title: '已同步 ' + res.merged + ' 条' });
        that.setData({ syncStatus: '✅ 已与服务器同步' });
      })
      .catch(function (err) {
        wx.hideLoading();
        wx.showModal({ title: '同步失败', content: err.message, showCancel: false });
      });
  },

  // ---------- 修改密码 ----------
  openPwd() {
    if (!api.getToken()) {
      wx.showToast({ title: '扫码进入的临时身份不支持改密,请用账号密码登录', icon: 'none', duration: 2500 });
      return;
    }
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
    if (!isStrongPassword(newPwd)) {
      wx.showToast({ title: '新密码需8位以上,含大小写字母和特殊字符', icon: 'none', duration: 2500 }); return;
    }
    if (newPwd !== newPwd2) { wx.showToast({ title: '两次输入的新密码不一致', icon: 'none' }); return; }
    this.setData({ pwdLoading: true });
    api.post('/api/change-password', { oldPassword: oldPwd, newPassword: newPwd })
      .then(function () {
        that.setData({ pwdVisible: false, pwdLoading: false });
        wx.showToast({ title: '密码已修改' });
      })
      .catch(function (err) {
        that.setData({ pwdLoading: false });
        wx.showModal({ title: '修改失败', content: err.message, showCancel: false });
      });
  }
});
