// pages/form/form.js
const app = getApp();
const storage = require('../../utils/storage.js');
const api = require('../../utils/api.js');

const FORM = storage.FORM_FIELDS;

function emptyBasic() {
  var obj = {};
  FORM.basic.forEach(function (f) { obj[f.key] = ''; });
  return obj;
}
function emptyTimeNodes() {
  var obj = {};
  FORM.timeNodes.forEach(function (f) { obj[f.key] = ''; });
  return obj;
}

Page({
  data: {
    editing: false, recordId: '',
    fromQrcode: false,
    staffName: '', staffId: '',
    readOnly: false,   // 管理员查看模式: 只读

    basic: emptyBasic(),
    timeNodes: emptyTimeNodes(),
    acquisition: { channel: '', acquirer: '', referralManager: '', claimStatus: '', claimDate: '' },
    status: { currentStatus: '', retentionProductType: '', aum: '', retentionReportDate: '', retentionAmount: '', vipPotential: '', riskPreference: '', remark: '' },

    // 工作进度(六项工序,0/6 起步)
    progress: storage.emptyProgress(),
    progressList: [],
    progressDone: 0,

    // Picker indices
    acqOptions: FORM.acquisition[0].options,
    acqIndex: -1,
    claimStatusOptions: FORM.acquisition[3].options,
    claimStatusIndex: -1,
    statusOptions: FORM.status[0].options,
    currentStatusIndex: -1,
    vipOptions: FORM.status[5].options,
    vipPotentialIndex: -1,
    riskOptions: FORM.status[6].options,
    riskPreferenceIndex: -1,
    // 客户类型: picker 展示"短名 - 描述",入库只存短名
    clientTypeOptions: storage.CLIENT_TYPES.map(function (t) { return t.value + ' - ' + t.desc; }),
    clientTypeIndex: -1,
    // 留存产品类型(下拉)
    retentionProductOptions: FORM.status[1].options,
    retentionProductIndex: -1
  },

  onLoad(options) {
    if (!app.globalData.role) {
      wx.redirectTo({ url: '/pages/index/index' });
      return;
    }
    var isManager = app.globalData.role === 'manager';
    // 管理员只能查看/跟单,不能新建
    if (isManager && !(options && options.mode === 'edit')) {
      wx.showToast({ title: '管理员仅可查看已有档案', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 800);
      return;
    }

    this.setData({
      staffName: app.globalData.staffName,
      staffId:   app.globalData.staffId,
      readOnly:  isManager,
      fromQrcode: options && options.from === 'qrcode'
    });

    if (options && options.mode === 'edit' && options.id) {
      var records = storage.getClients();
      var r = records.find(function (c) { return c.id === options.id; });
      if (r) {
        var b = Object.assign(emptyBasic(), r.basic || {});
        var tn = Object.assign(emptyTimeNodes(), r.timeNodes || {});
        var acq = r.acquisition || { channel: '', acquirer: '', referralManager: '', claimStatus: '', claimDate: '' };
        var st = r.status || { currentStatus: '', retentionProductType: '', aum: '', retentionReportDate: '', retentionAmount: '', vipPotential: '', riskPreference: '', remark: '' };
        this.setData({
          editing: true, recordId: r.id,
          // 管理员查看时,顶部显示该单的归属员工
          staffName: r.staffName || this.data.staffName,
          staffId: r.staffId || this.data.staffId,
          basic: b, timeNodes: tn, acquisition: acq, status: st,
          acqIndex: acq.channel ? FORM.acquisition[0].options.indexOf(acq.channel) : -1,
          claimStatusIndex: acq.claimStatus ? FORM.acquisition[3].options.indexOf(acq.claimStatus) : -1,
          currentStatusIndex: st.currentStatus ? FORM.status[0].options.indexOf(st.currentStatus) : -1,
          vipPotentialIndex: st.vipPotential ? FORM.status[5].options.indexOf(st.vipPotential) : -1,
          riskPreferenceIndex: st.riskPreference ? FORM.status[6].options.indexOf(st.riskPreference) : -1,
          clientTypeIndex: b.clientType ? FORM.basic[4].options.indexOf(b.clientType) : -1,
          retentionProductIndex: st.retentionProductType ? FORM.status[1].options.indexOf(st.retentionProductType) : -1
        });
        this.initProgress(r.progress);
      }
    } else {
      // 新建: 认领状态默认「未认领」,工作进度 0/6
      this.setData({
        'acquisition.claimStatus': '未认领',
        claimStatusIndex: FORM.acquisition[3].options.indexOf('未认领')
      });
      this.initProgress(null);
    }
  },

  // 初始化/刷新进度清单展示
  initProgress(progress) {
    var p = Object.assign(storage.emptyProgress(), progress || {});
    var list = storage.PROGRESS_ITEMS.map(function (it) {
      return { key: it.key, label: it.label, done: !!p[it.key] };
    });
    this.setData({
      progress: p,
      progressList: list,
      progressDone: storage.progressCount(p)
    });
  },

  // 员工点击完成/取消某一项工序(立即保存+同步)
  onToggleProgress(e) {
    if (this.data.readOnly) return;   // 管理员只读
    var key = e.currentTarget.dataset.key;
    var p = Object.assign({}, this.data.progress);
    p[key] = !p[key];
    this.initProgress(p);
    // 已有档案: 点了就存,不用返回再按保存
    if (this.data.editing && this.data.recordId) {
      var r = this.buildRecord();
      storage.upsertClient(r);
      this.pushToServer(r);
    }
  },

  onBasicInput(e) {
    var key = e.currentTarget.dataset.key;
    var d = {}; d['basic.' + key] = e.detail.value;
    this.setData(d);
  },
  // 客户类型: range 是"短名 - 描述",只把短名入库
  onClientTypeChange(e) {
    var idx = parseInt(e.detail.value);
    this.setData({
      'basic.clientType': storage.CLIENT_TYPES[idx].value,
      clientTypeIndex: idx
    });
  },
  onRetentionProductChange(e) {
    var idx = parseInt(e.detail.value);
    this.setData({
      'status.retentionProductType': FORM.status[1].options[idx],
      retentionProductIndex: idx
    });
  },

  onTimeInput(e) {
    var key = e.currentTarget.dataset.key;
    var d = {}; d['timeNodes.' + key] = e.detail.value;
    this.setData(d);
  },
  onDateChange(e) {
    var key = e.currentTarget.dataset.key;
    var d = {}; d['timeNodes.' + key] = e.detail.value;
    this.setData(d);
  },

  onAcqChange(e) {
    var idx = parseInt(e.detail.value);
    this.setData({ 'acquisition.channel': FORM.acquisition[0].options[idx], acqIndex: idx });
  },
  onAcqInputText(e) {
    var d = {}; d['acquisition.' + e.currentTarget.dataset.key] = e.detail.value;
    this.setData(d);
  },
  onAcqDateChange(e) {
    var d = {}; d['acquisition.' + e.currentTarget.dataset.key] = e.detail.value;
    this.setData(d);
  },
  onClaimStatusChange(e) {
    var idx = parseInt(e.detail.value);
    this.setData({ 'acquisition.claimStatus': FORM.acquisition[3].options[idx], claimStatusIndex: idx });
  },

  onCurrentStatusChange(e) {
    var idx = parseInt(e.detail.value);
    this.setData({ 'status.currentStatus': FORM.status[0].options[idx], currentStatusIndex: idx });
  },
  onVipPotentialChange(e) {
    var idx = parseInt(e.detail.value);
    this.setData({ 'status.vipPotential': FORM.status[5].options[idx], vipPotentialIndex: idx });
  },
  onRiskPreferenceChange(e) {
    var idx = parseInt(e.detail.value);
    this.setData({ 'status.riskPreference': FORM.status[6].options[idx], riskPreferenceIndex: idx });
  },
  onStatusInput(e) {
    var d = {}; d['status.' + e.currentTarget.dataset.key] = e.detail.value;
    this.setData(d);
  },
  onStatusDateChange(e) {
    var d = {}; d['status.' + e.currentTarget.dataset.key] = e.detail.value;
    this.setData(d);
  },

  validate() {
    if (!this.data.basic.name || !this.data.basic.clientNo || !this.data.basic.handler) {
      wx.showToast({ title: '姓名/客户号/经办人必填', icon: 'none' });
      return false;
    }
    return true;
  },

  buildRecord() {
    // 金额字段统一转数字(input 的值是字符串,直接存会导致统计时字符串拼接)
    function toNum(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
    var basic = Object.assign({}, this.data.basic);
    var status = Object.assign({}, this.data.status);
    basic.managedAmount = toNum(basic.managedAmount);
    status.aum = toNum(status.aum);
    status.retentionAmount = toNum(status.retentionAmount);
    return {
      id: this.data.recordId || storage.newClientId(),
      staffId: this.data.staffId,
      staffName: this.data.staffName,
      basic: basic,
      timeNodes: this.data.timeNodes,
      acquisition: this.data.acquisition,
      status: status,
      progress: this.data.progress
    };
  },

  saveDraft() {
    if (this.data.readOnly) return;
    if (!this.validate()) return;
    var r = this.buildRecord();
    storage.upsertClient(r);
    this.pushToServer(r);
    wx.showToast({ title: '草稿已存' });
  },

  // 保存后静默同步到服务器(失败不影响本地保存)
  pushToServer(rec) {
    if (!api.getToken()) return;  // 扫码免密模式: 仅本地,回工作台登录后再同步
    api.post('/api/clients/sync', { records: [rec] }).catch(function () {});
  },

  submit() {
    if (this.data.readOnly) return;
    if (!this.validate()) return;
    var r = this.buildRecord();
    storage.upsertClient(r);
    this.pushToServer(r);
    var staffs = storage.getStaffs();
    var me = staffs.find(function (s) { return s.id === this.data.staffId; }.bind(this));
    if (me) {
      me.total = (me.total || 0) + (this.data.editing ? 0 : 1);
      storage.setStaffs(staffs);
    }
    wx.showToast({ title: '已保存' });
    setTimeout(function () { wx.navigateBack(); }, 600);
  },

  del() {
    if (this.data.readOnly) return;
    if (!this.data.recordId) return;
    var recordId = this.data.recordId;
    wx.showModal({
      title: '确认删除此客户档案?',
      success: function (res) {
        if (res.confirm) {
          storage.deleteClient(recordId);
          if (api.getToken()) {
            api.del('/api/clients?id=' + encodeURIComponent(recordId)).catch(function () {});
          }
          wx.showToast({ title: '已删除' });
          setTimeout(function () { wx.navigateBack(); }, 500);
        }
      }
    });
  }
});
