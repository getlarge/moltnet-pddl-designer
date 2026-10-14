import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { editRun, passSavedStage, readRun, STAGES } from '../src/saved-run.js';
import type { DesignInput, StageName } from '../src/stages.js';
import type { DesignOptions, StageDecision } from '../src/workflow.js';
import { Session, type Execute } from './sessions.js';
import { RunStore } from './store.js';

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
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error('The request exceeds 5 MB.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
export interface ApiOptions {
  root: string;
  store: RunStore;
  execute?: Execute;
  defaults?: Partial<DesignInput>;
}
export function createApi(options: ApiOptions) {
  const sessions = new Map<string, Session>();
  const execute: Execute =
    options.execute ??
    (async (input, runOptions) => {
      // Loaded only when starting a live run. Offline access needs no identity.
      const { connect } = await import('@themoltnet/sdk/node');
      const { createSdkTaskClient } =
        await import('@themoltnet/tasks-orchestrator');
      const { runPddlDesign } = await import('../src/workflow.js');
      const agent = await connect();
      const { items } = await agent.runtimeProfiles.list({
        teamId: input.teamId,
      });
      const resolveProfile = (reference: string, label: string) => {
        const profile = items.find(
          (p) => p.id === reference || p.name === reference,
        );
        if (!profile)
          throw new Error(
            `${label} profile "${reference}" was not found in this team. Choose an existing profile and start a daemon worker for it.`,
          );
        return profile.id;
      };
      const profileId = resolveProfile(input.profileId, 'Default generation');
      const stageProfiles = Object.fromEntries(
        Object.entries(input.stageProfiles ?? {}).map(([stage, reference]) => [
          stage,
          resolveProfile(reference, stage),
        ]),
      );
      return runPddlDesign(
        createSdkTaskClient(agent),
        { ...input, profileId, stageProfiles },
        runOptions,
      );
    });
  return async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      // Loopback alone does not prevent another website from issuing requests.
      const host = req.headers.host ?? '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
        json(res, { error: 'Use the local server address.' }, 403);
        return true;
      }
      if (req.headers.origin && req.headers.origin !== `http://${host}`) {
        json(res, { error: 'Requests must come from this local app.' }, 403);
        return true;
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        json(res, { error: 'Cross-site requests are not allowed.' }, 403);
        return true;
      }
      if (
        req.method !== 'GET' &&
        !req.headers['content-type']?.startsWith('application/json')
      ) {
        json(res, { error: 'Send application/json.' }, 415);
        return true;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      const [, resource, id, action] = parts;
      if (req.method === 'GET' && resource === 'config') {
        json(res, {
          defaults: options.defaults ?? {},
          runsDirectory: options.store.directory,
        });
        return true;
      }
      if (req.method === 'GET' && resource === 'examples') {
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
            /* directories without both inputs aren't examples */
          }
        }
        json(res, examples);
        return true;
      }
      if (resource === 'saved') {
        if (req.method === 'GET') {
          json(
            res,
            id ? await options.store.get(id) : await options.store.list(),
          );
          return true;
        }
        if (req.method === 'POST' && !id) {
          const run = readRun(await body(req));
          json(res, { id: await options.store.save(run), run }, 201);
          return true;
        }
        if (
          req.method === 'POST' &&
          id &&
          (action === 'edit' || action === 'pass')
        ) {
          const data = (await body(req)) as {
            stage: StageName;
            result?: unknown;
          };
          if (!data || !STAGES.includes(data.stage))
            throw new Error('Choose a valid stage.');
          const previous = await options.store.get(id);
          const run =
            action === 'edit'
              ? editRun(previous, data.stage, data.result)
              : passSavedStage(previous, data.stage);
          json(res, { id: await options.store.save(run), run }, 201);
          return true;
        }
      }
      if (resource === 'runs' && req.method === 'POST' && !id) {
        const data = await body(req);
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
          ].some((x) => !x.trim())
        )
          throw new Error('Required fields cannot be blank.');
        if (data.savedId && (!data.stage || !data.feedback?.trim()))
          throw new Error('Choose a saved stage and write a correction note.');
        if (
          [...sessions.values()].some((s) =>
            ['running', 'awaiting'].includes(s.snapshot.state),
          )
        )
          throw new Error(
            'Finish or withdraw the current run before starting another.',
          );
        const input = {
          ...data.input,
          correlationId: randomUUID(),
        } as DesignInput;
        const runOptions: DesignOptions = {
          claimTimeoutSec: data.claimTimeoutSec ?? 600,
        };
        if (data.savedId) {
          const saved = await options.store.get(data.savedId);
          Object.assign(input, saved.input, { correlationId: randomUUID() });
          runOptions.resume = {
            run: saved,
            stage: data.stage!,
            feedback: data.feedback!,
          };
        }
        const session = new Session(input, execute, runOptions);
        sessions.set(session.snapshot.id, session);
        void session.start(input);
        json(res, session.snapshot, 201);
        return true;
      }
      if (resource === 'runs' && id) {
        const session = sessions.get(id);
        if (!session) {
          json(
            res,
            {
              error:
                'This live run is no longer available. The server may have restarted. Open a saved run or start again.',
            },
            404,
          );
          return true;
        }
        if (req.method === 'GET' && !action) {
          json(res, session.snapshot);
          return true;
        }
        if (req.method === 'GET' && action === 'events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          // Every event carries an authoritative snapshot, including history. A
          // reconnect cannot miss a gate or apply an old incremental transition.
          const unsubscribe = session.subscribe((snapshot) =>
            res.write(
              `id: ${snapshot.sequence}\ndata: ${JSON.stringify(snapshot)}\n\n`,
            ),
          );
          const heartbeat = setInterval(
            () => res.write(': keepalive\n\n'),
            15000,
          );
          res.on('close', () => {
            unsubscribe();
            clearInterval(heartbeat);
          });
          return true;
        }
        if (req.method === 'POST' && action === 'decisions') {
          const data = (await body(req)) as {
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
          try {
            session.decide(data.gateId, data.decision);
          } catch (error) {
            json(res, { error: (error as Error).message }, 409);
            return true;
          }
          json(res, session.snapshot);
          return true;
        }
        if (req.method === 'POST' && action === 'save') {
          if (!session.snapshot.run)
            throw new Error('Wait for the run to finish before saving.');
          json(
            res,
            { id: await options.store.save(session.snapshot.run) },
            201,
          );
          return true;
        }
      }
      json(res, { error: 'Endpoint not found.' }, 404);
    } catch (error) {
      json(
        res,
        {
          error: error instanceof Error ? error.message : 'The request failed.',
        },
        400,
      );
    }
    return true;
  };
}
