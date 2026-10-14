import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it } from 'vitest';

import {
  ClassifyQuestionError,
  createClassifyDecisionClient,
  createClassifyQuestionClient,
  parseYesNo,
} from './decision.js';

const options = {
  teamId: 'team',
  diaryId: 'diary',
  correlationId: 'corr',
  profileId: 'classifier-profile',
  pollIntervalSec: 0,
};

const question = {
  instructions: 'Is this step required?',
  criteria: { true: 'required', false: 'optional' },
};

const answer = (probability: number) => ({
  version: 1,
  answers: { answer: { type: 'bool', probability } },
});

describe('createClassifyDecisionClient', () => {
  it('asks one bool question through a classify task', async () => {
    // Arrange
    const tasks = new FakeTasks([answer(0.93)]);
    const client = createClassifyDecisionClient(tasks, options);

    // Act
    const p = await client.yesNo({ step: 'pick-up' }, question);

    // Assert
    expect(p).toBe(0.93);
    const [body] = tasks.created;
    expect(body.taskType).toBe('classify');
    expect(body.allowedProfiles).toEqual([{ profileId: 'classifier-profile' }]);
    expect(body.correlationId).toBe('corr');
    expect(body.input).toEqual({
      version: 1,
      state: { step: 'pick-up' },
      questions: { answer: { type: 'bool', ...question } },
    });
  });

  it('reuses the idempotency key for the same question about the same state', async () => {
    // Arrange
    const tasks = new FakeTasks([answer(0.1), answer(0.1), answer(0.1)]);
    const client = createClassifyDecisionClient(tasks, options);

    // Act
    await client.yesNo({ step: 'a' }, question);
    await client.yesNo({ step: 'a' }, question);
    await client.yesNo({ step: 'b' }, question);

    // Assert
    const keys = tasks.creationOptions.map((o) => o?.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('fails instead of guessing when the classify task fails', async () => {
    // Arrange
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }]);
    const client = createClassifyDecisionClient(tasks, options);

    // Act
    const asking = client.yesNo({ step: 'a' }, question);

    // Assert
    await expect(asking).rejects.toThrow(/review question failed/);
  });
});

describe('parseYesNo', () => {
  it('rejects extra answers and invalid probabilities', () => {
    expect(() =>
      parseYesNo({
        version: 1,
        answers: {
          answer: { type: 'bool', probability: 0.9 },
          extra: { type: 'bool', probability: 0.1 },
        },
      }),
    ).toThrow();
    expect(() => parseYesNo(answer(1.1))).toThrow();
  });
  it('rejects an output without the bool answer', () => {
    // Arrange
    const output = {
      ...answer(0.5),
      answers: { other: { type: 'bool', probability: 0.5 } },
    };

    // Act
    const parsing = () => parseYesNo(output);

    // Assert
    expect(parsing).toThrow(/no bool answer/);
  });
});

describe('createClassifyQuestionClient', () => {
  it('returns task evidence and separates early questions from final review', async () => {
    const tasks = new FakeTasks([answer(0.93), answer(0.93)]);
    const early = createClassifyQuestionClient(tasks, {
      ...options,
      purpose: 'warning-review',
    });
    const final = createClassifyQuestionClient(tasks, options);
    const state = { process: 'original', warning: 'unlinked' };

    const result = await early.ask(state, question);
    await final.ask(state, question);

    expect(result).toMatchObject({
      probability: 0.93,
      taskId: expect.any(String),
    });
    expect((await tasks.getTask(result.taskId)).taskType).toBe('classify');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(tasks.created[0].tags).toContain('stage:warning-review');
    expect(tasks.creationOptions[0]?.idempotencyKey).toMatch(
      /^pddl-warning-review:/,
    );
    expect(tasks.creationOptions[0]?.idempotencyKey).not.toBe(
      tasks.creationOptions[1]?.idempotencyKey,
    );
  });

  it('changes the idempotency key when the model or question changes', async () => {
    const tasks = new FakeTasks([
      answer(0.1),
      answer(0.1),
      answer(0.1),
      answer(0.1),
    ]);
    const client = createClassifyQuestionClient(tasks, options);
    await client.ask({ model: 'draft' }, question);
    await client.ask({ model: 'draft' }, question);
    await client.ask({ model: 'edited' }, question);
    await client.ask(
      { model: 'edited' },
      { ...question, instructions: 'A different question' },
    );

    const keys = tasks.creationOptions.map((o) => o?.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(3);
  });

  it('retains the task id on a claim timeout', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'queued' }]);
    const getTask = tasks.getTask.bind(tasks);
    tasks.getTask = async (id) => ({
      ...(await getTask(id)),
      status: 'queued',
    });
    const client = createClassifyQuestionClient(tasks, {
      ...options,
      claimTimeoutSec: 0,
    });
    const failure = await client
      .ask({}, question)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ClassifyQuestionError);
    expect(failure).toMatchObject({
      taskId: expect.any(String),
      message: expect.stringContaining('no worker claimed'),
    });
  });
});
