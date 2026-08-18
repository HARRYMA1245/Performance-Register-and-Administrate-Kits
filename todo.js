// utils/todo.js — 从客单数据推导待办事项
// 六类规则(如需调整口径,改这里即可):
//   缺客户号   : basic.clientNo 为空
//   待认领     : acquisition.claimStatus === '未认领'
//   限额到期   : 预计入账日期已过,但仍无入账描述(资金未到,开卡限额面临到期)
//   资金到账   : 已有入账描述(资金到了),但当前状态还不是 留存类/流失类(待转化)
//   缺留存明细 : 状态为留存类(已签约/留存财富客户/留存5-50万),但留存产品类型/AUM/留存填报日期有缺失

const TYPE_META = {
  noClientNo:    { label: '缺客户号',   cls: 'red' },
  unclaimed:     { label: '待认领',     cls: 'amber' },
  limitExpiring: { label: '限额到期',   cls: 'red' },
  fundArrived:   { label: '资金到账',   cls: 'green' },
  noRetention:   { label: '缺留存明细', cls: 'amber' }
};

const FILTERS = [
  { key: 'all',           label: '全部' },
  { key: 'noClientNo',    label: '缺客户号' },
  { key: 'unclaimed',     label: '待认领' },
  { key: 'limitExpiring', label: '限额到期' },
  { key: 'fundArrived',   label: '资金到账' },
  { key: 'noRetention',   label: '缺留存明细' }
];

function pad(n) { return n < 10 ? '0' + n : n; }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// 留存类状态 / 流失类状态(兼容新旧两套选项)
const RETAINED_STATUSES = ['已签约', '留存财富客户', '留存5-50万'];
const LOST_STATUSES = ['已流失', '已转出'];

function deriveTodos(records) {
  const today = todayStr();
  const todos = [];
  (records || []).forEach(function (c) {
    const b = c.basic || {}, acq = c.acquisition || {}, tn = c.timeNodes || {}, st = c.status || {};
    const base = { clientId: c.id, clientName: b.name || '(未命名)', staffName: c.staffName || '' };
    const isRetainedStatus = RETAINED_STATUSES.indexOf(st.currentStatus) >= 0;
    const isLostStatus = LOST_STATUSES.indexOf(st.currentStatus) >= 0;

    if (!b.clientNo) {
      todos.push(Object.assign({}, base, {
        type: 'noClientNo', date: tn.registerDate || '',
        desc: '客户号未填写,请补充完整'
      }));
    }
    if (acq.claimStatus === '未认领') {
      todos.push(Object.assign({}, base, {
        type: 'unclaimed', date: acq.claimDate || '',
        desc: '客户尚未认领,请尽快认领'
      }));
    }
    if (tn.expectedDepositDate && tn.expectedDepositDate < today && !tn.depositDesc) {
      const days = Math.round((new Date(today) - new Date(tn.expectedDepositDate)) / 86400000);
      todos.push(Object.assign({}, base, {
        type: 'limitExpiring', date: tn.expectedDepositDate,
        desc: '预计入账日已过 ' + days + ' 天仍未入金,开卡限额面临到期,请跟进'
      }));
    }
    if (tn.depositDesc && !isRetainedStatus && !isLostStatus) {
      todos.push(Object.assign({}, base, {
        type: 'fundArrived', date: tn.expectedDepositDate || tn.registerDate || '',
        desc: '资金已到账,待转化留存处理'
      }));
    }
    if (isRetainedStatus && (!st.retentionProductType || !st.aum || !st.retentionReportDate)) {
      todos.push(Object.assign({}, base, {
        type: 'noRetention', date: st.retentionReportDate || '',
        desc: '已留存但留存明细不完整(产品类型/AUM/填报日期)'
      }));
    }
  });

  // 日期新的排前面,无日期排最后
  todos.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  todos.forEach(function (t) {
    const meta = TYPE_META[t.type] || {};
    t.typeLabel = meta.label || t.type;
    t.cls = meta.cls || '';
  });
  return todos;
}

// 各类型计数(给筛选 chip 显示角标)
function countByType(todos) {
  const m = { all: todos.length };
  FILTERS.forEach(function (f) { if (f.key !== 'all') m[f.key] = 0; });
  todos.forEach(function (t) { m[t.type] = (m[t.type] || 0) + 1; });
  return m;
}

module.exports = { deriveTodos, countByType, FILTERS };
