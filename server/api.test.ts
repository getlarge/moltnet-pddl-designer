import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api.js';
import { RunStore } from './store.js';
import { syntheticExecute, syntheticInput } from './test-support.js';
import type { DesignRun } from '../src/workflow.js';
import type { RunSnapshot } from './types.js';

describe('local wizard API', () => {
  let server: Server;
  let directory: string;
  let base: string;
  let store: RunStore;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'galley-test-'));
    store = new RunStore(directory);
    const api = createApi({
      root: resolve('.'),
      store,
      execute: syntheticExecute,
    });
    server = createServer((req, res) => {
      void api(req, res).then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const post = (
    path: string,
    data: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
  async function awaiting(id: string): Promise<RunSnapshot> {
    let snapshot: RunSnapshot;
    for (;;) {
      snapshot = (await (
        await fetch(base + `runs/${id}`)
      ).json()) as RunSnapshot;
      if (
        snapshot.state === 'awaiting' ||
        snapshot.state === 'finished' ||
        snapshot.state === 'failed'
      )
        return snapshot;
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  it('rejects cross-origin writes and non-JSON requests', async () => {
    expect(
      (await post('runs', {}, { Origin: 'https://elsewhere.example' })).status,
    ).toBe(403);
    expect(
      (await fetch(base + 'runs', { method: 'POST', body: '{}' })).status,
    ).toBe(415);
  });
  it('rejects hostile hosts, cross-site requests and oversized writes', async () => {
    const hostileHostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const request = httpRequest(
          base + 'runs',
          { headers: { Host: 'attacker.example' } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        request.on('error', reject);
        request.end();
      },
    );
    expect(hostileHostStatus).toBe(403);
    expect(
      (
        await fetch(base + 'runs', {
          headers: { 'Sec-Fetch-Site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
    const oversized = await post('saved', {
      padding: 'x'.repeat(5 * 1024 * 1024),
    });
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({
      error: 'The request exceeds 5 MB.',
    });
  });
  it('rediscovers an abandoned gate and releases the one-run lock after withdrawal', async () => {
    const { correlationId: _, ...input } = syntheticInput;
    const started = (await (
      await post('runs', { input })
    ).json()) as RunSnapshot;
    const gate = (await awaiting(started.id)).gate!;
    expect((await post('runs', { input })).status).toBe(400);
    const active = (await (await fetch(base + 'runs')).json()) as RunSnapshot[];
    expect(active.map((s) => s.id)).toEqual([started.id]);
    expect(active[0].gate?.id).toBe(gate.id);
    await post(`runs/${started.id}/decisions`, {
      gateId: gate.id,
      decision: { action: 'abort', reason: 'Recovered abandoned gate.' },
    });
    await awaiting(started.id);
    expect(await (await fetch(base + 'runs')).json()).toEqual([]);
    expect((await post('runs', { input })).status).toBe(201);
  });
  it('rejects correction requests that skip unapproved saved edits', async () => {
    const run = await syntheticExecute(syntheticInput, {});
    run.needsReview = ['types', 'predicates', 'actions', 'refine', 'problem'];
    const savedId = await store.save(run);
    const { correlationId: _, ...input } = syntheticInput;
    const response = await post('runs', {
      input,
      savedId,
      stage: 'refine',
      feedback: 'Review this.',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        'Pass the saved types stage before requesting a correction to refine.',
    });
    expect(await (await fetch(base + 'runs')).json()).toEqual([]);
  });
  it('streams snapshots, enforces gates once, retains rejected edits, and saves finished runs', async () => {
    const { correlationId: _, ...input } = syntheticInput;
    const started = (await (
      await post('runs', { input })
    ).json()) as RunSnapshot;
    let snapshot = await awaiting(started.id);
    const controller = new AbortController();
    const events = await fetch(base + `runs/${started.id}/events`, {
      signal: controller.signal,
    });
    const reader = events.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain(snapshot.gate!.id);
    expect(first).toContain('id:');
    controller.abort();
    await reader.cancel().catch(() => {});
    const gate = snapshot.gate!;
    expect(
      (
        await post(`runs/${started.id}/decisions`, {
          gateId: gate.id,
          decision: { action: 'edit', result: { types: 'invalid' } },
        })
      ).status,
    ).toBe(200);
    snapshot = await awaiting(started.id);
    expect(snapshot.gate!.issues[0].severity).toBe('error');
    expect(snapshot.gate!.result).toEqual({ types: 'invalid' });
    expect(
      (
        await post(`runs/${started.id}/decisions`, {
          gateId: snapshot.gate!.id,
          decision: { action: 'accept' },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post(`runs/${started.id}/decisions`, {
          gateId: gate.id,
          decision: { action: 'accept' },
        })
      ).status,
    ).toBe(409);
    await post(`runs/${started.id}/decisions`, {
      gateId: snapshot.gate!.id,
      decision: { action: 'feedback', message: 'Return valid types.' },
    });
    for (let n = 0; n < 5; n++) {
      snapshot = await awaiting(started.id);
      expect(snapshot.gate).toBeDefined();
      await post(`runs/${started.id}/decisions`, {
        gateId: snapshot.gate!.id,
        decision: { action: 'accept' },
      });
    }
    snapshot = await awaiting(started.id);
    expect(snapshot.run?.plan?.status).toBe('found');
    const saved = (await (
      await post(`runs/${started.id}/save`, {})
    ).json()) as { id: string };
    expect((await store.get(saved.id)).plan?.status).toBe('found');
    expect(await (await fetch(base + 'saved')).json()).toHaveLength(1);
  });
  it('opens and revises saved runs without an agent connection and rejects traversal', async () => {
    const run = await syntheticExecute(syntheticInput, {});
    const id = await store.save(run);
    const edited = (await (
      await post(`saved/${id}/edit`, {
        stage: 'types',
        result: { types: 'rejected' },
      })
    ).json()) as { id: string; run: DesignRun };
    expect(edited.id).not.toBe(id);
    expect(edited.run.plan).toBeUndefined();
    expect((await store.get(id)).plan?.status).toBe('found');
    await expect(store.get('../outside')).rejects.toThrow('identifier');
    expect((await post('saved', { version: 99 })).status).toBe(400);
  });
  it('continues saved feedback with fresh task correlation and retains preceding evidence', async () => {
    const run = await syntheticExecute(syntheticInput, {});
    const savedId = await store.save(run);
    const { correlationId: _, ...input } = syntheticInput;
    const started = (await (
      await post('runs', {
        input,
        savedId,
        stage: 'refine',
        feedback: 'Review the changes.',
      })
    ).json()) as RunSnapshot;
    const snapshot = await awaiting(started.id);
    expect(snapshot.gate?.stage).toBe('refine');
    expect(snapshot.input.correlationId).not.toBe(run.input.correlationId);
    expect(
      snapshot.events.filter((e) => e.event.type === 'task-created'),
    ).toHaveLength(1);
  });
  it('requires a classification profile and records opt-in assessment after the action gate', async () => {
    const { correlationId: _, ...input } = syntheticInput;
    expect(
      (await post('runs', { input, warningReview: { profileId: ' ' } })).status,
    ).toBe(400);
    const started = (await (
      await post('runs', {
        input,
        warningReview: { profileId: 'test-classifier' },
      })
    ).json()) as RunSnapshot;
    let snapshot = await awaiting(started.id);
    expect(snapshot.warningReview?.profileId).toBe('test-classifier');
    for (let n = 0; n < 5; n++) {
      expect(snapshot.gate).toBeDefined();
      if (snapshot.gate!.stage === 'actions')
        expect(
          snapshot.events.some(
            ({ event }) => event.type === 'warning-review-result',
          ),
        ).toBe(false);
      await post(`runs/${started.id}/decisions`, {
        gateId: snapshot.gate!.id,
        decision: { action: 'accept' },
      });
      snapshot = await awaiting(started.id);
    }
    const decisions = snapshot.run?.warningReviews?.flatMap((r) => r.decisions);
    expect(decisions?.length).toBeGreaterThan(0);
    expect(decisions?.[0].probability).toBe(0.04);
    expect(
      snapshot.events.some(
        ({ event }) => event.type === 'warning-review-result',
      ),
    ).toBe(true);
    const saved = (await (
      await post(`runs/${started.id}/save`, {})
    ).json()) as { id: string };
    expect((await store.get(saved.id)).warningReviews).toEqual(
      snapshot.run?.warningReviews,
    );
  });
});
