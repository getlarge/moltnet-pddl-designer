import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../../apps/server/src/api.js';
import { RunStore } from '@pddl/persistence/store';
import {
  MemoryRuns,
  syntheticExecute,
  syntheticInput,
} from '../support/test-support.js';
import type { DesignRun } from '@pddl/contracts/design';
import type { RunSnapshot } from '@pddl/contracts/api';

describe('local wizard API', () => {
  let server: FastifyInstance;
  let directory: string;
  let base: string;
  let store: RunStore;
  let runs: MemoryRuns;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'galley-test-'));
    store = new RunStore(directory);
    runs = new MemoryRuns();
    server = createApi({
      root: resolve('.'),
      store,
      runs,
    });
    await server.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(server.server.address() as { port: number }).port}/api/`;
  });
  afterEach(async () => {
    await server.close();
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
  it.each([true, false])(
    'stops SSE reads once terminal (terminal on connect: %s)',
    async (terminalOnConnect) => {
      const started = await runs.start(syntheticInput, {});
      await awaiting(started.id);
      if (terminalOnConnect) await runs.withdraw(started.id, 'finish fixture');
      const get = vi.spyOn(runs, 'get');
      const controller = new AbortController();
      try {
        const response = await fetch(base + `runs/${started.id}/events`, {
          signal: controller.signal,
        });
        const reader = response.body!.getReader();
        if (!terminalOnConnect)
          await runs.withdraw(started.id, 'finish fixture');
        let received = '';
        while (
          !received.includes('"state":"failed"') &&
          !received.includes('"state":"finished"')
        ) {
          const chunk = await reader.read();
          expect(chunk.done).toBe(false);
          received += new TextDecoder().decode(chunk.value);
        }
        const reads = get.mock.calls.length;
        await delay(650);
        expect(get).toHaveBeenCalledTimes(reads);
      } finally {
        controller.abort();
        get.mockRestore();
      }
    },
  );
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
    // Inject the oversized body so early socket rejection cannot race the
    // client's upload; Host/Origin checks above use real HTTP connections.
    const oversized = await server.inject({
      method: 'POST',
      url: '/api/saved',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      payload: JSON.stringify({ padding: 'x'.repeat(5 * 1024 * 1024) }),
    });
    expect(oversized.statusCode).toBe(413);
    expect(await oversized.json()).toEqual({
      error: 'Request body is too large',
    });
  });
  it('rediscovers an abandoned gate and releases the one-run lock after withdrawal', async () => {
    const { correlationId: _, ...input } = syntheticInput;
    const started = (await (
      await post('runs', { input })
    ).json()) as RunSnapshot;
    const gate = (await awaiting(started.id)).gate!;
    expect((await post('runs', { input })).status).toBe(409);
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
    run.input.classificationProfileId = 'previous-classifier';
    const savedId = await store.save(run);
    const { correlationId: _, ...input } = syntheticInput;
    const started = (await (
      await post('runs', {
        input: { ...input, classificationProfileId: 'current-classifier' },
        savedId,
        stage: 'refine',
        feedback: 'Review the changes.',
      })
    ).json()) as RunSnapshot;
    const snapshot = await awaiting(started.id);
    expect(snapshot.gate?.stage).toBe('refine');
    expect(snapshot.input.correlationId).not.toBe(run.input.correlationId);
    expect(snapshot.input.classificationProfileId).toBe('current-classifier');
    expect(
      snapshot.events.filter((e) => e.event.type === 'task-created'),
    ).toHaveLength(1);
  });
  it('previews locally, classifies before passing Actions, and invalidates checks after edits', async () => {
    const { correlationId: _, ...input } = syntheticInput;
    const started = (await (
      await post('runs', { input })
    ).json()) as RunSnapshot;
    let snapshot = await awaiting(started.id);
    for (let n = 0; n < 2; n++) {
      await post(`runs/${started.id}/decisions`, {
        gateId: snapshot.gate!.id,
        decision: { action: 'accept' },
      });
      snapshot = await awaiting(started.id);
    }
    expect(snapshot.gate!.stage).toBe('actions');
    const gateId = snapshot.gate!.id;
    const targets = [
      {
        action: 'pick-up',
        field: 'preconditions',
        atom: { predicate: 'clear', args: ['?b'] },
        negated: false,
      },
    ];
    const preview = (await (
      await post(`runs/${started.id}/source-check`, {
        gateId,
        targets,
        preview: true,
      })
    ).json()) as { input: import('@themoltnet/sdk').ClassifyInput };
    expect(preview.input.state.source).toBe(input.description);
    expect(preview.input.state.situation).toBe(input.problemDescription);
    expect(Object.keys(preview.input.questions)).toHaveLength(1);
    expect(
      ((await (await fetch(base + `runs/${started.id}`)).json()) as RunSnapshot)
        .sourceCheck,
    ).toBeUndefined();
    const checked = (await (
      await post(`runs/${started.id}/source-check`, {
        gateId,
        targets,
        profile: 'synthetic',
      })
    ).json()) as RunSnapshot;
    expect(checked.sourceCheck?.status).toBe('complete');
    expect(checked.sourceCheck?.output?.answers.claim_1).toMatchObject({
      choice: 'supported',
    });
    expect(checked.gate!.id).toBe(gateId);
    await post(`runs/${started.id}/decisions`, {
      gateId,
      decision: { action: 'edit', result: snapshot.gate!.result },
    });
    snapshot = await awaiting(started.id);
    expect(snapshot.sourceCheck).toBeUndefined();
    expect(snapshot.gate!.id).not.toBe(gateId);
    expect(
      (
        await post(`runs/${started.id}/source-check`, {
          gateId,
          targets,
          preview: true,
        })
      ).status,
    ).toBe(409);
    await post(`runs/${started.id}/decisions`, {
      gateId: snapshot.gate!.id,
      decision: { action: 'abort', reason: 'Test complete.' },
    });
  });
});
