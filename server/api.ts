import { AtomSchema } from '../src/ir.js';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { editRun, passSavedStage, readRun, STAGES } from '../src/saved-run.js';
import type { DesignInput, StageName } from '../src/stages.js';
import type { StageDecision } from '../src/workflow.js';
import { RunStore } from './store.js';
import {
  offlineRuns,
  RunConflict,
  type RunService,
  type RunOptions,
} from './run-service.js';

const inputSchema = Type.Object(
  {
    description: Type.String({ minLength: 1, maxLength: 100000 }),
    problemDescription: Type.String({ minLength: 1, maxLength: 100000 }),
    domainName: Type.String({ pattern: '^[a-z][a-z0-9-]{0,39}$' }),
    problemName: Type.String({ pattern: '^[a-z][a-z0-9-]{0,39}$' }),
    teamId: Type.String({ minLength: 1 }),
    diaryId: Type.String({ minLength: 1 }),
    profileId: Type.String({ minLength: 1 }),
    stageProfiles: Type.Optional(
      Type.Object(
        Object.fromEntries(
          STAGES.map((stage) => [
            stage,
            Type.Optional(Type.String({ minLength: 1 })),
          ]),
        ),
        { additionalProperties: false },
      ),
    ),
    projectId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
const startSchema = Type.Object(
  {
    input: inputSchema,
    savedId: Type.Optional(Type.String()),
    stage: Type.Optional(Type.Union(STAGES.map((s) => Type.Literal(s)))),
    feedback: Type.Optional(Type.String({ minLength: 1, maxLength: 10000 })),
    claimTimeoutSec: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
  },
  { additionalProperties: false },
);
const sourceCheckSchema = Type.Object(
  {
    gateId: Type.String(),
    targets: Type.Array(
      Type.Object(
        {
          action: Type.String(),
          field: Type.Union(
            ['preconditions', 'addEffects', 'deleteEffects'].map((s) =>
              Type.Literal(s),
            ),
          ),
          atom: AtomSchema,
          negated: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 20 },
    ),
    profile: Type.Optional(Type.String({ minLength: 1 })),
    preview: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const decisionSchema = Type.Union([
  Type.Object(
    { action: Type.Literal('accept') },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('edit'), result: Type.Unknown() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('feedback'),
      message: Type.String({ minLength: 1, maxLength: 10000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('abort'),
      reason: Type.String({ minLength: 1, maxLength: 10000 }),
    },
    { additionalProperties: false },
  ),
]);

export interface ApiOptions {
  root: string;
  store: RunStore;
  runs?: RunService;
  defaults?: Partial<DesignInput>;
}
type RunParams = { Params: { id: string } };

/** Fastify owns routing, bounded JSON parsing, errors, and connection lifecycle. */
export function createApi(options: ApiOptions) {
  const app = Fastify({
    bodyLimit: 5 * 1024 * 1024,
    forceCloseConnections: true,
  });
  const runs = options.runs ?? offlineRuns;
  const streams = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const close of streams) close();
  });
  app.setErrorHandler((error, _request, reply) => {
    const failure = error as Error & { statusCode?: number };
    reply
      .code(error instanceof RunConflict ? 409 : (failure.statusCode ?? 400))
      .send({ error: failure.message });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'Endpoint not found.' }),
  );
  app.register(
    async (api) => {
      api.addHook('onRequest', async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const host = request.headers.host ?? '';
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
          return reply
            .code(403)
            .send({ error: 'Use the local server address.' });
        if (
          request.headers.origin &&
          request.headers.origin !== `http://${host}`
        )
          return reply
            .code(403)
            .send({ error: 'Requests must come from this local app.' });
        if (request.headers['sec-fetch-site'] === 'cross-site')
          return reply
            .code(403)
            .send({ error: 'Cross-site requests are not allowed.' });
        if (
          request.method !== 'GET' &&
          request.headers['content-type']
            ?.split(';')[0]
            .trim()
            .toLowerCase() !== 'application/json'
        )
          return reply.code(415).send({ error: 'Send application/json.' });
      });
      api.get('/config', async () => ({
        defaults: options.defaults ?? {},
        runsDirectory: options.store.directory,
      }));
      api.get('/examples', async () => {
        const examples = [];
        for (const name of await readdir(join(options.root, 'examples'))) {
          try {
            examples.push({
              name,
              description: await readFile(
                join(options.root, 'examples', name, 'description.md'),
                'utf8',
              ),
              problemDescription: await readFile(
                join(options.root, 'examples', name, 'situation.md'),
                'utf8',
              ),
            });
          } catch {
            /* Not all example directories contain both inputs. */
          }
        }
        return examples;
      });
      api.get('/saved', async () => options.store.list());
      api.get<RunParams>('/saved/:id', async (request) =>
        options.store.get(request.params.id),
      );
      api.post('/saved', async (request, reply) => {
        const run = readRun(request.body);
        return reply.code(201).send({ id: await options.store.save(run), run });
      });
      for (const action of ['edit', 'pass'] as const) {
        api.post<RunParams>(`/saved/:id/${action}`, async (request, reply) => {
          const data = request.body as { stage: StageName; result?: unknown };
          if (!data || !STAGES.includes(data.stage))
            throw new Error('Choose a valid stage.');
          const previous = await options.store.get(request.params.id);
          const run =
            action === 'edit'
              ? editRun(previous, data.stage, data.result)
              : passSavedStage(previous, data.stage);
          return reply
            .code(201)
            .send({ id: await options.store.save(run), run });
        });
      }
      api.get('/runs', async () => runs.list());
      api.post('/runs', async (request, reply) => {
        const data = request.body;
        if (!Value.Check(startSchema, data))
          throw new Error(
            'Provide the description, situation, model names, team, diary and runtime profile.',
          );
        if (
          [
            data.input.description,
            data.input.problemDescription,
            data.input.teamId,
            data.input.diaryId,
            data.input.profileId,
          ].some((s) => !s.trim())
        )
          throw new Error('Required fields cannot be blank.');
        if (data.savedId && (!data.stage || !data.feedback?.trim()))
          throw new Error('Choose a saved stage and write a correction note.');
        const input = {
          ...data.input,
          correlationId: randomUUID(),
        } as DesignInput;
        const runOptions: RunOptions = {
          claimTimeoutSec: data.claimTimeoutSec ?? 600,
        };
        if (data.savedId) {
          const saved = await options.store.get(data.savedId);
          const pending = saved.needsReview?.find(
            (stage) => STAGES.indexOf(stage) < STAGES.indexOf(data.stage!),
          );
          if (pending)
            throw new Error(
              `Pass the saved ${pending} stage before requesting a correction to ${data.stage}.`,
            );
          Object.assign(input, saved.input, { correlationId: randomUUID() });
          runOptions.resume = {
            run: saved,
            stage: data.stage!,
            feedback: data.feedback!,
          };
        }
        return reply.code(201).send(await runs.start(input, runOptions));
      });
      api.post<RunParams>('/runs/:id/source-check', async (request) => {
        const data = request.body;
        if (!Value.Check(sourceCheckSchema, data))
          throw new Error('Choose 1–20 valid action rules to check.');
        if (data.preview)
          return {
            input: await runs.previewSource(
              request.params.id,
              data.gateId,
              data.targets,
            ),
          };
        if (!data.profile?.trim())
          throw new Error('Choose a classification profile.');
        return runs.checkSource(
          request.params.id,
          data.gateId,
          data.targets,
          data.profile.trim(),
        );
      });
      api.get<RunParams>('/runs/:id', async (request, reply) => {
        const snapshot = await runs.get(request.params.id);
        return (
          snapshot ??
          reply.code(404).send({
            error: 'This run was not found in this workspace database.',
          })
        );
      });
      api.get<RunParams>('/runs/:id/events', async (request, reply) => {
        const id = request.params.id;
        const initial = await runs.get(id);
        if (!initial)
          return reply.code(404).send({
            error: 'This run was not found in this workspace database.',
          });
        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        let sequence = initial.sequence;
        const send = (snapshot: typeof initial) =>
          reply.raw.write(
            `id: ${snapshot.sequence}\ndata: ${JSON.stringify(snapshot)}\n\n`,
          );
        send(initial);
        let closed = false;
        let timer: ReturnType<typeof setTimeout>;
        const close = () => {
          if (closed) return;
          closed = true;
          clearTimeout(timer);
          clearInterval(heartbeat);
          streams.delete(close);
          reply.raw.end();
        };
        const poll = async () => {
          try {
            const snapshot = await runs.get(id);
            if (closed) return;
            if (!snapshot) return close();
            if (snapshot.sequence > sequence) {
              sequence = snapshot.sequence;
              if (!send(snapshot)) return close(); // A slow client reconnects to the latest snapshot.
            }
            if (snapshot.state === 'finished' || snapshot.state === 'failed')
              return;
          } catch {
            return close();
          } // EventSource reconnects and refetches; no stuck stream.
          if (!closed) timer = setTimeout(() => void poll(), 250);
        };
        const heartbeat = setInterval(() => {
          if (!reply.raw.write(': keepalive\n\n')) close();
        }, 15000);
        streams.add(close);
        reply.raw.once('close', close);
        if (initial.state !== 'finished' && initial.state !== 'failed')
          timer = setTimeout(() => void poll(), 250);
      });
      api.post<RunParams>('/runs/:id/decisions', async (request) => {
        const data = request.body as {
          gateId: string;
          decision: StageDecision;
        };
        if (
          !data ||
          typeof data.gateId !== 'string' ||
          !Value.Check(decisionSchema, data.decision)
        )
          throw new Error('Provide a valid gate decision.');
        if (
          (data.decision.action === 'feedback' &&
            !data.decision.message.trim()) ||
          (data.decision.action === 'abort' && !data.decision.reason?.trim())
        )
          throw new Error('Write a reason before submitting.');
        return runs.decide(request.params.id, data.gateId, data.decision);
      });
      api.post<RunParams>('/runs/:id/withdraw', async (request) => {
        const data = request.body as { reason?: unknown };
        if (
          !data ||
          typeof data.reason !== 'string' ||
          !data.reason.trim() ||
          data.reason.length > 10000
        )
          throw new Error('Write a reason before withdrawing.');
        return runs.withdraw(request.params.id, data.reason.trim());
      });
      api.post<RunParams>('/runs/:id/save', async (request, reply) => {
        const snapshot = await runs.get(request.params.id);
        if (!snapshot?.run)
          throw new Error('Wait for the run to finish before saving.');
        return reply
          .code(201)
          .send({ id: await options.store.save(snapshot.run) });
      });
    },
    { prefix: '/api' },
  );
  return app;
}
