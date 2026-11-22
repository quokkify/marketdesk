// Scenario for the PR 514 demo: one Hermes card in the product rail and the drawer behind it.
// Draft for the owner's approval; nothing is recorded before that.
export const title = 'PR 514: one Hermes card and its drawer on the product page';

export const covers = {
  'Rail: price card, Statistics, one Hermes card ("Not analysed", "Analyze product"); the four old cards are gone':
    'step 1',
  'Analyze product: the chip counts the steps, the rows fill in, the lead sentence and the provider note': 'step 2',
  'Price row names the market prices it used; Market prices row opens the drawer with the four figures, the prices found by kind and why no estimate is suggested':
    'step 3',
  '"Your prices": add a price, Search again, the price is still there': 'step 4',
  'Checks tab: the three checks with reasons and the publication readiness check moved here': 'step 5',
  'Suggestions tab shows the suggestion of the analysis (not applied)': 'step 6',
  'Log and history: newest run open with its steps; the earlier search and the suggestion as own entries': 'step 7',
  'Drawer closes; the card and the "Hermes: N things to fix" hint on the price card': 'step 8',
};

export const notShown = [
  'A "Set price to …" primary action: the demo stand has no Hermes model behind the main profile, and the offline estimate never proposes a price',
  'A result from the real Hermes model: only the market search is answered (by a mock with recorded, synthetic answers); the checks use the offline heuristics, as the provider note says',
  'Applying the title suggestion: it would rename the product mid-demo; the suggestion flow itself is unchanged by this PR',
  'Phone and tablet layouts of the card and the drawer (the video is desktop only; screenshots at 1024 and 390 px are attached to the prep report)',
];

export const questions = [
  'The Price row says "Needs you" while the Price check only says the research is too weak to judge the price. Is "Needs you" the intended status when Hermes simply cannot judge?',
  'With confidence "low" the drawer shows Start price and Floor (both 202,65 zł) yet says "Not suggested: confidence is low". Should the figures be hidden or greyed out when they are not suggested?',
  'The lead sentence is the first failing check (category). Should the lead rather point at the most important fix (for example, no photos)?',
];

const PRODUCT = 'AOPEN QH11 projektor';
const MY_PRICE = '320';
const RUN_TIMEOUT_MS = 120_000;
const SCROLL_SETTLE_MS = 700;
// Captions sit at the bottom centre of the video, so content is scrolled to the top or the middle, never the bottom.
const HEADER_PX = 80;

async function toTop(page, locator) {
  await locator.evaluate((el, header) => {
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - header, behavior: 'smooth' });
  }, HEADER_PX);
  await page.waitForTimeout(SCROLL_SETTLE_MS);
}

async function toMiddle(page, locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await page.waitForTimeout(SCROLL_SETTLE_MS);
}

