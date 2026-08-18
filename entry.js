// pages/entry/entry.js
const app = getApp();
Page({
  data: {
    roleText: '', sid: '', sname: ''
  },
  onLoad(query) {
    const role = (query && query.role) || app.globalData.role;
    const sid  = (query && query.sid)  || app.globalData.staffId;
    const sname = (query && query.sname) || app.globalData.staffName;
    app.setSession(role, sid, decodeURIComponent(sname || ''));
    this.setData({
      roleText: role === 'staff' ? '员工' : (role === 'manager' ? '管理员' : ''),
      sid, sname
    });
  },
  goForm() { wx.navigateTo({ url: '/pages/form/form?from=qrcode' }); },
  goMyList() {
    wx.switchTab && wx.switchTab({ url: '/pages/staff/staff' });
    wx.navigateTo({ url: '/pages/staff/staff' });
  }
});
