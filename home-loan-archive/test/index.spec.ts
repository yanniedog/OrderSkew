import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('home-loan-archive worker', () => {
	it('returns 404 for unknown path (unit style)', async () => {
		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});

	it('returns 404 for unknown path (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/');
		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});

	it('returns JSON with ok and version for /api/debug/version', async () => {
		const response = await SELF.fetch('https://example.com/api/debug/version');
		expect(response.status).toBe(200);
		const data = (await response.json()) as { ok: boolean; version?: string; hasBindings?: object };
		expect(data.ok).toBe(true);
		expect(typeof data.version).toBe('string');
		expect(data.hasBindings).toBeDefined();
	});
});
