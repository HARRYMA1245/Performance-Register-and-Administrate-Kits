// server/server.js — 客户档案管家 后端服务
// 零依赖 Node.js 服务器,直接 `node server.js` 即可运行
//
// 功能:
//  1. 登录鉴权(员工: 姓名+密码; 管理员: 管理密码) —— HMAC 无状态 token
//  2. 员工花名册管理(管理员增删、重置密码)
//  3. 客户数据同步(员工上传/拉取自己的数据; 管理员拉全量)
//  4. 演示数据清理 / 全量重置
//  5. 小程序码生成(代理微信 wxacode.getUnlimited,需在 config.json 填 secret)
//
// 数据文件: data.json(自动创建)   配置: config.json

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const PORT = process.env.PORT || 9000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');

// ---------- 配置 ----------
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    const def = {
      adminPassword: 'admin123',
      tokenSecret: crypto.randomBytes(16).toString('hex'),
      wechat: { appid: '', secret: '' }
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2));
    console.log('[init] 已生成 config.json,默认管理密码 admin123,请尽快修改');
    return def;
  }
}
const CONFIG = loadConfig();

// ---------- 数据 ----------
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { staffs: [], clients: [] };
  }
}
let DB = loadData();
let saveTimer = null;
function saveData() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(DB, null, 2), () => {});
  }, 200);
}

// ---------- 密码 ----------
// 新格式: scrypt: salt : hash  (抗暴力破解)
// 旧格式: salt : sha256hash   (登录成功时自动升级为 scrypt)
function hashPassword(pwd, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return 'scrypt:' + salt + ':' + h;
}
function checkPassword(pwd, stored) {
  if (!stored) return false;
  const parts = stored.split(':');
  // 新格式 scrypt
  if (parts.length === 3 && parts[0] === 'scrypt') {
    const h = crypto.scryptSync(String(pwd), parts[1], 32);
    const expect = Buffer.from(parts[2], 'hex');
    return h.length === expect.length && crypto.timingSafeEqual(h, expect);
  }
  // 旧格式 sha256(兼容)
  if (parts.length === 2) {
    const h = crypto.createHash('sha256').update(parts[0] + ':' + pwd).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(stored));
  }
  return false;
}
function isLegacyHash(stored) {
  return stored && stored.split(':').length === 2;
}

// 密码强度: 至少8位,必须含大写字母、小写字母、特殊字符
function isStrongPassword(p) {
  return typeof p === 'string'
    && p.length >= 8
    && /[a-z]/.test(p)
    && /[A-Z]/.test(p)
    && /[^A-Za-z0-9]/.test(p);
}
const PWD_RULE_MSG = '密码需至少 8 位,且包含大写字母、小写字母和特殊字符';

// ---------- Token (无状态 HMAC) ----------
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', CONFIG.tokenSecret).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + sig;
}
function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  const expect = crypto.createHmac('sha256', CONFIG.tokenSecret).update(parts[0]).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (expect !== parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}
function issueToken(role, id, name) {
  return signToken({ role, id, name, exp: Date.now() + 30 * 24 * 3600 * 1000 }); // 30天
}

// ---------- 登录限流(防暴力破解) ----------
// 同一 IP 10 分钟内连续失败 8 次,锁定 10 分钟
const loginFails = {};   // ip -> { count, resetAt, lockedUntil }
const LOGIN_WINDOW = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function loginLocked(ip) {
  const r = loginFails[ip];
  return r && r.lockedUntil && r.lockedUntil > Date.now();
}
function recordLoginFail(ip) {
  const now = Date.now();
  let r = loginFails[ip];
  if (!r || r.resetAt < now) r = loginFails[ip] = { count: 0, resetAt: now + LOGIN_WINDOW, lockedUntil: 0 };
  r.count++;
  if (r.count >= LOGIN_MAX_FAILS) {
    r.lockedUntil = now + LOGIN_WINDOW;
    r.count = 0;
    r.resetAt = now + LOGIN_WINDOW;
  }
}
function clearLoginFail(ip) { delete loginFails[ip]; }

