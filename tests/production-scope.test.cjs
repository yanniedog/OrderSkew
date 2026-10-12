const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const root = path.resolve(__dirname, '..');

async function checkDeployment(t, toolStillHosted) {
    const server = http.createServer((request, response) => {
        const route = new URL(request.url, 'http://localhost').pathname;
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
