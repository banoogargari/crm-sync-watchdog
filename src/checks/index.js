// Runs everything the report needs for one quarter.
import { buildIndex, revenueByChannel } from '../attribution.js';
import { checkUnsyncedCampaigns } from './unsynced-campaigns.js';
import { checkStatusMismatch } from './status-mismatch.js';
import { checkUtmDropped } from './utm-dropped.js';
import { checkDuplicates } from './duplicates.js';
import { checkNoContactRole } from './no-contact-role.js';
import { checkAmountMismatch } from './amount-mismatch.js';

export function runChecks(data, quarter) {
  const idx = buildIndex(data);
  const checks = {
    C1: checkUnsyncedCampaigns(data, idx, quarter),
    C2: checkStatusMismatch(data, idx, quarter),
    C3: checkUtmDropped(data, idx, quarter),
    C4: checkDuplicates(data, idx, quarter),
    C5: checkNoContactRole(data, idx, quarter),
    C6: checkAmountMismatch(data, idx, quarter),
  };
  return {
    quarter,
    checks,
    revenue: {
      reported: revenueByChannel(data, idx, quarter, 'reported'),
      if_fixes_approved: revenueByChannel(data, idx, quarter, 'if_fixes_approved'),
    },
    idx,
  };
}