export async function steps({ page, kit }) {
  const card = page.getByTestId('hermes-card');
  const chip = page.getByTestId('hermes-chip');
  const drawer = page.getByRole('dialog', { name: `Hermes · ${PRODUCT}` });
  const tab = (name) => drawer.getByRole('tab', { name });

  // 1. The rail
  await kit.chapter('The product rail', 'One Hermes card instead of four');
  await page.getByText(PRODUCT).first().click();
  await card.waitFor();
  await kit.caption('A seller opens a projector that Hermes has not analysed yet.');
  await toTop(page, page.getByText('Selling price', { exact: false }).first());
  await kit.caption('The right rail: the price card, Statistics, and one Hermes card. The four old AI cards are gone.', 4500);
  await toTop(page, card);
  await chip.filter({ hasText: 'Not analysed' }).waitFor();
  await kit.caption('Hermes: "Not analysed", one action: Analyze product.');
  await kit.shot('01-rail-not-analysed');

  // 2. Analyze
  await kit.chapter('Analyze product');
  await kit.caption('Analyze product: Hermes searches market prices, then runs three checks.', 2500);
  await page.getByTestId('hermes-primary-action').click();
  await chip.filter({ hasText: /Analyzing|Searching/ }).waitFor({ timeout: RUN_TIMEOUT_MS }).catch(() => {});
  await kit.caption('The chip counts the steps while the rows fill in.', 1500);
  await chip.filter({ hasText: /Needs you|Ready|Needs a fix/ }).waitFor({ timeout: RUN_TIMEOUT_MS });
  await toTop(page, card);
  await kit.caption('The result: the lead sentence names what to fix first.');
  await kit.caption('The note under the button says who answered: offline heuristics, because Hermes is unavailable here.', 4500);
  await kit.shot('02-analysed');

  // 3. Price row and Market prices
  await kit.chapter('Market prices');
  await kit.caption('The Price row says which market prices it used: the ones found just now.');
  await page.getByTestId('hermes-row-prices').click();
  await tab('Market prices').and(page.locator('[aria-selected="true"]')).waitFor();
  await kit.caption('The drawer opens on Market prices: start price, floor, new and used figures.', 4000);
  await kit.caption('Why no estimate is suggested: the confidence is low.');
  await toMiddle(page, drawer.getByTestId('prices-found-list'));
  await kit.caption('What Hermes found, by kind: same model used, last new prices, new and used substitutes.', 4500);
  await kit.shot('03-market-prices');

  // 4. Your prices + Search again
  await kit.chapter('Your prices');
  const form = drawer.getByTestId('my-price-form');
  await toMiddle(page, form);
  await kit.caption('The seller adds a price they found themselves.', 2500);
  await form.getByLabel(/^Price/).fill(MY_PRICE);
  await form.getByLabel('What it is').selectOption({ label: 'Same model, used' });
  await form.getByRole('button', { name: 'Add price' }).click();
  const mine = drawer.getByTestId('my-prices-list');
  await mine.getByText(`${MY_PRICE} zł`).waitFor();
  await toMiddle(page, mine);
  await kit.caption('It is listed under "Your prices", marked "yours".');
  const searchAgain = drawer.getByTestId('prices-search-again');
  await toMiddle(page, searchAgain);
  await kit.caption('Search again: Hermes looks for market prices once more.', 2500);
  await searchAgain.click();
  await drawer.getByTestId('prices-progress').waitFor({ timeout: RUN_TIMEOUT_MS });
  await kit.caption('The search runs step by step; the button waits until it is done.');
  await drawer.getByTestId('prices-progress').waitFor({ state: 'detached', timeout: RUN_TIMEOUT_MS });
  await searchAgain.filter({ hasText: 'Search again' }).waitFor({ timeout: RUN_TIMEOUT_MS });
  await drawer.getByTestId('prices-last-run').waitFor({ timeout: RUN_TIMEOUT_MS });
  await toMiddle(page, mine);
  await mine.getByText(`${MY_PRICE} zł`).waitFor();
  await kit.caption('After the new search the seller\'s price is still there.');
  await kit.shot('04-your-price-kept');

  // 5. Checks
  await kit.chapter('Checks');
  await tab('Checks').click();
  await drawer.getByRole('heading', { name: /^Photos/ }).waitFor();
  await kit.caption('Checks: price, info and photos, each with its reason and a way to fix it.', 4500);
  const readiness = drawer.getByRole('button', { name: /Publication readiness check/ });
  await toMiddle(page, readiness);
  await kit.caption('The publication readiness check moved here from the rail.', 2500);
  await readiness.click();
  await drawer.getByRole('button', { name: 'Check again' }).waitFor();
  await kit.caption('Opened, it checks the saved product without publishing it.');
  await kit.shot('05-checks');

  // 6. Suggestions
  await kit.chapter('Suggestions');
  await tab('Suggestions').click();
  await drawer.getByText('Listing SEO suggestion: title').first().waitFor();
  await kit.caption('Suggestions: the analysis proposes a better title. The seller can apply or dismiss it; the demo leaves it.', 5000);
  await kit.shot('06-suggestions');

  // 7. Log and history
  await kit.chapter('Log and history');
  await tab('Log and history').click();
  await drawer.getByRole('button', { name: /^Analysis/ }).first().waitFor();
  await kit.caption('Log and history: the newest run, the price search, is open with its steps.', 4000);
  await kit.caption('The analysis and the title suggestion are entries of their own.', 4000);
  await kit.shot('07-history');

  // 8. Close
  await kit.chapter('Back on the page');
  await drawer.getByRole('button', { name: 'Close' }).click();
  await drawer.waitFor({ state: 'hidden' });
  await toTop(page, card);
  await kit.caption('The card keeps the result and the time of the last run.');
  const hint = page.getByText(/^Hermes: \d+ things? to fix$/);
  await toMiddle(page, hint);
  await kit.caption('On the price card: how many things Hermes wants fixed before publishing.', 4000);
  await kit.caption('');
  await kit.shot('08-hint');
}
