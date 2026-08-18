// utils/csv.js  CSV工具
function escapeField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// records: array of plain objects with same key set
// columns: 可传 [{key,label}] 或 ['key1','key2'];不传则从第一条记录推断
function toCSV(records, columns) {
  if (!columns || !columns.length) {
    if (!records.length) return '';
    columns = Object.keys(records[0]);
  }
  // 关键: 统一成 {key,label} 形式——字符串列名直接取用会让表头和内容全空
  columns = columns.map((c) => (typeof c === 'string' ? { key: c, label: c } : c));
  const lines = [];
  lines.push(columns.map((c) => escapeField(c.label || c.key)).join(','));
  records.forEach((r) => {
    lines.push(columns.map((c) => escapeField(r[c.key])).join(','));
  });
  // BOM 让 Excel 正确识别 UTF-8
  return '\uFEFF' + lines.join('\n');
}

// 保存并打开 CSV。
// 小程序沙盒目录(wx.env.USER_DATA_PATH)对手机文件管理器不可见,
// 所以写入后必须用 wx.openDocument 打开,用户通过右上角「···」菜单:
//   · 发送给朋友 -> 文件传输助手(然后在电脑微信下载)
//   · 用其他应用打开(WPS / Excel)
//   · 收藏
// 若 openDocument 不支持(个别平台),降级为复制内容到剪贴板。
function saveCSV(filename, csvContent) {
  const filePath = `${wx.env.USER_DATA_PATH}/${filename}`;
  let fs;
  try {
    fs = wx.getFileSystemManager();
    fs.writeFileSync(filePath, csvContent, 'utf8');
  } catch (e) {
    console.error(e);
    wx.showToast({ title: '保存失败,请重试', icon: 'none' });
    return null;
  }

  wx.openDocument({
    filePath: filePath,
    fileType: 'csv',
    showMenu: true,           // 右上角「···」-> 可发送/用其他应用打开
    success() {
      wx.showToast({ title: '点右上角「···」可发送或保存', icon: 'none', duration: 2500 });
    },
    fail() {
      // 降级: 复制 CSV 内容到剪贴板
      wx.setClipboardData({
        data: csvContent,
        success() {
          wx.showModal({
            title: '已复制到剪贴板',
            content: '当前设备暂不支持直接打开 CSV。内容已复制,可粘贴到微信聊天、备忘录或 WPS 中保存。',
            showCancel: false,
            confirmText: '知道了'
          });
        }
      });
    }
  });
  return filePath;
}

module.exports = { toCSV, saveCSV, escapeField };
