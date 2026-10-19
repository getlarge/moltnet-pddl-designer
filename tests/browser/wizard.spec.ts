import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.afterEach(async ({ page, request }) => {
  const id = new URL(page.url()).hash.slice(1).split('/');
  if (id[0] === 'run' && id[1]) {
    const response = await request.get(`/api/runs/${id[1]}`);
    if (response.ok()) {
      const snapshot = await response.json();
      if (snapshot.gate)
        await request.post(`/api/runs/${id[1]}/decisions`, {
          data: {
            gateId: snapshot.gate.id,
            decision: { action: 'abort', reason: 'Synthetic test cleanup.' },
          },
        });
    }
  }
});

test('temporal example fills both inputs and submits its classifier profile', async ({
  page,
  request,
}) => {
  await page.goto('/?example=temporal-loading');
  await expect(page.getByLabel('How does the process work?')).toHaveValue(
    /takes two minutes/,
  );
  await expect(
    page.getByLabel('What situation should the plan solve?'),
  ).toHaveValue(/parcel-one/);
  await expect(
    page.getByRole('checkbox', {
      name: /Extract timing after the model is approved/,
    }),
  ).toBeChecked();
  await expect(
    page.getByLabel('Classification profile name or ID'),
  ).toHaveValue('test-classifier');
  await page.getByRole('button', { name: 'Begin proof' }).click();
  await expect(page).toHaveURL(/#run\//);
  const id = new URL(page.url()).hash.slice(5);
  const snapshot = await (await request.get(`/api/runs/${id}`)).json();
  expect(snapshot.input.temporal).toBe(true);
  expect(snapshot.input.classificationProfileId).toBe('test-classifier');
});

for (const [name, process, situation] of [
  ['temporal-inspection', /takes two minutes/, /container-one/],
  ['temporal-heating', /takes five minutes/, /piece-one/],
] as const) {
  test(`${name} can be selected as a temporal example`, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Start with an example').selectOption(name);
    await expect(page.getByLabel('How does the process work?')).toHaveValue(
      process,
    );
    await expect(
      page.getByLabel('What situation should the plan solve?'),
    ).toHaveValue(situation);
    await expect(
      page.getByRole('checkbox', {
        name: /Extract timing after the model is approved/,
      }),
    ).toBeChecked();
  });
}

