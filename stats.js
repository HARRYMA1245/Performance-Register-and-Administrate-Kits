// utils/stats.js — 管理员统计模块的数据计算
// 所有指标均由每一张客单聚合而来:
//   登记口径 → timeNodes.registerDate   (金额取 basic.managedAmount)
//   开卡口径 → timeNodes.cardDate       (金额取 basic.managedAmount)
//   入金口径 → 有入账描述 depositDesc    (金额取 basic.managedAmount; 周趋势按 expectedDepositDate 归周)
//   留存口径 → status.retentionReportDate (金额取 status.retentionAmount / status.aum)

function pad(n) { return n < 10 ? '0' + n : n; }
function fmtMD(t) { const d = new Date(t); return pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

// 金额紧凑格式: 1.2亿 / 35.0万 / 8000
function fmtMoney(v) {
  v = v || 0;
  if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
  if (v >= 10000) return (v / 10000).toFixed(1) + '万';
  return String(Math.round(v));
}

function parseDay(s) {
  if (!s) return null;
  const t = new Date(String(s).slice(0, 10) + 'T00:00:00').getTime();
  return isNaN(t) ? null : t;
}

// 关键: 小程序 input 的值是字符串,聚合前必须转数字,否则 += 变成字符串拼接
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// 值驱动口径: 只要员工填了留存相关数值(留存量/AUM/产品类型)或状态为留存类,就算留存
function isRetained(c) {
  const st = c.status || {};
  return st.currentStatus === '已签约' || st.currentStatus === '留存财富客户'
    || st.currentStatus === '留存5-50万' || !!st.retentionProductType
    || num(st.retentionAmount) > 0 || num(st.aum) > 0;
}

// ---------- 阶段推断 ----------
// 员工不一定填开卡日期/入账描述,按"当前状态 + 工序进度"推断业务实际所处阶段
// 状态走到这些值时,说明卡已开:
const STAGE_AFTER_CARD = ['待入金', '待填客户号', '待转介', '留存财富客户', '留存5-50万', '已签约', '已转出', '已调整管户归属'];
// 状态走到这些值时,说明金已入:
const STAGE_AFTER_DEPOSIT = ['留存财富客户', '留存5-50万', '已签约', '已转出', '已调整管户归属'];

function isCardDone(c) {
  const tn = c.timeNodes || {}, st = c.status || {}, p = c.progress || {};
  return !!tn.cardDate || !!p.adjustLimit || STAGE_AFTER_CARD.indexOf(st.currentStatus) >= 0;
}
function isDepositDone(c) {
  const tn = c.timeNodes || {}, st = c.status || {}, p = c.progress || {};
  return !!tn.depositDesc || !!p.fundRetention
    || STAGE_AFTER_DEPOSIT.indexOf(st.currentStatus) >= 0
    || num(st.retentionAmount) > 0;
}

// ---------- 顶部 6 项指标 ----------
function topStats(records) {
  let retained = 0, pending = 0, totalManaged = 0, retainedAum = 0;
  records.forEach(function (c) {
    const st = c.status || {}, b = c.basic || {};
    totalManaged += num(b.managedAmount);
    retainedAum += num(st.aum);              // 填了 AUM 就计入,不卡留存状态
    if (isRetained(c)) {
      retained++;
    } else if (st.currentStatus && st.currentStatus !== '已流失') {
      pending++;
    }
  });
  return {
    totalCount: records.length,
    retainedCount: retained,
    pendingCount: pending,
    totalManaged: totalManaged,
    retainedAum: retainedAum,
    retentionRate: records.length ? Math.round(retained / records.length * 100) : 0
  };
}

// ---------- 资金转化漏斗(柱状) ----------
function funnel(records) {
  let reg = 0, card = 0, dep = 0, ret = 0, aum = 0;
  records.forEach(function (c) {
    const b = c.basic || {}, st = c.status || {};
    reg += num(b.managedAmount);
    if (isCardDone(c)) card += num(b.managedAmount);      // 开卡: 填了日期或状态/工序推断
    if (isDepositDone(c)) dep += num(b.managedAmount);    // 入金: 填了描述或状态/工序推断
    // 值驱动: 员工填了多少就显示多少,不要求先选"已签约"
    ret += num(st.retentionAmount);
    aum += num(st.aum);
  });
  const base = reg || 1;   // 百分比基准 = 登记托管金额
  const maxV = Math.max(reg, card, dep, ret, aum, 1);
  const items = [
    { label: '登记托管金额', value: reg,  pct: null },
    { label: '已开卡金额',   value: card, pct: Math.round(card / base * 100) + '%' },
    { label: '已入金金额',   value: dep,  pct: Math.round(dep  / base * 100) + '%' },
    { label: '已留存金额',   value: ret,  pct: Math.round(ret  / base * 100) + '%' },
    { label: '留存AUM',      value: aum,  pct: Math.round(aum  / base * 100) + '%' }
  ];
  items.forEach(function (it) {
    it.valueText = fmtMoney(it.value);
    it.widthPct = Math.max(2, Math.round(it.value / maxV * 100));
  });
  return items;
}

// ---------- 近八周按周聚合 ----------
function weekly(records) {
  const DAY = 86400000;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = 0; i < 8; i++) {
    const end = now.getTime() - (7 - i) * 7 * DAY;   // 该周最后一天
    const start = end - 6 * DAY;                      // 7 天窗口
    buckets.push({
      start: start, end: end + DAY - 1,
      label: fmtMD(start),
      managed: 0, deposit: 0, retention: 0, aum: 0,
      cntReg: 0, cntDep: 0, cntRet: 0
    });
  }
  records.forEach(function (c) {
    const b = c.basic || {}, tn = c.timeNodes || {}, st = c.status || {};
    // 日期回退: 员工没填日期时,按创建/更新时间归周,保证图表能反映填报内容
    const tReg = parseDay(tn.registerDate) || parseDay(c.createTime);
    const depDone = isDepositDone(c);
    const tDep = parseDay(tn.expectedDepositDate)
      || (depDone ? parseDay(c.updateTime || c.createTime) : null);
    const tRet = parseDay(st.retentionReportDate)
      || (isRetained(c) ? parseDay(c.updateTime || c.createTime) : null);
    const retained = isRetained(c);
    buckets.forEach(function (bk) {
      if (tReg !== null && tReg >= bk.start && tReg <= bk.end) {
        bk.managed += num(b.managedAmount); bk.cntReg++;
      }
      if (tDep !== null && tDep >= bk.start && tDep <= bk.end && depDone) {
        bk.deposit += num(b.managedAmount); bk.cntDep++;
      }
      if (tRet !== null && tRet >= bk.start && tRet <= bk.end && retained) {
        bk.retention += num(st.retentionAmount); bk.aum += num(st.aum); bk.cntRet++;
      }
    });
  });
  return buckets;
}

