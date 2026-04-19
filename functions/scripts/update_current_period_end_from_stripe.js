#!/usr/bin/env node
// Wrapper so the backfill script in repository root can be invoked from
// the `functions/` directory (keeps single source in `scripts/`).
require('../../scripts/update_current_period_end_from_stripe.cjs');
