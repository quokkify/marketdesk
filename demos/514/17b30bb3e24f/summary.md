# PR 514: one Hermes card and its drawer on the product page

Video: https://github.com/quokkify/marketdesk/raw/demos/demos/514/17b30bb3e24f/demo.mp4
Commit: `17b30bb3e24f`
Duration: 2:05

### Shown
- Rail: price card, Statistics, one Hermes card ("Not analysed", "Analyze product"); the four old cards are gone: step 1
- Analyze product: the chip counts the steps, the rows fill in, the lead sentence and the provider note: step 2
- Price row names the market prices it used; Market prices row opens the drawer with the four figures, the prices found by kind and why no estimate is suggested: step 3
- "Your prices": add a price, Search again, the price is still there: step 4
- Checks tab: the three checks with reasons and the publication readiness check moved here: step 5
- Suggestions tab shows the suggestion of the analysis (not applied): step 6
- Log and history: newest run open with its steps; the earlier search and the suggestion as own entries: step 7
- Drawer closes; the card and the "Hermes: N things to fix" hint on the price card: step 8

### Open questions
- The Price row says "Needs you" while the Price check only says the research is too weak to judge the price. Is "Needs you" the intended status when Hermes simply cannot judge?
- With confidence "low" the drawer shows Start price and Floor (both 202,65 zł) yet says "Not suggested: confidence is low". Should the figures be hidden or greyed out when they are not suggested?
- The lead sentence is the first failing check (category). Should the lead rather point at the most important fix (for example, no photos)?

### Not shown
- A "Set price to …" primary action: the demo stand has no Hermes model behind the main profile, and the offline estimate never proposes a price
- A result from the real Hermes model: only the market search is answered (by a mock with recorded, synthetic answers); the checks use the offline heuristics, as the provider note says
- Applying the title suggestion: it would rename the product mid-demo; the suggestion flow itself is unchanged by this PR
- Phone and tablet layouts of the card and the drawer (the video is desktop only; screenshots at 1024 and 390 px are attached to the prep report)
