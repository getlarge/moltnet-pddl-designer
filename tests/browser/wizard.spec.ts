import { test, expect } from '@playwright/test';
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

test('opt-in warning assessment shows questions, returns and saved evidence', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('How does the process work?')
    .fill('Synthetic test: A robotic arm moves blocks. Blocks can be stacked.');
  await page
    .getByLabel('What situation should the plan solve?')
    .fill('Synthetic test: Build a tower a on b on c.');
  const enable = page.getByLabel(
    'Assess action warnings against my description',
  );
  await expect(enable).not.toBeChecked();
  await enable.check();
  await page
    .getByLabel('Classification profile name or ID')
    .fill('test-classifier');
  await page.getByRole('button', { name: 'Begin proof' }).click();
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText('Your reading is needed')).toBeVisible();
    await page.getByRole('button', { name: 'Pass', exact: true }).click();
    if (n < 4)
      await expect(page.locator('.margin .column-heading h2')).toHaveText(
        ['Facts', 'Actions', 'Refinement', 'Situation'][n],
      );
  }
  const assessment = page.getByRole('region', {
    name: 'Warning assessment',
    exact: true,
  });
  await expect(assessment).toBeVisible();
  const question = assessment.locator('details').first();
  await question.locator('summary').click();
  await expect(question).toContainText('4.0% probability of a defect');
  await expect(question).toContainText('Yes means');
  await expect(question).toContainText('No means');
  await expect(question).toContainText(
    'Does the original process description establish',
  );
  await expect(question).toContainText('"probability": 0.04');
  await mkdir('.impeccable/review', { recursive: true });
  await page.screenshot({
    path: '.impeccable/review/classification.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '.impeccable/review/classification-mobile.png',
    fullPage: false,
  });
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect(page).toHaveURL(/#saved\//);
  await page.reload();
  const restored = page.getByRole('region', {
    name: 'Warning assessment',
    exact: true,
  });
  await expect(restored).toBeVisible();
  await restored.locator('details').first().locator('summary').click();
  await expect(restored).toContainText('"probability": 0.04');
});