test('proofing flow, source links, corrections, plan exploration and offline revision', async ({
  page,
}) => {
  await mkdir('.impeccable/review', { recursive: true });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Put your process on the record.' }),
  ).toBeVisible();
  await page.screenshot({
    path: '.impeccable/review/intake.png',
    fullPage: true,
  });
  await page
    .getByLabel('How does the process work?')
    .fill('Synthetic test: A robotic arm moves blocks. Blocks can be stacked.');
  await page
    .getByLabel('What situation should the plan solve?')
    .fill('Synthetic test: Build a tower a on b on c.');
  await page.getByLabel('Model name', { exact: true }).fill('synthetic-blocks');
  await page.getByRole('button', { name: 'Begin proof' }).click();
  await expect(page.getByText('Your reading is needed')).toBeVisible();
  await page.getByRole('button', { name: 'block L01', exact: true }).click();
  await expect(page.locator('.sentences .selected')).toContainText(
    'A robotic arm',
  );
  await page.screenshot({
    path: '.impeccable/review/desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '.impeccable/review/mobile.png',
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(page.getByText('Your reading is needed')).toBeVisible();
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).first().fill('Invalid Name');
  await page.getByRole('button', { name: 'Check corrections' }).click();
  await expect(
    page.getByRole('button', { name: 'Pass', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('Correction required').first()).toBeVisible();
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true }).first()).toHaveValue(
    'Invalid Name',
  );
  await page.getByLabel('Name', { exact: true }).first().fill('block');
  await page.getByRole('button', { name: 'Check corrections' }).click();
  for (const title of ['Facts', 'Actions', 'Refinement', 'Situation']) {
    await page.getByRole('button', { name: 'Pass', exact: true }).click();
    await expect(page.locator('.margin .column-heading h2')).toHaveText(title);
  }
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Plan walkthrough', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Source description' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Show description', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Source description' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Hide description', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Show construction', exact: true })
    .click();
  await expect(
    page.getByRole('complementary', { name: 'Construction' }),
  ).toBeVisible();
  await expect(page.locator('.syntax-key').first()).toBeVisible();
  await page.keyboard.press('Tab');
  for (const selector of [
    '.construction-column',
    '.syntax-code',
    '.fact-list',
  ]) {
    await page.locator(selector).first().focus();
    await expect(page.locator(selector).first()).toBeFocused();
    await expect(page.locator(selector).first()).toHaveCSS(
      'outline-style',
      'solid',
    );
    await expect(page.locator(selector).first()).toHaveCSS(
      'outline-width',
      '2px',
    );
  }

  await page.screenshot({
    path: '.impeccable/review/plan-columns.png',
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Show description', exact: true })
    .click();
  await page.screenshot({
    path: '.impeccable/review/plan-all-columns.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.screenshot({
    path: '.impeccable/review/plan-all-medium.png',
    fullPage: true,
  });
  // Exercise both independent toggles at widths where reference panels reflow.
  for (const width of [1440, 1200, 1000, 850, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const toggle of [
      'Hide description',
      'Hide construction',
      'Show description',
      'Show construction',
    ]) {
      await page.getByRole('button', { name: toggle, exact: true }).click();
      const layout = await page
        .locator('.proof-columns')
        .evaluate((columns) => {
          const boxes = [...columns.children].map((child) =>
            child.getBoundingClientRect(),
          );
          const overlap = boxes.some((a, i) =>
            boxes
              .slice(i + 1)
              .some(
                (b) =>
                  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
              ),
          );
          return {
            overlap,
            overflow: document.documentElement.scrollWidth > innerWidth,
            panelsFit: boxes.every(
              (box) => box.left >= 0 && box.right <= innerWidth + 1,
            ),
          };
        });
      expect(layout, `${width}px after ${toggle}`).toEqual({
        overlap: false,
        overflow: false,
        panelsFit: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('button', { name: 'Hide description', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Hide construction', exact: true })
    .click();
  const graph = page.getByRole('navigation', { name: 'Plan dependencies' });
  await expect(graph).toBeVisible();
  await graph.getByRole('button', { name: /^Step 2/ }).click();
  await expect(page.locator('.simulation-bar strong')).toHaveText(
    'After step 2',
  );
  await expect(page.locator('.fact-list')).toContainText(
    'on block · block 1: b · block 2: c',
  );
  await page.getByRole('button', { name: 'Steps', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Plan progression' })
    .getByRole('button', { name: /^Step 2/ })
    .click();
  await expect(page.locator('.simulation-bar strong')).toHaveText(
    'After step 2',
  );
  await page
    .getByRole('navigation', { name: 'Plan progression' })
    .getByRole('button', { name: /Start/ })
    .click();
  await page.getByRole('button', { name: 'Next plan step' }).click();
  await expect(page.locator('.fact-list .added').first()).toBeVisible();
  await expect(page.locator('.fact-list')).toContainText(
    'held by arm · block: b · robotic arm: arm',
  );
  await expect(page.locator('.changes-added')).toContainText(
    'held by arm · block: b · robotic arm: arm',
  );
  await expect(page.locator('.changes-removed li').first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Initial state', { exact: true })).toBeVisible();
  for (let i = 0; i < 4; i++)
    await page.getByRole('button', { name: 'Next plan step' }).click();
  await expect(page.locator('.simulation-bar strong')).toHaveText(
    'Goal reached',
  );
  await expect(page.locator('.fact-list')).toContainText(
    'on block · block 1: a · block 2: b',
  );
  await page.screenshot({
    path: '.impeccable/review/plan.png',
    fullPage: true,
  });
  const mobile = await page
    .context()
    .browser()!
    .newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(page.url());
  await expect(
    mobile.getByRole('heading', { name: 'Plan walkthrough', exact: true }),
  ).toBeVisible();
  await mobile
    .getByRole('button', { name: 'Show construction', exact: true })
    .click();
  expect(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(mobile.locator('.routing-slip [aria-current]')).toBeInViewport({
    ratio: 1,
  });
  await expect(
    mobile.getByRole('navigation', { name: 'Plan dependencies' }),
  ).toBeVisible();
  const mobileGraph = mobile.getByRole('navigation', {
    name: 'Plan dependencies',
  });
  expect(
    await mobileGraph.evaluate(
      (graph) => graph.scrollWidth > graph.clientWidth,
    ),
  ).toBe(true);
  expect(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await mobileGraph.scrollIntoViewIfNeeded();
  await mobile.screenshot({
    path: '.impeccable/review/plan-graph-mobile.png',
    fullPage: false,
  });
  await mobileGraph.getByRole('button', { name: /^Step 4/ }).click();
  await mobile.getByRole('button', { name: 'Steps', exact: true }).click();
  await expect
    .poll(() =>
      mobile.locator('.plan-timeline').evaluate((rail) => {
        const current = rail
          .querySelector('[aria-current]')!
          .getBoundingClientRect();
        const bounds = rail.getBoundingClientRect();
        return (
          current.left >= bounds.left - 1 && current.right <= bounds.right + 1
        );
      }),
    )
    .toBe(true);
  await mobile
    .getByRole('navigation', { name: 'Plan progression' })
    .getByRole('button', { name: /Start/ })
    .click();
  for (let i = 0; i < 4; i++)
    await mobile.getByRole('button', { name: 'Next plan step' }).click();
  await expect
    .poll(() =>
      mobile.locator('.plan-timeline').evaluate((rail) => {
        const current = rail
          .querySelector('[aria-current]')!
          .getBoundingClientRect();
        const bounds = rail.getBoundingClientRect();
        return (
          current.left >= bounds.left - 1 && current.right <= bounds.right + 1
        );
      }),
    )
    .toBe(true);
  await mobile.screenshot({
    path: '.impeccable/review/plan-mobile.png',
    fullPage: true,
  });
  await mobile.close();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect(page.getByText('Proof saved.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Galley rack', exact: true }).click();
  await page
    .getByRole('button', { name: 'Open proof', exact: true })
    .first()
    .click();
  await expect(
    page.getByText('Reopened locally', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Types Checked/ }).click();
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Meaning', exact: true })
    .first()
    .fill('A stackable test object');
  await page.getByRole('button', { name: 'Check corrections' }).click();
  await expect(
    page.getByText('Saved a new revision.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Review again').first()).toBeVisible();
});

test('feedback and withdrawal are real gate decisions', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('How does the process work?')
    .fill('Synthetic test: A robotic arm moves blocks. Blocks can be stacked.');
  await page
    .getByLabel('What situation should the plan solve?')
    .fill('Synthetic test: Build a tower a on b on c.');
  await page.getByRole('button', { name: 'Begin proof' }).click();
  await expect(page.getByText('Your reading is needed')).toBeVisible();
  await page
    .getByRole('button', { name: 'Return with note', exact: true })
    .click();
  await page
    .getByLabel('What should be corrected?')
    .fill('Keep the arm as a separate type.');
  await page.getByRole('button', { name: 'Send correction note' }).click();
  await expect(
    page.getByRole('button', { name: /Types Awaiting you Try 2/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page
    .getByLabel('Why are you withdrawing this proof?')
    .fill('Synthetic test complete.');
  await page
    .getByRole('button', { name: 'Withdraw proof', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Synthetic test complete.',
  );
});

async function startReview(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Team ID', { exact: true })).toHaveValue(
    'test-team',
  );
  await page
    .getByLabel('How does the process work?')
    .fill('Synthetic test: An arm moves blocks. Blocks can stack.');
  await page
    .getByLabel('What situation should the plan solve?')
    .fill('Stack a on b.');
  await page.getByRole('button', { name: 'Begin proof' }).click();
  await expect(page.getByText('Your reading is needed')).toBeVisible();
}

test('recovers a gate after its URL is lost', async ({ page }) => {
  await startReview(page);
  const runUrl = page.url();
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume current run' }).click();
  await expect(page).toHaveURL(runUrl);
  await expect(page.getByText('Your reading is needed')).toBeVisible();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page
    .getByLabel('Why are you withdrawing this proof?')
    .fill('Recovered run withdrawn.');
  await page
    .getByRole('button', { name: 'Withdraw proof', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Recovered run withdrawn.',
  );
});

test('removing an editor row keeps the next row bindings and submitted values', async ({
  page,
}) => {
  await startReview(page);
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  const refs = page.getByRole('textbox', { name: /Source line numbers/ });
  await refs.nth(1).fill('2');
  await page
    .getByRole('button', { name: 'Remove', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Name', exact: true }).first(),
  ).toHaveValue('agent');
  await expect(refs.first()).toHaveValue('2');
  await page.getByRole('button', { name: 'Check corrections' }).click();
  await expect(
    page.getByRole('button', { name: 'agent L02', exact: true }),
  ).toBeVisible();
});

test('applies the fetched snapshot when streaming fails', async ({
  page,
  request,
}) => {
  await startReview(page);
  const id = new URL(page.url()).hash.split('/')[1];
  await page.addInitScript(() => {
    class InterruptedStream {
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        (
          window as unknown as { interruptedStream: InterruptedStream }
        ).interruptedStream = this;
      }
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { value: InterruptedStream });
  });
  await page.reload();
  await expect(page.getByText('Your reading is needed')).toBeVisible();
  const snapshot = await (await request.get(`/api/runs/${id}`)).json();
  await request.post(`/api/runs/${id}/decisions`, {
    data: { gateId: snapshot.gate.id, decision: { action: 'accept' } },
  });
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/runs/${id}`)).json()).gate?.stage,
    )
    .toBe('predicates');
  await page.evaluate(() =>
    (
      window as unknown as { interruptedStream: { onerror: () => void } }
    ).interruptedStream.onerror(),
  );
  await expect(page.locator('.margin .column-heading h2')).toHaveText('Facts');
  await expect(page.getByText('Your reading is needed')).toBeVisible();
});

test('explains a worker claim timeout and preserves the description for retry', async ({
  page,
  request,
}) => {
  await startReview(page);
  const runUrl = page.url();
  const id = new URL(runUrl).hash.split('/')[1];
  const snapshot = await (await request.get(`/api/runs/${id}`)).json();
  await request.post(`/api/runs/${id}/decisions`, {
    data: {
      gateId: snapshot.gate.id,
      decision: {
        action: 'abort',
        reason: 'Timeout presentation fixture cleanup.',
      },
    },
  });
  const failed = {
    ...snapshot,
    gate: undefined,
    state: 'finished',
    events: [],
    run: {
      version: 1,
      status: 'failed',
      input: snapshot.input,
      stages: [],
      issues: [],
      durationMs: 600000,
      failure: {
        stage: 'types',
        code: 'claim-timeout',
        reason: 'No worker claimed the synthetic task.',
      },
    },
  };
  await page.route(`**/api/runs/${id}`, (route) =>
    route.fulfill({ json: failed }),
  );
  await page.route(`**/api/runs/${id}/events`, (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify(failed)}\n\n`,
    }),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'No worker picked up this step' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review setup and retry' }).click();
  await expect(page.getByLabel('How does the process work?')).toHaveValue(
    snapshot.input.description,
  );
  await page.getByRole('button', { name: 'Begin proof' }).click();
  await expect(page.getByText('Your reading is needed')).toBeVisible();
});

test('source check previews requests and informs the Actions review decision', async ({
  page,
}) => {
  await startReview(page);
  for (const heading of ['Facts', 'Actions']) {
    await page.getByRole('button', { name: 'Pass', exact: true }).click();
    await expect(page.locator('.margin .column-heading h2')).toHaveText(
      heading,
    );
  }
  const panel = page.getByRole('region', {
    name: 'Compare actions with your description',
  });
  await expect(panel).toBeVisible();
  // Guidance belongs before optional classification, regardless of result length.
  expect(
    await page
      .locator('.stage-reading-guide')
      .evaluate(
        (guide) =>
          !!(
            guide.compareDocumentPosition(
              document.querySelector('.source-check')!,
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
  ).toBe(true);
  const actionRules = page.locator('.action-facts').first();
  await expect(actionRules.locator(':scope > div')).toHaveCount(3);
  const columns = await actionRules
    .locator(':scope > div')
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().x));
  expect(columns[0]).toBeLessThan(columns[1]);
  expect(columns[1]).toBeLessThan(columns[2]);
  await panel.locator('.source-check-panel > summary').click();
  const choices = panel.getByRole('checkbox');
  for (let n = 0; n < 3; n++) await choices.nth(n).check();
  await panel.getByRole('button', { name: 'Preview source check' }).click();
  await expect(
    panel.getByRole('heading', { name: 'Ready to compare 3 rules' }),
  ).toBeVisible();
  await panel.getByLabel('Classification profile name or ID').fill('synthetic');
  await panel.getByRole('button', { name: 'Run source check' }).click();
  await expect(
    panel.getByText('Matches description', { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText('Conflicts with description', { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText('Not settled by description', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
  await expect(panel.locator('.source-check-result').first()).toContainText(
    'Conflicts with description',
  );
  await expect(
    panel.getByText(/model probability for this label/).first(),
  ).not.toBeVisible();
  const firstResult = panel.locator('.source-check-result').first();
  await expect(
    firstResult.getByLabel('Classifier state, question and answer'),
  ).toHaveCount(0);
  await firstResult.getByText('Check details', { exact: true }).click();
  const evidence = JSON.parse(
    (await firstResult
      .getByLabel('Classifier state, question and answer')
      .textContent())!,
  );
  expect(evidence.state.source).toContain('An arm moves blocks');
  expect(evidence.question.instructions).toContain('state.source');
  expect(evidence.question.criteria).toHaveProperty('contradicted');
  expect(evidence.answer.choice).toBe('contradicted');
  await firstResult.getByText('Check details', { exact: true }).click();
  await expect(
    firstResult.getByLabel('Classifier state, question and answer'),
  ).toHaveCount(0);
  const shared = panel.locator('.source-check-evidence');
  await expect(shared.locator(':scope > summary')).toContainText('all 3 rules');
  await shared.locator(':scope > summary').click();
  await expect(
    shared.getByText('Exact request and raw response — all checked rules', {
      exact: true,
    }),
  ).toBeVisible();
  await shared.locator(':scope > summary').click();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '.impeccable/review/source-results-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '.impeccable/review/source-results-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    panel.getByText('Source used for all checked rules', { exact: true }),
  ).toHaveCount(0);
  await expect(
    panel
      .locator('.source-check-result')
      .last()
      .getByText('Source used for all checked rules', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Pass', exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole('button', { name: 'Prepare correction note' })
    .first()
    .click();
  await expect(page.getByLabel('What should be corrected?')).toContainText(
    'source check found a contradiction',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByRole('button', { name: 'Check corrections' }).click();
  await expect(
    panel.getByText('Conflicts with description', { exact: true }),
  ).toHaveCount(0);
  await panel.locator('.source-check-panel > summary').click();
  await panel.getByRole('checkbox').first().check();
  await panel.getByRole('button', { name: 'Preview source check' }).click();
  await panel
    .getByLabel('Classification profile name or ID')
    .fill('synthetic-failure');
  await panel
    .getByRole('button', { name: 'Run source check', exact: true })
    .click();
  await expect(panel.getByRole('alert')).toContainText(
    'Synthetic provider unavailable.',
  );
  await expect(panel.getByRole('alert')).toContainText(
    'Task synthetic-source-check',
  );
  await expect(
    page.getByRole('button', { name: 'Pass', exact: true }),
  ).toBeEnabled();
});

test('editable readable meanings become the exact preview claims', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startReview(page);
  await expect(page.locator('.margin .column-heading h2')).toHaveText('Types');
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await expect(page.locator('.margin .column-heading h2')).toHaveText('Facts');
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page
    .getByLabel('When this fact is true')
    .first()
    .fill('{?b} is on the table');
  await page
    .getByLabel('When this fact is false')
    .first()
    .fill('{?b} is not on the table');
  await page
    .getByRole('button', { name: 'Check corrections', exact: true })
    .click();
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await expect(page.locator('.margin .column-heading h2')).toHaveText(
    'Actions',
  );
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByLabel('Readable wording').first().fill('{?a} picks up {?b}');
  await page
    .getByRole('button', { name: 'Check corrections', exact: true })
    .click();
  const panel = page.getByRole('region', {
    name: 'Compare actions with your description',
  });
  await panel.locator('.source-check-panel > summary').click();
  const claim =
    'The robotic arm picks up the block. Immediately afterward, the block is not on the table.';
  await panel
    .getByRole('checkbox', {
      name: new RegExp(claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    })
    .check();
  await panel.getByRole('button', { name: 'Preview source check' }).click();
  const list = panel.getByRole('list', { name: 'Claims the model will check' });
  await expect(list.getByText(claim, { exact: true })).toBeVisible();
  await list.getByText('Formal rule and participants', { exact: true }).click();
  await expect(list).toContainText('on-table(?b) is false');
  await expect(list).toContainText('the robotic arm');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({
    path: '.impeccable/review/readable-claims-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(list.getByText(claim, { exact: true })).toBeVisible();
  await page.screenshot({
    path: '.impeccable/review/readable-claims-desktop.png',
    fullPage: true,
  });
});
