import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from '@playwright/test';
import { createServer, type ProxyOptions } from 'vite';
import config from '../vite.config';

test('emergency clear reaches the backend through the actual Vite proxy', async () => {
  const requests: string[] = [];
  const backend = createHttpServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ emergency_active: false }));
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  // Use the production development proxy table, replacing only its backend.
  // Browser route mocks would hide a missing proxy entry.
  const proxy = Object.fromEntries(Object.entries(config.server!.proxy!).map(([prefix, options]) => [
    prefix, { ...(options as ProxyOptions), target }
  ]));
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    vite = await createServer({
      configFile: false,
      server: { host: '127.0.0.1', port: 0, hmr: false, proxy }
    });
    await vite.listen();
    const port = (vite.httpServer!.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/emergency/clear`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ emergency_active: false });
    expect(requests).toEqual(['POST /emergency/clear']);
  } finally {
    await vite?.close();
    await new Promise<void>((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()));
  }
});
