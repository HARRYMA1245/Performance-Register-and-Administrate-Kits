// utils/storage.js  本地存储封装
//  - 所有客户档案
//  - 员工花名册
//  - 当前会话
//  - 模板字段定义

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  const pad = (n) => (n < 10 ? '0' + n : n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function get(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function set(key, value) {
  try { wx.setStorageSync(key, value); } catch (e) {}
}

function remove(key) {
  try { wx.removeStorageSync(key); } catch (e) {}
}

const KEYS = {
  CLIENTS:  'cm_clients',
  STAFFS:   'cm_staffs',
  SESSION:  'cm_session',
  SEED:     'cm_seed_initialized'
};

// 员工花名册
function getStaffs() {
  return get(KEYS.STAFFS, []);
}
function setStaffs(list) { set(KEYS.STAFFS, list); }

function getClients() {
  return get(KEYS.CLIENTS, []);
}
function setClients(list) { set(KEYS.CLIENTS, list); }

function upsertClient(record) {
  const list = getClients();
  const idx = list.findIndex((c) => c.id === record.id);
  const now = nowIso();
  if (idx >= 0) {
    record.updateTime = now;
    list[idx] = Object.assign({}, list[idx], record);
  } else {
    record.createTime = now;
    record.updateTime = now;
    list.unshift(record);
  }
  setClients(list);
  return list;
}

function deleteClient(id) {
  const list = getClients().filter((c) => c.id !== id);
  setClients(list);
  return list;
}

function getSession() {
  return get(KEYS.SESSION, null);
}
function setSession(s) { set(KEYS.SESSION, s); }
function clearSession() { remove(KEYS.SESSION); }

// 客户类型(短名入库,描述用于选择器展示)
const CLIENT_TYPES = [
  { value: '短期过渡型', desc: '三个月内需用钱买房,资金留不住' },
  { value: '观望等待型', desc: '有购房意愿但无明确时间,可中期留存' },
  { value: '长期留存型', desc: '暂无购房计划,资金可长期配置' },
  { value: '高净值型',   desc: '托管金额≥300万或他行VIP,可做私行方案' },
  { value: '其他',       desc: '需在备注说明具体情况' }
];

// 字段定义(给表单使用)
const FORM_FIELDS = {
  basic: [
    { key: 'name',          label: '姓名',       required: true,  placeholder: '客户姓名' },
    { key: 'clientNo',      label: '客户号',     required: true,  placeholder: '如 K2025001' },
    { key: 'managedAmount', label: '托管金额(¥)', required: false, type: 'number', placeholder: '如 500000' },
    { key: 'handler',       label: '经办人',     required: true,  placeholder: '经办人姓名' },
    { key: 'clientType',    label: '客户类型',   type: 'select', options: CLIENT_TYPES.map(function (t) { return t.value; }) }
  ],
  timeNodes: [
    { key: 'registerDate',        label: '登记日期',       type: 'date' },
    { key: 'cardDate',            label: '开卡日期',       type: 'date' },
    { key: 'expectedDepositDate', label: '预计入账日期',    type: 'date' },
    { key: 'limitExpiryDate',     label: '限额失效日期',    type: 'date' },
    { key: 'depositDesc',         label: '入账时间描述',    type: 'textarea', placeholder: '默认无;如 理财到期转入 · 预计金额 200万' }
  ],
  acquisition: [
    { key: 'channel',         label: '获客方式',   type: 'select', options: ['营销经纪人','SOHO驻点','光大通线索','厅堂接待','转介绍','小渠道营销','其他'] },
    { key: 'acquirer',        label: '链家签约经理', placeholder: '链家签约经理姓名' },
    { key: 'referralManager', label: '转介理财经理', placeholder: '转介绍方理财经理' },
    { key: 'claimStatus',     label: '认领状态',   type: 'select', options: ['已认领','未认领','无需认领'] },
    { key: 'claimDate',       label: '认领日期',   type: 'date' }
  ],
  status: [
    { key: 'currentStatus',        label: '当前状态',       type: 'select', options: ['待办卡','待入金','待填客户号','待转介','留存财富客户','留存5-50万','已转出','已调整管户归属'] },
    { key: 'retentionProductType', label: '留存产品类型',   type: 'select', options: ['活期','定存','大额存单','理财产品','结构性存款','基金','保险','组合配置'] },
    { key: 'aum',                  label: 'AUM(¥)',        type: 'number', placeholder: '资产管理规模' },
    { key: 'retentionReportDate',  label: '留存填报日期',   type: 'date' },
    { key: 'retentionAmount',      label: '留存量(¥)',     type: 'number', placeholder: '已留存资金量' },
    { key: 'vipPotential',         label: '他行VIP潜力',   type: 'select', options: ['潜在600万以上','潜在100万-600万','潜在50万-100万','潜在20万-50万','其他'] },
    { key: 'riskPreference',       label: '风险偏好',      type: 'select', options: ['无风评','谨慎型','稳健型','平衡型','进取型','激进型'] },
    { key: 'remark',               label: '备注',         type: 'textarea', placeholder: '补充说明、跟进要点、注意事项' }
  ],
  // 兼容旧引用
  referral: [],
  transfer: []
};

// 工作进度: 六项固定工序,完成一项点一项,进度 = 完成数/6
const PROGRESS_ITEMS = [
  { key: 'queryClientNo',  label: '查询客户号' },
  { key: 'adjustLimit',    label: '调整限额' },
  { key: 'claimRelation',  label: '认领关系' },
  { key: 'fundRetention',  label: '资金留存' },
  { key: 'wecomBind',      label: '企微绑定' },
  { key: 'expiryFollowup', label: '到期跟进' }
];
function emptyProgress() {
  const p = {};
  PROGRESS_ITEMS.forEach(function (it) { p[it.key] = false; });
  return p;
}
function progressCount(progress) {
  if (!progress) return 0;
  return PROGRESS_ITEMS.reduce(function (n, it) { return n + (progress[it.key] ? 1 : 0); }, 0);
}

// 生成一个客户ID
function newClientId() {
  return 'C' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
}

// 演示数据
function seedDemoData() {
  const staffs = [
    { id: 'S001', name: '张丽',   total: 12, today: 1 },
    { id: 'S002', name: '李伟',   total: 9,  today: 2 },
    { id: 'S003', name: '王芳',   total: 7,  today: 0 },
    { id: 'S004', name: '陈强',   total: 15, today: 3 }
  ];
  setStaffs(staffs);

  const seedClients = [
    {
      id: 'demo_1', staffId: 'S001', staffName: '张丽',
      basic: { name: '刘建国', clientNo: 'K2025001', managedAmount: 500000, handler: '张丽' },
      timeNodes: { registerDate: '2025-03-15', cardDate: '2025-03-20', expectedDepositDate: '2025-04-01', depositDesc: '他行理财到期转入，预计金额 50万' },
      acquisition: { channel: '转介绍', acquirer: '张丽', referralManager: '王经理(建行)', claimStatus: '已认领', claimDate: '2025-03-16' },
      status: { currentStatus: '已签约', retentionProductType: '大额存单+基金定投', aum: 1200000, retentionReportDate: '2025-04-05', vipPotential: '中', riskPreference: '稳健型', remark: '资金实力强，偏好低风险配置' }
    },
    {
      id: 'demo_2', staffId: 'S002', staffName: '李伟',
      basic: { name: '周敏', clientNo: 'K2025002', managedAmount: 0, handler: '李伟' },
      timeNodes: { registerDate: '2025-06-02', cardDate: '2025-06-05', expectedDepositDate: '2025-07-15', depositDesc: '出售房产回款，预计到账 300万' },
      acquisition: { channel: '抖音/快手', acquirer: '李伟', referralManager: '', claimStatus: '已认领', claimDate: '2025-06-03' },
      status: { currentStatus: '高意向', retentionProductType: '结构性存款+保险', aum: 800000, retentionReportDate: '', vipPotential: '高', riskPreference: '平衡型', remark: '7月直播引流获客，对结构性产品兴趣浓厚' }
    },
    {
      id: 'demo_3', staffId: 'S002', staffName: '李伟',
      basic: { name: '孙浩', clientNo: 'K2025003', managedAmount: 300000, handler: '李伟' },
      timeNodes: { registerDate: '2025-02-10', cardDate: '2025-02-12', expectedDepositDate: '2025-02-28', depositDesc: '年终奖到账，一次性存入 30万' },
      acquisition: { channel: '电销', acquirer: '李伟', referralManager: '', claimStatus: '无需认领', claimDate: '' },
      status: { currentStatus: '跟进中', retentionProductType: '短期理财', aum: 600000, retentionReportDate: '2025-03-01', vipPotential: '低', riskPreference: '保守型', remark: '公司分配名单，偏好短期灵活产品' }
    },
    {
      id: 'demo_4', staffId: 'S004', staffName: '陈强',
      basic: { name: '黄丽', clientNo: 'K2025004', managedAmount: 800000, handler: '陈强' },
      timeNodes: { registerDate: '2025-05-20', cardDate: '2025-05-25', expectedDepositDate: '2025-06-10', depositDesc: '综合资产归集，覆盖存款+理财+保险' },
      acquisition: { channel: '小红书', acquirer: '陈强', referralManager: '李明(工行)', claimStatus: '已认领', claimDate: '2025-05-22' },
      status: { currentStatus: '已签约', retentionProductType: '信托计划+终身寿险+基金组合', aum: 2000000, retentionReportDate: '2025-06-12', vipPotential: '高', riskPreference: '进取型', remark: '私行级潜力客户，每季度面访一次' }
    }
  ];
  seedClients.forEach((c) => upsertClient(c));
}

module.exports = {
  get, set, remove,
  KEYS,
  FORM_FIELDS,
  CLIENT_TYPES,
  PROGRESS_ITEMS, emptyProgress, progressCount,
  nowIso, formatDateTime,
  getClients, setClients, upsertClient, deleteClient,
  getStaffs, setStaffs,
  getSession, setSession, clearSession,
  newClientId,
  seedDemoData
};
