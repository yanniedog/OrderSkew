const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const root = path.resolve(__dirname, '..');

async function checkDeployment(t, toolStillHosted, apiStillHosted = false) {
    const server = http.createServer((request, response) => {
        const route = new URL(request.url, 'http://localhost').pathname;
        if (route === '/api/domains/availability' && request.method === 'POST' && apiStillHosted) {
            response.end('{"available":true}');
            return;
        }
        if (route === '/tools/' && toolStillHosted) {
            response.end('<!doctype html><h1>Old tools hub</h1>');
            return;
        }
        const local = route === '/' ? 'index.html' : route.slice(1);
        if (route === '/' || route.startsWith('/calculator-assets/')) {
            response.setHeader('Content-Type', local.endsWith('.css') ? 'text/css' : local.endsWith('.js') ? 'text/javascript' : 'text/html');
            response.end(fs.readFileSync(path.join(root, local)));
        } else {
            response.writeHead(404, { 'Content-Type': 'text/html' });
            response.end(fs.readFileSync(path.join(root, '404.html')));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return new Promise(resolve => execFile(process.execPath, ['test-production-all.js', origin], { cwd: root },
        (error, stdout, stderr) => resolve({ error, stdout, stderr })));
}

test('production suite verifies calculator assets and retired tool routes', async t => {
    const result = await checkDeployment(t, false);
    assert.equal(result.error, null, result.stderr);
    assert.match(result.stdout, /No checks skipped/);
});

test('production suite rejects a former tools hub still being served', async t => {
    const result = await checkDeployment(t, true);
    assert.equal(result.error.code, 1);
    assert.match(result.stderr, /tools\/: expected retired route 404\/410, got 200/);
});

test('production suite rejects a POST-only tool API still being served', async t => {
    const result = await checkDeployment(t, false, true);
    assert.equal(result.error.code, 1);
    assert.match(result.stderr, /domains\/availability POST: expected retired API 404\/410, got 200/);
});

test('the retired API catch-all returns 410 for every method without invoking a backend', async () => {
    const source = fs.readFileSync(path.join(root, 'functions/api/[[path]].js'), 'utf8');
    const handler = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const response = handler.onRequest({ request: new Request('https://orderskew.com/api/health', { method }) });
        assert.equal(response.status, 410);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.match(await response.text(), /removed from OrderSkew/);
    }
});
