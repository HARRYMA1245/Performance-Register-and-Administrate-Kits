// cloudfunctions/api/index.js — 客户档案管家 · 云函数后端
// 由本地 server.js 迁移而来,数据层从 data.json 换成云数据库
// 兼容两种云环境: 微信云开发(wx-server-sdk) / 腾讯云 CloudBase 控制台(@cloudbase/node-sdk)
//
// 安全设计(与客户端无关,全部在云端强制执行):
//  1. 所有接口(除登录/健康检查)必须带 HMAC token
//  2. 每个接口独立校验 role,员工 token 调管理接口一律 403
//  3. 员工同步客户: 强制 staffId=登录人;已存在档案非本人的拒绝合并(防伪造 id 篡改/抢夺)
//  4. 密码 scrypt 哈希存储;登录失败限流(单实例内 8 次/10 分钟)
//  5. 登录报错文案统一,不暴露员工是否存在
//  6. 数据库集合权限必须设为「所有用户不可读写」(仅云函数能访问)
//
// 配置(在云函数环境变量中设置,也可直接改下面默认值):
//   ADMIN_PASSWORD  管理密码(默认 Admin@123,部署后请立即修改)
//   TOKEN_SECRET    token 签名密钥(默认随机串,改后所有登录态失效)

let cloud;
try { cloud = require('wx-server-sdk'); }        // 微信云开发
catch (e) {
  try { cloud = require('@cloudbase/node-sdk'); } // 腾讯云 CloudBase 控制台
  catch (e2) { cloud = require('tcb-admin-node'); }
}
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'cm-default-secret-please-change-in-env-vars';

// 管理员密码:DB优先(admin_pwd_${type}) → 旧key兜底 → 环境变量
async function getAdminPassword(type) {
  var docId = 'admin_pwd_' + (type || 'card');
  try { var doc = await db.collection('settings').doc(docId).get(); if (doc.data && doc.data.password) return doc.data.password; } catch (e) {}
  try { var old = await db.collection('settings').doc('admin_password').get(); if (old.data && old.data.password) return old.data.password; } catch (e) {}
  return ADMIN_PASSWORD;
}
async function setAdminPassword(type, newPwd) {
  var docId = 'admin_pwd_' + (type || 'card');
  try {
    var coll = db.collection('settings');
    await coll.doc(docId).set({ data: { password: newPwd, updatedAt: new Date().toISOString() } });
  } catch (e) {
    // doc().set()失败时(集合不存在/文档不存在), 用 add 兜底
    try { await db.collection('settings').add({ data: { _id: docId, password: newPwd, updatedAt: new Date().toISOString() } }); } catch (e2) {}
  }
}

// ---------- 密码(scrypt) ----------
function hashPassword(pwd, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return 'scrypt:' + salt + ':' + h;
}
function checkPassword(pwd, stored) {
  if (!stored) return false;
  const parts = stored.split(':');
  if (parts.length === 3 && parts[0] === 'scrypt') {
    const h = crypto.scryptSync(String(pwd), parts[1], 32);
    const expect = Buffer.from(parts[2], 'hex');
    return h.length === expect.length && crypto.timingSafeEqual(h, expect);
  }
  if (parts.length === 2) {  // 兼容旧 sha256
    const h = crypto.createHash('sha256').update(parts[0] + ':' + pwd).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(stored));
  }
  return false;
}
function isLegacyHash(stored) { return stored && stored.split(':').length === 2; }
function isStrongPassword(p) {
  return typeof p === 'string' && p.length >= 6
    && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[^A-Za-z0-9]/.test(p);
}
const PWD_RULE_MSG = '密码需至少 6 位,且包含大写字母、小写字母和特殊字符';