// ---------- HTTP 工具 ----------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); }
    });
  });
}
function auth(req) {
  const h = req.headers['authorization'] || '';
  const token = h.replace(/^Bearer\s+/i, '');
  return verifyToken(token);
}
function nowIso() { return new Date().toISOString(); }

// ---------- 微信 access_token 缓存 ----------
let wxTokenCache = { token: '', exp: 0 };
function getWxAccessToken() {
  return new Promise((resolve, reject) => {
    if (!CONFIG.wechat.appid || !CONFIG.wechat.secret) {
      return reject(new Error('请先在 server/config.json 填写 wechat.appid 和 wechat.secret'));
    }
    if (wxTokenCache.token && wxTokenCache.exp > Date.now() + 60000) {
      return resolve(wxTokenCache.token);
    }
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${CONFIG.wechat.appid}&secret=${CONFIG.wechat.secret}`;
    https.get(url, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.access_token) {
            wxTokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 7200) * 1000 };
            resolve(j.access_token);
          } else {
            reject(new Error(j.errmsg || '获取 access_token 失败'));
          }
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
function fetchWxacode(accessToken, scene, page) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      scene,
      page: page || 'pages/index/index',
      check_path: false,
      env_version: 'trial',   // develop(开发版) | trial(体验版) | release(正式版)
      width: 280
    });
    const req = https.request({
      hostname: 'api.weixin.qq.com',
      path: '/wxa/getwxacodeunlimit?access_token=' + accessToken,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const buf = Buffer.concat(chunks);
        // 成功时返回 image/png 二进制;失败时返回 JSON
        const ct = r.headers['content-type'] || '';
        if (ct.indexOf('json') >= 0) {
          try { reject(new Error(JSON.parse(buf.toString('utf8')).errmsg || '生成失败')); }
          catch (e) { reject(new Error('生成失败')); }
        } else {
          resolve(buf);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;

  if (m === 'OPTIONS') { sendJSON(res, 200, {}); return; }

  // 健康检查
  if (p === '/api/health') {
    sendJSON(res, 200, { ok: true, time: nowIso(), staffs: DB.staffs.length, clients: DB.clients.length });
    return;
  }

  // ---------- 登录 ----------
  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    if (loginLocked(ip)) {
      sendJSON(res, 429, { error: '尝试次数过多,请 10 分钟后再试' }); return;
    }
    const body = await readBody(req);
    if (body.role === 'manager') {
      if (body.password !== CONFIG.adminPassword) {
        recordLoginFail(ip);
        sendJSON(res, 401, { error: '管理密码错误' }); return;
      }
      clearLoginFail(ip);
      sendJSON(res, 200, { token: issueToken('manager', 'admin', '管理员'), name: '管理员' });
      return;
    }
    if (body.role === 'staff') {
      const name = (body.name || '').trim();
      const staff = DB.staffs.find((s) => s.name === name);
      // 统一报错文案,不暴露员工是否存在(防花名册枚举)
      if (!staff || !checkPassword(body.password || '', staff.passwordHash)) {
        recordLoginFail(ip);
        sendJSON(res, 401, { error: '姓名或密码错误' }); return;
      }
      // 旧 sha256 哈希登录成功 → 透明升级为 scrypt
      if (isLegacyHash(staff.passwordHash)) {
        staff.passwordHash = hashPassword(body.password);
        saveData();
      }
      clearLoginFail(ip);
      sendJSON(res, 200, { token: issueToken('staff', staff.id, staff.name), staffId: staff.id, staffName: staff.name });
      return;
    }
    sendJSON(res, 400, { error: 'role 必须为 staff 或 manager' });
    return;
  }

  // 以下接口都需要 token
  const user = auth(req);
  if (!user) { sendJSON(res, 401, { error: '未登录或登录已过期' }); return; }

  // ---------- 员工修改自己的密码 ----------
  if (p === '/api/change-password' && m === 'POST') {
    if (user.role !== 'staff') { sendJSON(res, 403, { error: '仅员工可操作' }); return; }
    const body = await readBody(req);
    const oldPwd = body.oldPassword || '';
    const newPwd = (body.newPassword || '').trim();
    if (!isStrongPassword(newPwd)) { sendJSON(res, 400, { error: PWD_RULE_MSG }); return; }
    const staff = DB.staffs.find((s) => s.id === user.id);
    if (!staff) { sendJSON(res, 404, { error: '账号不存在' }); return; }
    if (!checkPassword(oldPwd, staff.passwordHash)) {
      sendJSON(res, 401, { error: '原密码错误' }); return;
    }
    staff.passwordHash = hashPassword(newPwd);
    saveData();
    sendJSON(res, 200, { ok: true });
    return;
  }

  // ---------- 管理员修改管理密码 ----------
  if (p === '/api/admin/change-password' && m === 'POST') {
    if (user.role !== 'manager') { sendJSON(res, 403, { error: '仅管理员可操作' }); return; }
    const body = await readBody(req);
    const oldPwd = body.oldPassword || '';
    const newPwd = (body.newPassword || '').trim();
    if (oldPwd !== CONFIG.adminPassword) {
      sendJSON(res, 401, { error: '原密码错误' }); return;
    }
    if (!isStrongPassword(newPwd)) { sendJSON(res, 400, { error: PWD_RULE_MSG }); return; }
    CONFIG.adminPassword = newPwd;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2));
    sendJSON(res, 200, { ok: true });
    return;
  }

  // ---------- 员工花名册(管理员) ----------
  if (p === '/api/staffs' && m === 'GET') {
    if (user.role !== 'manager') { sendJSON(res, 403, { error: '仅管理员可操作' }); return; }
    sendJSON(res, 200, DB.staffs.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt })));
    return;
  }
  if (p === '/api/staffs' && m === 'POST') {
    if (user.role !== 'manager') { sendJSON(res, 403, { error: '仅管理员可操作' }); return; }
    const body = await readBody(req);
    const name = (body.name || '').trim();
    const password = (body.password || '').trim();
    if (!name || !password) { sendJSON(res, 400, { error: '姓名和密码必填' }); return; }
    if (!isStrongPassword(password)) { sendJSON(res, 400, { error: PWD_RULE_MSG }); return; }
    let staff = DB.staffs.find((s) => s.name === name);
    if (staff) {
      staff.passwordHash = hashPassword(password);   // 重置密码
      saveData();
      sendJSON(res, 200, { ok: true, id: staff.id, updated: true });
    } else {
      staff = { id: 'S' + Date.now().toString(36).toUpperCase(), name, passwordHash: hashPassword(password), createdAt: nowIso() };
      DB.staffs.push(staff);
      saveData();
      sendJSON(res, 200, { ok: true, id: staff.id, created: true });
    }
    return;
  }
  if (p === '/api/staffs' && m === 'DELETE') {
    if (user.role !== 'manager') { sendJSON(res, 403, { error: '仅管理员可操作' }); return; }
    const id = url.searchParams.get('id');
    DB.staffs = DB.staffs.filter((s) => s.id !== id);
    saveData();
    sendJSON(res, 200, { ok: true });
    return;
  }

  // ---------- 客户数据 ----------
  // 员工上传自己的记录(按 id 合并;强制 staffId=登录人;禁止碰他人档案)
  if (p === '/api/clients/sync' && m === 'POST') {
    if (user.role !== 'staff') { sendJSON(res, 403, { error: '仅员工可上传' }); return; }
    const body = await readBody(req);
    const records = Array.isArray(body.records) ? body.records : [];
    let merged = 0, rejected = 0;
    records.forEach((r) => {
      if (!r || !r.id) { rejected++; return; }
      const idx = DB.clients.findIndex((c) => c.id === r.id);
      if (idx >= 0) {
        // 越权防护: 已存在的档案若不是本人的,拒绝合并(防伪造 id 篡改/抢夺他人客户)
        if (DB.clients[idx].staffId !== user.id) { rejected++; return; }
        r.updateTime = nowIso();
        // 敏感归属字段以服务器存量为准,不允许客户端改写
        delete r.staffId;
        delete r.staffName;
        delete r.createTime;
        DB.clients[idx] = Object.assign({}, DB.clients[idx], r);
      } else {
        r.staffId = user.id;
        r.staffName = user.name;
        r.createTime = r.createTime || nowIso();
        r.updateTime = nowIso();
        DB.clients.push(r);
      }
      merged++;
    });
    // 同步删除列表(也只能删自己的)
    const deleted = Array.isArray(body.deleted) ? body.deleted : [];
    if (deleted.length) {
      DB.clients = DB.clients.filter((c) => !(deleted.indexOf(c.id) >= 0 && c.staffId === user.id));
    }
    saveData();
    sendJSON(res, 200, { ok: true, merged, rejected });
    return;
  }
  // 员工拉取自己的记录
  if (p === '/api/clients' && m === 'GET') {
    if (user.role !== 'staff') { sendJSON(res, 403, { error: '仅员工可拉取' }); return; }
    sendJSON(res, 200, DB.clients.filter((c) => c.staffId === user.id));
    return;
  }
  // 管理员拉全量
  if (p === '/api/clients/all' && m === 'GET') {
    if (user.role !== 'manager') { sendJSON(res, 403, { error: '仅管理员可查看' }); return; }
    sendJSON(res, 200, DB.clients);
    return;
  }
  // 删除记录(员工只能删自己的;管理员任意)
  if (p === '/api/clients' && m === 'DELETE') {
    const id = url.searchParams.get('id');
    const before = DB.clients.length;
    DB.clients = DB.clients.filter((c) => {
      if (c.id !== id) return true;
      return !(user.role === 'manager' || c.staffId === user.id);
    });
    saveData();
    sendJSON(res, 200, { ok: true, deleted: before - DB.clients.length });
    return;
  }

  // ---------- 管理员数据管理 ----------
  if (p === '/api/admin/clear-demo' && m === 'POST') {
    if (user.role !== 'manager') { sendJSON(res, 403, { error: '仅管理员可操作' }); return; }
    const before = DB.clients.length;
    DB.clients = DB.clients.filter((c) => !String(c.id).startsWith('demo_'));
    saveData();
    sendJSON(res, 200, { ok: true, removed: before - DB.clients.length });
    return;
  }
  if (p === '/api/admin/reset-all' && m === 'POST') {
    if (user.role !== 'manager') { sendJSON(res, 403, { error: '仅管理员可操作' }); return; }
    DB.clients = [];
    saveData();
    sendJSON(res, 200, { ok: true });
    return;
  }

  // ---------- 小程序码 ----------
  if (p === '/api/qrcode' && m === 'GET') {
    if (user.role !== 'manager') { sendJSON(res, 403, { error: '仅管理员可操作' }); return; }
    const sid = url.searchParams.get('staffId') || '';
    const sname = url.searchParams.get('staffName') || '';
    const scene = 'role=staff&sid=' + encodeURIComponent(sid) + '&sname=' + encodeURIComponent(sname);
    try {
      const token = await getWxAccessToken();
      const png = await fetchWxacode(token, scene, 'pages/index/index');
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(png);
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  sendJSON(res, 404, { error: 'not found: ' + p });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const ips = [];
  Object.keys(nets).forEach((name) => {
    nets[name].forEach((n) => {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    });
  });
  // 优先推荐常见真实局域网段,虚拟网卡(VMware/VirtualBox/WSL 常见 172.x/192.168.56.x)排后
  ips.sort((a, b) => {
    const score = (ip) => /^192\.168\.(?!56\.)/.test(ip) ? 0 : /^10\./.test(ip) ? 1 : 2;
    return score(a) - score(b);
  });
  const lanIp = ips[0] || '127.0.0.1';
  console.log('');
  console.log('  客户档案管家 · 后端服务已启动');
  console.log('  ────────────────────────────────────');
  console.log('  本机访问:   http://127.0.0.1:' + PORT);
  console.log('  局域网访问: http://' + lanIp + ':' + PORT + '   <- 手机小程序填这个');
  if (ips.length > 1) {
    console.log('  其他网卡:   ' + ips.slice(1).map((ip) => 'http://' + ip + ':' + PORT).join('  '));
  }
  console.log('  健康检查:   http://' + lanIp + ':' + PORT + '/api/health');
  console.log('  管理密码:   ' + CONFIG.adminPassword + '  (在 server/config.json 修改)');
  console.log('  ────────────────────────────────────');
  console.log('');
});
