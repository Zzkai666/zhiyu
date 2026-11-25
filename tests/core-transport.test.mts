import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { requestLoopback } = require('../desktop/core-transport.cjs');

test('the desktop can read the core on a Fetch-restricted loopback port', async () => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture');
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify([{id:'fixture-paper'}]));
  });
  try {
    let port = 0;
    for (const candidate of [6000, 6667, 10080]) {
      const bound = await new Promise<boolean>((resolve, reject) => {
        const failed = error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error);
        server.once('error', failed);
        server.listen(candidate, '127.0.0.1', () => {
          server.removeListener('error', failed);
          resolve(true);
        });
      });
      if (bound) { port = candidate; break; }
    }
    assert.ok(port, 'test needs one available Fetch-restricted port');
    const url = new URL('http://127.0.0.1:' + port + '/papers');
    await assert.rejects(fetch(url), error => error.cause?.message === 'bad port');
    const response = await requestLoopback(url, {headers:{Authorization:'Bearer fixture'}});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{id:'fixture-paper'}]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('core transport preserves streamed request bodies, ranges and empty responses', async () => {
  const server = createServer(async (req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, {'Content-Length':'8'}).end();
      return;
    }
    if (req.url === '/empty') {res.writeHead(204).end();return;}
    const input = [];
    for await (const part of req) input.push(part);
    assert.equal(req.headers.range, 'bytes=0-7');
    res.writeHead(206, {'Content-Range':'bytes 0-7/32'});
    res.write(Buffer.concat(input).subarray(0, 4));
    res.end(Buffer.concat(input).subarray(4));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(typeof address === 'object' && address);
    const url = new URL('http://127.0.0.1:'+address.port+'/pdf');
    for (const body of [
      Readable.from([Buffer.from('abc'), Buffer.from('defgh')]),
      Readable.toWeb(Readable.from([Buffer.from('abc'), Buffer.from('defgh')])),
    ]) {
      const response = await requestLoopback(url, {method:'POST',body,headers:{Range:'bytes=0-7'}});
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('content-range'), 'bytes 0-7/32');
      assert.equal(response.headers.get('transfer-encoding'), null);
      assert.equal(await response.text(), 'abcdefgh');
    }
    const head = await requestLoopback(url, {method:'HEAD'});
    assert.equal(head.headers.get('content-length'), '8');
    assert.equal(head.body, null);
    const empty = await requestLoopback(new URL('/empty', url));
    assert.equal(empty.status, 204);
    assert.equal(empty.body, null);
    await assert.rejects(requestLoopback(new URL('http://192.0.2.1:8123/papers')), /本地服务地址无效/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
