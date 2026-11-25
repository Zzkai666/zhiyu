const { request } = require('node:http');
const { Readable, pipeline } = require('node:stream');

const hopHeaders = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'proxy-authenticate', 'proxy-authorization',
]);

function requestLoopback(url, { method = 'GET', headers, body, signal } = {}) {
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) {
    return Promise.reject(new Error('本地服务地址无效'));
  }
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers: Object.fromEntries(new Headers(headers)), signal }, upstream => {
      const status = upstream.statusCode;
      if (status < 200 || status > 599) {
        upstream.destroy();
        reject(new Error('本地服务返回了无效响应'));
        return;
      }
      const responseHeaders = new Headers();
      for (let i = 0; i < upstream.rawHeaders.length; i += 2) {
        const name = upstream.rawHeaders[i];
        if (!hopHeaders.has(name.toLowerCase())) responseHeaders.append(name, upstream.rawHeaders[i + 1]);
      }
      const withoutBody = method === 'HEAD' || status === 204 || status === 205 || status === 304;
      if (withoutBody) upstream.resume();
      resolve(new Response(withoutBody ? null : Readable.toWeb(upstream), { status, headers: responseHeaders }));
    });
    req.on('error', reject);
    if (body == null || typeof body === 'string' || ArrayBuffer.isView(body)) {
      req.end(body);
    } else {
      const input = typeof body.getReader === 'function' ? Readable.fromWeb(body) : body;
      pipeline(input, req, error => { if (error) reject(error); });
    }
  });
}

module.exports = { requestLoopback };
