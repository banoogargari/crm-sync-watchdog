// Loads one scenario: the exports from each system, as local JSON files.
// In production these would come from the Marketo, Salesforce, billing and
// ad-platform APIs in the same shape.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SCENARIOS_DIR = new URL('../../evals/scenarios/', import.meta.url).pathname;

export const listScenarios = () => readdirSync(SCENARIOS_DIR).sort();

export function loadScenario(name, dir = SCENARIOS_DIR) {
  const read = (f) => JSON.parse(readFileSync(join(dir, name, f), 'utf8'));
  return {
    accounts: read('accounts.json'),
    contacts: read('contacts.json'),
    mapCampaigns: read('map_campaigns.json'),
    mapMembers: read('map_members.json'),
    crmCampaigns: read('crm_campaigns.json'),
    crmMembers: read('crm_members.json'),
    aba: read('aba_engagement.json'),
    buyingStages: read('buying_stages.json'),
    spend: read('program_spend.json'),
    opportunities: read('opportunities.json'),
    stageHistory: read('opportunity_stage_history.json'),
    subscriptions: read('subscriptions.json'),
    truth: read('ground-truth.json'),
  };
}
