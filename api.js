// utils/api.js — 云函数请求封装(自动带 token)
// 已迁移至微信云开发: 所有请求走 wx.cloud.callFunction → cloudfunctions/api
// 页面调用方式不变: api.get('/api/clients') / api.post(...) / api.del('/api/clients?id=xx')
const config = require('./config.js');

function getToken() {
  try { return wx.getStorageSync('cm_token') || ''; } catch (e) { return ''; }
}
function setToken(t) {
  try { wx.setStorageSync('cm_token', t || ''); } catch (e) {}
}

// 把 '/api/clients?id=xx' 拆成 path + query 对象
function splitPath(fullPath) {
  const qIndex = fullPath.indexOf('?');
  if (qIndex < 0) return { path: fullPath, query: {} };
  const path = fullPath.slice(0, qIndex);
  const query = {};
  fullPath.slice(qIndex + 1).split('&').forEach(function (kv) {
    const eq = kv.indexOf('=');
    if (eq > 0) query[decodeURIComponent(kv.slice(0, eq))] = decodeURIComponent(kv.slice(eq + 1));
  });
  return { path, query };
}

// 返回 Promise;失败时 reject(Error(msg))
function request(method, fullPath, data) {
  const p = splitPath(fullPath);
  return wx.cloud.callFunction({
    name: config.CLOUD_FUNCTION_NAME,
    data: {
      path: p.path,
      method: method,
      query: p.query,
      body: data || {},
      token: getToken()
    }
  }).then(function (res) {
    const r = res.result || {};
    if (r.statusCode >= 200 && r.statusCode < 300) {
      return r.body;
    }
    throw new Error((r.body && r.body.error) || ('请求失败(' + r.statusCode + ')'));
  }).catch(function (e) {
    // 云调用本身的网络/环境错误
    if (e && e.errMsg && e.errMsg.indexOf('cloud.callFunction') >= 0) {
      throw new Error('云服务调用失败,请检查网络或云环境配置');
    }
    throw e;
  });
}

module.exports = {
  get: (path) => request('GET', path),
  post: (path, data) => request('POST', path, data),
  del: (path) => request('DELETE', path),
  getToken, setToken
};