// ---------- Token (无状态 HMAC) ----------
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function issueToken(role, id, name) {
  const body = b64url(JSON.stringify({ role, id, name, exp: Date.now() + 30 * 24 * 3600 * 1000 }));
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + sig;
}
function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  const expect = crypto.createHmac('sha256', TOKEN_SECRET).update(parts[0]).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (expect !== parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

// ---------- 登录限流(单实例内存,尽力而为) ----------
const loginFails = {};
const LOGIN_WINDOW = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
function failKey(event) { return 'wx:' + (event._openidHint || 'anon'); }
function loginLocked(key) { const r = loginFails[key]; return r && r.lockedUntil && r.lockedUntil > Date.now(); }
function recordLoginFail(key) {
  const now = Date.now();
  let r = loginFails[key];
  if (!r || r.resetAt < now) r = loginFails[key] = { count: 0, resetAt: now + LOGIN_WINDOW, lockedUntil: 0 };
  r.count++;
  if (r.count >= LOGIN_MAX_FAILS) { r.lockedUntil = now + LOGIN_WINDOW; r.count = 0; r.resetAt = now + LOGIN_WINDOW; }
}
function clearLoginFail(key) { delete loginFails[key]; }

// ---------- 数据库工具(分页取全量) ----------
async function fetchAll(coll, where) {
  const MAX = 100;
  let skip = 0, all = [];
  for (;;) {
    let q = db.collection(coll);
    if (where) q = q.where(where);
    const res = await q.skip(skip).limit(MAX).get();
    all = all.concat(res.data);
    if (res.data.length < MAX) break;
    skip += MAX;
  }
  return all;
}
// 取员工类型('card'开卡/'hall'柜员/'low'理财经理)
async function getStaffType(id) {
  const found = await fetchAll('staffs', { id });
  return found[0] ? (found[0].type || 'card') : 'card';
}
function nowIso() { return new Date().toISOString(); }

// 统一响应
function ok(body) { return { statusCode: 200, body }; }
function err(code, msg) { return { statusCode: code, body: { error: msg } }; }

// ---------- HTTP 触发器适配(网页版 H5 直连用) ----------
// 云函数同时接受两种调用:
//   小程序 wx.cloud.callFunction → event = { path, method, query, body, token }
//   网页 fetch HTTP 触发器       → event = { httpMethod, path, headers, queryString, body(string) }
function normalizeHttp(e) {
  let body = {};
  try { body = e.body ? JSON.parse(e.body) : {}; } catch (err) {}
  const headers = e.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const query = e.queryString || e.queryStringParameters || {};
  // token 三通道: Authorization 头 > URL 参数 > body(防网关吃请求头)
  const token = auth.replace(/^Bearer\s+/i, '') || query.token || body.token || '';
  return {
    path: ((e.path || '/').split('?')[0] || '/'),   // 去问号参数,防 URL token 污染路由
    method: e.httpMethod,
    query: query,
    body: body,
    token: token,
    // 网页端没有 openid,用来源 IP 做限流标识
    _sourceIp: (headers['x-forwarded-for'] || '').split(',')[0].trim()
      || (e.requestContext && e.requestContext.sourceIp) || ''
  };
}
const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

// ---------- 主入口 ----------
exports.main = async (rawEvent) => {
  const isHttp = rawEvent && rawEvent.httpMethod;
  // 浏览器跨域预检
  if (isHttp && rawEvent.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  const event = isHttp ? normalizeHttp(rawEvent) : (rawEvent || {});
  // 限流标识: 小程序用 openid(伪造不了),网页用来源 IP
  let openid = '';
  if (!isHttp) { try { openid = cloud.getWXContext().OPENID || ''; } catch (e) {} }
  event._openidHint = openid || event._sourceIp || 'anon';

  const res = await handle(event);
  if (isHttp) {
    return { statusCode: res.statusCode, headers: CORS_HEADERS, body: JSON.stringify(res.body) };
  }
  return res;
};

// ---------- 业务路由 ----------
async function handle(event) {
  // 路径归一化: 部分 HTTP 网关给 path 不带前导 /(如 api/hall/sync)
  const raw = event.path || '/';
  const path = raw[0] === '/' ? raw : '/' + raw;
  const method = (event.method || 'GET').toUpperCase();
  const body = event.body || {};
  const query = event.query || {};

  // 健康检查
  if (path === '/api/health') {
    return ok({ ok: true, time: nowIso() });
  }

  // ---------- 登录 ----------
  if (path === '/api/login' && method === 'POST') {
    const key = failKey(event);
    if (loginLocked(key)) return err(429, '尝试次数过多,请 10 分钟后再试');

    if (body.role === 'manager') {
      const adminPwd = await getAdminPassword(body.type || 'card');
      if (body.password !== adminPwd) {
        recordLoginFail(key);
        return err(401, '管理密码错误');
      }
      clearLoginFail(key);
      return ok({ token: issueToken('manager', 'admin', '管理员'), name: '管理员' });
    }
    if (body.role === 'staff') {
      const name = (body.name || '').trim();
      const found = await fetchAll('staffs', { name });
      const staff = found[0];
      // 统一报错,不暴露员工是否存在(防花名册枚举)
      if (!staff || !checkPassword(body.password || '', staff.passwordHash)) {
        recordLoginFail(key);
        return err(401, '姓名或密码错误');
      }
      if (isLegacyHash(staff.passwordHash)) {
        await db.collection('staffs').doc(staff._id).update({ data: { passwordHash: hashPassword(body.password) } });
      }
      clearLoginFail(key);
      return ok({ token: issueToken('staff', staff.id, staff.name), staffId: staff.id, staffName: staff.name, staffType: staff.type || 'card' });
    }
    return err(400, 'role 必须为 staff 或 manager');
  }

  // 以下接口都需要 token
  const user = verifyToken(event.token || '');
  if (!user) return err(401, '未登录或登录已过期');

  // ---------- 员工改密 ----------
  if (path === '/api/change-password' && method === 'POST') {
    if (user.role !== 'staff') return err(403, '仅员工可操作');
    const newPwd = (body.newPassword || '').trim();
    if (!isStrongPassword(newPwd)) return err(400, PWD_RULE_MSG);
    const found = await fetchAll('staffs', { id: user.id });
    const staff = found[0];
    if (!staff) return err(404, '账号不存在');
    if (!checkPassword(body.oldPassword || '', staff.passwordHash)) return err(401, '原密码错误');
    await db.collection('staffs').doc(staff._id).update({ data: { passwordHash: hashPassword(newPwd) } });
    return ok({ ok: true });
  }

  // ---------- 管理员改密 ----------
  if (path === '/api/admin/change-password' && method === 'POST') {
    if (user.role !== 'manager') return err(403, '仅管理员可操作');
    const curPwd = await getAdminPassword(body.type || 'card');
    if ((body.oldPassword || '') !== curPwd) return err(401, '原密码错误');
    const newPwd = (body.newPassword || '').trim();
    if (!isStrongPassword(newPwd)) return err(400, PWD_RULE_MSG);
    await setAdminPassword(body.type || 'card', newPwd);
    return { ok: true, msg: '管理密码已修改,即时生效' };
  }
  // ---------- 管理员密码校验(重置数据等二次确认用) ----------
  if (path === '/api/admin/verify-password' && method === 'POST') {
    if (user.role !== 'manager') return err(403, '仅管理员可操作');
    const curPwd = await getAdminPassword(body.type || 'card');
    if ((body.password || '') !== curPwd) return err(401, '密码错误');
    return ok({ ok: true });
  }

  // ---------- 员工花名册(管理员) ----------
  if (path === '/api/staffs' && method === 'GET') {
    if (user.role !== 'manager') return err(403, '仅管理员可操作');
    const list = await fetchAll('staffs');
    return ok(list.map((s) => ({ id: s.id, name: s.name, type: s.type || 'card', createdAt: s.createdAt })));
  }
  if (path === '/api/staffs' && method === 'POST') {
    if (user.role !== 'manager') return err(403, '仅管理员可操作');
    const name = (body.name || '').trim();
    const password = (body.password || '').trim();
    const type = body.type || 'card';   // 开卡员工(card) / 厅堂融合员工(hall)
    if (!name || !password) return err(400, '姓名和密码必填');
    if (!isStrongPassword(password)) return err(400, PWD_RULE_MSG);
    const found = await fetchAll('staffs', { name });
    if (found[0]) {
      await db.collection('staffs').doc(found[0]._id).update({ data: { passwordHash: hashPassword(password), type } });
      return ok({ ok: true, id: found[0].id, updated: true });
    }
    const id = 'S' + Date.now().toString(36).toUpperCase();
    await db.collection('staffs').add({ data: { id, name, passwordHash: hashPassword(password), type, createdAt: nowIso() } });
    return ok({ ok: true, id, created: true });
  }
  if (path === '/api/staffs' && method === 'DELETE') {
    if (user.role !== 'manager') return err(403, '仅管理员可操作');
    await db.collection('staffs').where({ id: query.id || '' }).remove();
    return ok({ ok: true });
  }
  // 理财经理名单(柜员填表选对接人用;登录员工即可拉取)
  if (path === '/api/staffs/low' && method === 'GET') {
    if (user.role !== 'staff') return err(403, '仅员工可拉取');
    const list = await fetchAll('staffs', { type: 'low' });
    return ok(list.map((s) => ({ id: s.id, name: s.name })));
  }

  // ---------- 客户数据 ----------
  // 员工上传(强制归属本人;他人档案拒绝合并)
  if (path === '/api/clients/sync' && method === 'POST') {
    if (user.role !== 'staff') return err(403, '仅员工可上传');
    const records = Array.isArray(body.records) ? body.records : [];
    let merged = 0, rejected = 0;
    for (const r of records) {
      if (!r || !r.id) { rejected++; continue; }
      const found = await fetchAll('clients', { id: r.id });
      if (found[0]) {
        if (found[0].staffId !== user.id) { rejected++; continue; }   // 越权防护
        const upd = Object.assign({}, r);
        delete upd._id; delete upd.staffId; delete upd.staffName; delete upd.createTime;
        upd.updateTime = nowIso();
        await db.collection('clients').doc(found[0]._id).update({ data: upd });
      } else {
        const doc = Object.assign({}, r);
        delete doc._id;
        doc.staffId = user.id;
        doc.staffName = user.name;
        doc.createTime = doc.createTime || nowIso();
        doc.updateTime = nowIso();
        await db.collection('clients').add({ data: doc });
      }
      merged++;
    }
    const deleted = Array.isArray(body.deleted) ? body.deleted : [];
    for (const id of deleted) {
      await db.collection('clients').where({ id, staffId: user.id }).remove();
    }
    return ok({ ok: true, merged, rejected });
  }
  // 员工拉自己的
  if (path === '/api/clients' && method === 'GET') {
    if (user.role !== 'staff') return err(403, '仅员工可拉取');
    const list = await fetchAll('clients', { staffId: user.id });
    list.forEach((c) => delete c._id);
    return ok(list);
  }

  // ---------- 厅堂融合(独立于客户档案的业务表) ----------
  // 柜员上传(强制归属本人;他人记录拒绝合并 —— 与客户接口同规格防护)
  if (path === '/api/hall/sync' && method === 'POST') {
    if (user.role !== 'staff') return err(403, '仅员工可上传');
    const staffType = await getStaffType(user.id);
    if (staffType !== 'hall') return err(403, '仅柜员可登记厅堂业务');
    const records = Array.isArray(body.records) ? body.records : [];
    let merged = 0, rejected = 0;
    for (const r of records) {
      if (!r || !r.id) { rejected++; continue; }
      const found = await fetchAll('hall', { id: r.id });
      if (found[0]) {
        if (found[0].staffId !== user.id) { rejected++; continue; }   // 越权防护
        const upd = Object.assign({}, r);
        delete upd._id; delete upd.staffId; delete upd.staffName; delete upd.createTime;
        delete upd.handoffStatus; delete upd.handoffNote; delete upd.handoffTime;  // 交接状态由理财经理维护,柜员不能改
        upd.updateTime = nowIso();
        await db.collection('hall').doc(found[0]._id).update({ data: upd });
      } else {
        const doc = Object.assign({}, r);
        delete doc._id;
        doc.staffId = user.id;
        doc.staffName = user.name;
        doc.createTime = doc.createTime || nowIso();
        doc.updateTime = nowIso();
        doc.handoffStatus = doc.handoffStatus || '';   // '' 未处理 / 'success' 营销成功 / 'failed' 未营销成功 / 'pending' 营销成果待定
        await db.collection('hall').add({ data: doc });
      }
      merged++;
    }
    return ok({ ok: true, merged, rejected });
  }
  // 员工拉自己的厅堂记录:柜员看自己登记的;理财经理看交接给自己(contact=本人姓名)的
  if (path === '/api/hall' && method === 'GET') {
    if (user.role !== 'staff') return err(403, '仅员工可拉取');
    const staffType = await getStaffType(user.id);
    let list;
    if (staffType === 'low') list = await fetchAll('hall', { contact: user.name });
    else list = await fetchAll('hall', { staffId: user.id });
    list.forEach((c) => delete c._id);
    return ok(list);
  }
  // 理财经理标记营销结果(营销成功/未营销成功 + 补充说明)
  if (path === '/api/hall/handoff' && method === 'POST') {
    if (user.role !== 'staff') return err(403, '仅员工可操作');
    const staffType = await getStaffType(user.id);
    if (staffType !== 'low') return err(403, '仅理财经理可标记营销结果');
    const id = (body.id || '').trim();
    if (!id) return err(400, '缺少记录 id');
    const status = body.handoffStatus;
    if (status !== 'success' && status !== 'failed' && status !== 'pending') return err(400, '请选择营销结果');
    const found = await fetchAll('hall', { id });
    const rec = found[0];
    if (!rec) return err(404, '记录不存在');
    if ((rec.contact || '') !== user.name) return err(403, '该业务不是交接给你的');
    await db.collection('hall').doc(rec._id).update({ data: {
      handoffStatus: status,
      handoffNote: (body.handoffNote || '').trim(),
      handoffTime: nowIso()
    } });
    return ok({ ok: true });
  }
  // 管理员拉全量厅堂记录
  if (path === '/api/hall/all' && method === 'GET') {
    if (user.role !== 'manager') return err(403, '仅管理员可查看');
    const list = await fetchAll('hall');
    list.forEach((c) => delete c._id);
    return ok(list);
  }
  // 删除厅堂记录(员工只能删自己的;管理员任意)
  if (path === '/api/hall' && method === 'DELETE') {
    const id = query.id || '';
    const where = user.role === 'manager' ? { id } : { id, staffId: user.id };
    const res = await db.collection('hall').where(where).remove();
    return ok({ ok: true, deleted: res.stats ? res.stats.removed : 0 });
  }
  // 管理员拉全量
  if (path === '/api/clients/all' && method === 'GET') {
    if (user.role !== 'manager') return err(403, '仅管理员可查看');
    const list = await fetchAll('clients');
    list.forEach((c) => delete c._id);
    return ok(list);
  }
  // 删除(员工只能删自己的;管理员任意)
  if (path === '/api/clients' && method === 'DELETE') {
    const id = query.id || '';
    const where = user.role === 'manager' ? { id } : { id, staffId: user.id };
    const res = await db.collection('clients').where(where).remove();
    return ok({ ok: true, deleted: res.stats ? res.stats.removed : 0 });
  }

  // ---------- 管理员数据管理 ----------
  if (path === '/api/admin/clear-demo' && method === 'POST') {
    if (user.role !== 'manager') return err(403, '仅管理员可操作');
    let removed = 0;
    const clients = await fetchAll('clients');
    for (const c of clients) {
      if (String(c.id).indexOf('demo_') === 0) { await db.collection('clients').doc(c._id).remove(); removed++; }
    }
    const halls = await fetchAll('hall');
    for (const h of halls) {
      if (String(h.id).indexOf('demo_') === 0) { await db.collection('hall').doc(h._id).remove(); removed++; }
    }
    return ok({ ok: true, removed });
  }
  if (path === '/api/admin/reset-all' && method === 'POST') {
    if (user.role !== 'manager') return err(403, '仅管理员可操作');
    const clients = await fetchAll('clients');
    for (const c of clients) { await db.collection('clients').doc(c._id).remove(); }
    const halls = await fetchAll('hall');
    for (const h of halls) { await db.collection('hall').doc(h._id).remove(); }
    return ok({ ok: true });
  }

  // ---------- 小程序码(云函数免 secret 直接调微信接口) ----------
  if (path === '/api/qrcode' && method === 'GET') {
    if (user.role !== 'manager') return err(403, '仅管理员可操作');
    const scene = 'role=staff&sid=' + encodeURIComponent(query.staffId || '')
      + '&sname=' + encodeURIComponent(query.staffName || '');
    try {
      const res = await cloud.openapi.wxacode.getUnlimited({
        scene,
        page: 'pages/index/index',
        checkPath: false,
        envVersion: 'trial',   // develop | trial | release(上架后改 release)
        width: 280
      });
      if (!res.buffer) return err(500, '生成失败');
      return ok({ imageBase64: res.buffer.toString('base64') });
    } catch (e) {
      return err(500, e.message || '生成失败');
    }
  }

  return err(404, 'not found: ' + path);
};