// ---------- 折线图几何(纯 view 渲染,免 canvas) ----------
// series: [{name, color, values:[n]}]  →  { points, segments, labels, width, height }
function lineGeometry(series, labels, width, height) {
  const padL = 8, padR = 8, padT = 30, padB = 8;
  const n = labels.length;
  let maxV = 1;
  series.forEach(function (s) {
    s.values.forEach(function (v) { if (v > maxV) maxV = v; });
  });
  const stepX = n > 1 ? (width - padL - padR) / (n - 1) : 0;
  const points = [], segments = [];
  series.forEach(function (s) {
    const pts = s.values.map(function (v, i) {
      return {
        x: padL + i * stepX,
        y: padT + (1 - v / maxV) * (height - padT - padB),
        v: v
      };
    });
    pts.forEach(function (p, i) {
      points.push({
        x: p.x, y: p.y, color: s.color,
        text: fmtMoney(p.v),
        lx: Math.max(0, Math.min(width - 56, p.x - 28)),   // 标签水平居中且不溢出
        ly: Math.max(0, p.y - 22)
      });
      if (i > 0) {
        const q = pts[i - 1];
        const dx = p.x - q.x, dy = p.y - q.y;
        segments.push({
          x: q.x, y: q.y,
          len: Math.sqrt(dx * dx + dy * dy),
          angle: Math.atan2(dy, dx) * 180 / Math.PI,
          color: s.color
        });
      }
    });
  });
  return { points: points, segments: segments, labels: labels, width: width, height: height };
}

// ---------- 三组柱状图(笔数趋势) ----------
function countChart(buckets) {
  let maxV = 1;
  buckets.forEach(function (b) {
    maxV = Math.max(maxV, b.cntReg, b.cntDep, b.cntRet);
  });
  return buckets.map(function (b) {
    return {
      label: b.label,
      bars: [
        { name: '登记款', value: b.cntReg, color: '#1f6feb', h: Math.round(b.cntReg / maxV * 100) },
        { name: '入金款', value: b.cntDep, color: '#f5a623', h: Math.round(b.cntDep / maxV * 100) },
        { name: '留存款', value: b.cntRet, color: '#1c8a4f', h: Math.round(b.cntRet / maxV * 100) }
      ]
    };
  });
}

// ---------- 汇总:一次算出管理端统计模块全部数据 ----------
function buildDashboard(records, chartWidthPx) {
  const top = topStats(records);
  const weeks = weekly(records);
  const labels = weeks.map(function (w) { return w.label; });
  const W = chartWidthPx || 300, H = 180;

  const trend = lineGeometry([
    { name: '托管金额', color: '#1f6feb', values: weeks.map(function (w) { return w.managed; }) },
    { name: '入金金额', color: '#f5a623', values: weeks.map(function (w) { return w.deposit; }) },
    { name: '留存金额', color: '#1c8a4f', values: weeks.map(function (w) { return w.retention; }) }
  ], labels, W, H);

  const compare = lineGeometry([
    { name: '托管金额', color: '#1f6feb', values: weeks.map(function (w) { return w.managed; }) },
    { name: '留存AUM', color: '#8a5cf6', values: weeks.map(function (w) { return w.aum; }) }
  ], labels, W, H);

  return {
    top: top,
    funnel: funnel(records),
    trend: trend,
    compare: compare,
    countChart: countChart(weeks),
    trendLegend: [
      { name: '托管金额', color: '#1f6feb' },
      { name: '入金金额', color: '#f5a623' },
      { name: '留存金额', color: '#1c8a4f' }
    ],
    compareLegend: [
      { name: '托管金额', color: '#1f6feb' },
      { name: '留存AUM', color: '#8a5cf6' }
    ],
    countLegend: [
      { name: '登记款', color: '#1f6feb' },
      { name: '入金款', color: '#f5a623' },
      { name: '留存款', color: '#1c8a4f' }
    ]
  };
}

module.exports = { buildDashboard, topStats, funnel, weekly, lineGeometry, countChart, fmtMoney, isRetained, isCardDone, isDepositDone, num };
