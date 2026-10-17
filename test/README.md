# Test separation

`fixtures.js` supplies explicitly synthetic passages to HTTP contract tests so tests for provider failures, locks, and exports are fast and deterministic. These fixtures are not the application corpus.

`rag.test.js` independently validates the actual downloaded PDF checksums, passage-to-page correspondence, 384-dimensional normalized vectors, and offline semantic searches against all four real documents. Real-corpus checks are skipped only on a fresh clone before corpus setup. They must run without skips when preparing the professor demonstration.
