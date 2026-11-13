// Scenario for the demo of the MarketDesk core flow after the "cut to core" stack (#444):
// create a product, publish it to the OLX sandbox, open its product card.
export const title = 'MarketDesk core flow: publish a product to OLX (sandbox) and open its product card';

// Acceptance criterion -> where the video shows it.
export const covers = {
  'CUT-1 (four destinations; Products is the landing page)': 'chapter 1: the menu and the empty catalogue',
  'CORE-1 (a product is created in the six-step wizard, with photos, and OLX is the only marketplace offered)':
    'chapter 2: the wizard from Photos to Review',
  'CORE-2 (publication needs an explicit confirmation with an exact OLX category)':
    'chapter 3: the publication review',
  'CORE-3 (the listing goes Live and is labelled Sandbox)': 'chapter 4: the product card after publishing',
  'CORE-4 (the product card shows the gallery, price and margin, the OLX listing and the timeline)':
    'chapter 4: the product card, top to bottom',
  'CORE-5 (the published product is Active in the catalogue)': 'chapter 5: the catalogue',
};

// Behavior the video does not show, with the reason.
export const notShown = [
  'Connecting the OLX sandbox account: done once before the recording (one button on the Marketplaces page)',
  'A real OLX advert: the stand runs the OLX sandbox, which makes no call to OLX',
  'Hermes suggestions and their approval: outside this demo; without a Hermes server they come from offline heuristics and wait for review',
  'The removed screens and endpoints (Dashboard, Analytics, Listings, notification settings, import): gone from the interface, so there is nothing to film',
  'Sales and buyer messages: the sandbox has none',
];

// Open product questions for the reviewer.
export const questions = [
  'The publication review opens by itself right after a product is created. Is that the wanted first step toward autopilot, or should creation end on the product card?',
  'Views, watchers and messages read "Unknown" on a fresh listing until the first sync. Should the product card hide them until there is data?',
  'The listing SEO agent has no settings screen any more (it can be switched only through the API). Is that acceptable until the autopilot loop is built?',
];

const PRODUCT = {
  name: 'Vintage 35mm film camera',
  sku: 'CAM-35MM-001',
  description:
    'Fully working 35mm film camera with a 50mm lens. Light wear on the body. Comes with the original leather case and strap.',
  cost: '100',
  price: '150',
};

export async function steps({ page, kit }) {
  const next = () => page.getByRole('button', { name: 'Next', exact: true }).click();

  // Chapter 1
  await kit.chapter('The workspace', 'Four destinations; Products is the landing page');
  await kit.caption('MarketDesk opens on Products. The menu has four destinations: Products, Hermes AI, Marketplaces and Settings.');
  await kit.shot('01-catalogue-empty');

  // Chapter 2
  await kit.chapter('Create a product', 'Six steps, photos first');
  await page.getByRole('button', { name: 'New product' }).click();
  await page.getByRole('dialog').waitFor();
  await kit.caption('A product is created in six steps. Photos come first: the first photo becomes the cover.');
  await page.locator('input[type=file]').first().setInputFiles([kit.fixture('camera-front.png'), kit.fixture('camera-angle.png')]);
  // The counter on the button is the sign that both uploads have finished.
  await page.getByRole('button', { name: 'Add photos (2/12)' }).waitFor({ timeout: 20000 });
  await kit.hold(1500);
  await next();

  await kit.caption('Basic info: a name, a SKU and a description for buyers.');
  await page.getByLabel('Name').first().fill(PRODUCT.name);
  await page.getByLabel('SKU').fill(PRODUCT.sku);
  await page.getByLabel('Description').fill(PRODUCT.description);
  await kit.hold(1200);
  await next();

  await kit.caption('Pricing: the cost and the selling price. The margin is calculated from them.');
  await page.getByLabel('Cost price').fill(PRODUCT.cost);
  await page.getByLabel('Selling price').fill(PRODUCT.price);
  await kit.hold(1200);
  await next();

  await kit.caption('Category: one of six product categories.');
  await page.getByRole('button', { name: 'Electronics' }).or(page.getByRole('radio', { name: 'Electronics' })).first().click();
  await kit.hold(800);
  await next();

  await kit.caption('Marketplaces: OLX is the only marketplace offered.');
  await page.getByRole('radio').first().check();
  await kit.hold(800);
  await next();

  await kit.caption('Review: the summary shows the price, the margin and the target marketplace.');
  await kit.shot('02-wizard-review');
  await page.getByRole('button', { name: 'Create product' }).click();

  // Chapter 3
  await kit.chapter('Publish to OLX (sandbox)', 'Nothing is published without a confirmation');
  const review = page.getByRole('dialog').filter({ hasText: 'Publication review' });
  await review.waitFor({ timeout: 20000 });
  await kit.caption('The product is saved and the publication review opens. Nothing is published yet.');
  await page.getByLabel('Search OLX categories').fill('Cameras');
  await page.getByRole('button', { name: 'Find categories' }).click();
  const cameras = page
    .getByRole('button', { name: /Cameras/i })
    .or(page.getByRole('radio', { name: /Cameras/i }))
    .or(page.getByRole('option', { name: /Cameras/i }))
    .first();
  await cameras.waitFor({ timeout: 15000 });
  await cameras.click();
  await kit.caption('The seller picks the exact OLX category. The sandbox has a small built-in category list.');
  await kit.shot('03-publication-review');
  await page.getByRole('button', { name: 'Confirm category and queue publish' }).click();
  await page.getByText('Publication was accepted and queued.').waitFor({ timeout: 20000 });
  await kit.caption('Publication is accepted and runs in the background.');

  // Chapter 4
  await kit.chapter('The product card', 'A live listing with the Sandbox label');
  const live = page.getByText('Live', { exact: true }).first();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.reload();
    await page.getByText(PRODUCT.name).first().waitFor({ timeout: 15000 });
    if (await live.isVisible().catch(() => false)) break;
    await kit.hold(2000);
  }
  await live.waitFor({ timeout: 5000 });
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await kit.caption('A moment later the listing is Live. The Sandbox label marks a stand-in advert: no call to OLX is made.');
  await kit.shot('04-product-card-top');
  await page.getByText('Marketplace listings').first().scrollIntoViewIfNeeded();
  await kit.caption('The product card shows the photos, the price and margin, and the OLX listing with its status.');
  await kit.shot('05-product-card-listing');
  // The timeline is the last block of the page: scroll to the end, show the caption, then
  // clear it so the lowest entries are not covered when the shot is taken.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  await kit.caption('The timeline records what happened: the product was created and the listing was published.', 3000);
  await kit.caption('');
  await kit.hold(2000);
  await kit.shot('06-product-card-timeline');

  // Chapter 5
  await kit.chapter('The catalogue', 'The product is Active');
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.getByRole('button', { name: /Back to products/i }).or(page.getByRole('link', { name: /Back to products/i })).first().click();
  await page.getByText(PRODUCT.name).first().waitFor({ timeout: 15000 });
  await kit.caption('Back in the catalogue the product is Active, with its cover photo and price.');
  await kit.shot('07-catalogue');
  await kit.caption('');
}
