// pages/index/index.js
const app = getApp();
const api = require('../../utils/api.js');
const storage = require('../../utils/storage.js');

Page({
  data: {
    staffName: '',
    staffPwd: '',
    adminPwd: '',
    showAdminPwd: false,
    loading: false,
    serverStatus: '检测中…'
  },

  onLoad(query) {
    // 小程序码/链接进入: scene=role=staff&sid=S001&sname=张丽
    // 也兼容普通参数: ?role=staff&sid=S001&sname=张丽
    var q = query || {};
    if (q.scene) {
      try {
        var decoded = decodeURIComponent(q.scene);
        decoded.split('&').forEach(function (kv) {
          var parts = kv.split('=');
          if (parts.length === 2) q[parts[0]] = decodeURIComponent(parts[1]);
        });
      } catch (e) {}
    }
    if (q.role === 'staff' && q.sid) {
      // 扫码免密进入(小程序码已是授权凭证)
      app.setSession('staff', q.sid, q.sname || '');
      wx.redirectTo({ url: '/pages/form/form?from=qrcode' });
      return;
    }
    if (q.role === 'manager') {
      this.setData({ showAdminPwd: true });
    }
    this.checkServer();
  },

  onShow() {
    // 已登录则直达对应页面
    var s = app.globalData;
    if (s.role === 'staff' && s.staffId) {
      wx.redirectTo({ url: '/pages/staff/staff' });
    } else if (s.role === 'manager') {
      wx.redirectTo({ url: '/pages/manager/manager' });
    }
  },

  onStaffName(e) { this.setData({ staffName: e.detail.value }); },
  onStaffPwd(e)  { this.setData({ staffPwd: e.detail.value }); },
  onAdminPwd(e)  { this.setData({ adminPwd: e.detail.value }); },

  checkServer() {
    var that = this;
    this.setData({ serverStatus: '检测中…' });
    api.get('/api/health')
      .then(function (res) {
        that.setData({ serverStatus: res && res.ok ? '✅ 云服务已连接' : '⚠️ 响应异常' });
      })
      .catch(function (err) {
        that.setData({ serverStatus: '❌ ' + err.message });
      });
  },

  enterStaff() {
    var name = (this.data.staffName || '').trim();
    var pwd = (this.data.staffPwd || '').trim();
    if (!name) { wx.showToast({ title: '请输入姓名', icon: 'none' }); return; }
    if (!pwd)  { wx.showToast({ title: '请输入密码', icon: 'none' }); return; }
    var that = this;
    this.setData({ loading: true });
    api.post('/api/login', { role: 'staff', name: name, password: pwd })
      .then(function (res) {
        that.setData({ loading: false });
        api.setToken(res.token);
        app.setSession('staff', res.staffId, res.staffName);
        wx.redirectTo({ url: '/pages/staff/staff' });
      })
      .catch(function (err) {
        that.setData({ loading: false });
        wx.showToast({ title: err.message, icon: 'none', duration: 2500 });
      });
  },

  enterManager() {
    if (!this.data.showAdminPwd) {
      this.setData({ showAdminPwd: true });
      return;
    }
    var pwd = (this.data.adminPwd || '').trim();
    if (!pwd) { wx.showToast({ title: '请输入管理密码', icon: 'none' }); return; }
    api.post('/api/login', { role: 'manager', password: pwd })
      .then(function (res) {
        api.setToken(res.token);
        app.setSession('manager', 'admin', '管理员');
        wx.redirectTo({ url: '/pages/manager/manager' });
      })
      .catch(function (err) {
        wx.showToast({ title: err.message, icon: 'none', duration: 2500 });
      });
  }
});
