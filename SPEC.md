# CRM Sync Watchdog — Spec

**Status:** v0.1 · **Author:** Banoo Gargari · **Last updated:** 2026-10-11

## 1. The problem

A CMO reports **marketing-sourced pipeline and ARR** to the board, split into **new logo** and **expansion**, to show what the marketing team delivered.

Those numbers come from the CRM. Each opportunity is credited to the **last marketing activity** its contact had before the opportunity was created. But marketing engagement lives in a **different system**, the marketing automation platform, and the two don't always stay in sync. When they drift apart, opportunities show **no marketing source**, analysts spend days digging, and the board sees a smaller marketing number than the real one.

Five things break it in practice:

| # | What breaks | Example |
|---|---|---|
| 1 | **Campaign never synced** to the CRM | A webinar is built in the marketing tool but never connected to a CRM campaign. Nobody in the CRM knows it happened. |
| 2 | **Success status not synced** | The marketing tool says "Attended," the CRM still says "Registered," so the activity doesn't count. |
| 3 | **UTM dropped on the form fill** | Someone at a target account clicks a LinkedIn or 6sense ABM ad and fills out the form, but the UTM doesn't come through. The form fill has no source. |
| 4 | **Duplicate contacts** | The marketing activity is on one contact record, the opportunity on another. |
| 5 | **Opportunity with no contact** | Sales creates the opportunity without adding a contact role, so there is no person to trace back. |

And one money problem:

| 6 | **Opportunity amount ≠ subscription** | The opportunity says $24K, billing charges $20.4K. The subscription is correct. |

## 2. Goal

**Phase 1:** an agent that reconciles the marketing tool, the CRM and billing; finds each broken link; measures how many opportunities and how much pipeline and ARR it affects; proposes fixes; and produces a report that marks every number as trusted or not, with the reason.

**Phase 2:** a chat where a CMO or analyst asks questions in plain words ("Was Q3 better than Q2?", "How much pipeline did events create?") and gets answers computed from the data, with a warning whenever an answer depends on broken data.

Guiding principle: **an agent reporting confidently on bad data is worse than no agent.** Code computes every number. The AI investigates, explains and decides what can be trusted, and a verifier rejects any answer with a number that isn't in the data.

### Success criteria (phase 1)

| Metric | Target |
|---|---|
| Planted problems detected | ≥ 90% |
| False alarms per scenario | ≤ 1 |
| Pipeline / ARR impact of each problem | exactly matches the answer key |
| Channels affected by a problem but shown as trusted ✅ | **0** |
| Numbers in the report not traceable to a tool result | **0** |
| No-UTM form fills sorted into the right group (1–4) | ≥ 90% |
| Influenced opportunities and pipeline per program (including ABA) | exactly match the answer key |
| ABM hint accuracy (how often the suggested channel is the true one) | measured and shown in the results, target ≥ 70%. Hints are never added to the numbers, whatever their accuracy |
| Clean scenario | "no issues found," all channels ✅ |

## 3. The systems and what each one is the truth for

The code uses generic names, so it works for any combination (e.g. Marketo → Salesforce, HubSpot → Salesforce).

| System | Holds | Source of truth for |
|---|---|---|
| **Marketing automation** (e.g. Marketo) | Campaigns, campaign members, statuses, form fills with UTMs | **What marketing activity happened** |
| **CRM** (e.g. Salesforce) | Accounts, contacts, CRM campaigns and members, opportunities, contact roles | **Opportunities** and **what is reported** today |
| **Billing** (any vendor) | Subscriptions | **The real ARR amount** |
| **ABM platforms** (e.g. LinkedIn, 6sense) | Ad impressions and clicks **per account** (not per person) | Nothing. **Hints only.** |

## 4. Attribution: last marketing activity

An opportunity's **channel** is the channel of the **last marketing activity** of its **primary contact** on or before the day the opportunity was created.

- A **marketing activity** is a CRM campaign member with a **success status** (e.g. Attended, Responded, Clicked, Submitted).
- The **channel** comes from the campaign (Event, Webinar, LinkedIn, 6sense, Paid Search, Email). For website form campaigns, it comes from the form fill's **UTM source**; no UTM means **No source**.
- Activities after the opportunity was created don't count.

"**As reported today**" uses only what the CRM knows. "**If fixes are approved**" uses what the marketing tool knows too (synced campaigns and statuses) plus duplicate merges. Problems 3 and 5 can't be fixed automatically, so those stay "No source."

## 5. The checks

Each check is plain code that returns facts. The agent calls the checks as tools.

| # | Check | How it's detected | Effect | Proposed fix |
|---|---|---|---|---|
| C1 | **Campaign not synced** | Campaigns in the marketing tool with no linked CRM campaign | Opportunities whose real last activity was in that campaign show No source or an older, wrong channel | "Sync campaign X"; list of affected opportunities |
| C2 | **Success status not synced** | Members with a success status in the marketing tool but a non-success status in the CRM | Same as C1, member by member | Status update list |
| C3 | **UTM dropped on form fill** | The last activity is a website form fill with no UTM; also a sudden rise in form fills without UTM from a date | Opportunity shows No source | Each no-UTM form fill is **sorted by its clues** (below), so a dropped paid click is told apart from a real organic visit. Investigate the form or tracking for dropped ones |
| C4 | **Duplicate contacts** | Same email after normalizing case and +tags | The activity is on one record, the opportunity on the other | Merge list (keep the record with the activities) |
| C5 | **Opportunity with no contact** | No contact role on the opportunity | No person to trace, so No source | Suggested contact from the same account, marked "needs review" |
| C6 | **Amount ≠ subscription** | Opportunity amount vs. billed ARR for the account | Pipeline/ARR over- or under-stated | Mismatch list with both amounts |

### Sorting form fills with no UTM (C3)

The same website form is used by people who clicked an ad and by people who found the site on their own. When the UTM is missing, the hidden fields on the form tell them apart:

| Group | Clues | Meaning | Counted as |
|---|---|---|---|
| **1. Dropped UTM, paid click** | A click ID is present (`gclid` = Google Ads, `li_fat_id` = LinkedIn), or the landing page is a paid-only page | The person clicked an ad; the UTM was lost. A tracking problem to fix. | Proposed fix: the click ID's channel (e.g. `gclid` → Paid Search), marked "needs review" |
| **2. Likely ABM** | No click ID, but the account had ≥ 3 ABM ad clicks (LinkedIn / 6sense) in the 14 days before | Someone at a target account was engaging with ads. **ABM hint.** | Hint only, needs review |
| **3. Likely organic search** | Referrer is a search engine, no click ID | A real organic visit, not a tracking problem | Organic (not an issue) |
| **4. Direct / unknown** | No referrer, no click ID, no ad engagement | Typed the URL or a bookmark | Stays No source |

So instead of "$300K has no source," the report can say "$180K were paid clicks that lost their UTM, $70K look organic, $50K are truly unknown."

The agent never moves a dollar on its own: groups 1 and 2 are proposals for a person to approve.

## 6. Influenced opportunities by program, including account-based advertising (ABA)

**The gap:** for **person-based programs** (content syndication, person-based ads, webinars, events), analysts can report how many opportunities a program **influenced**, because the people are in the CRM as campaign members. **Account-based advertising** (LinkedIn ABA, 6sense) works on **accounts**: the platforms know that an account saw and clicked the ads, but not which person did.

- If the person who clicked **has the marketing tool's tracking cookie and fills out a form**, they become a contact in the CRM and their click is credited to the program. ✅ Trackable.
- If they **don't have the cookie, or never fill out a form**, the engagement exists **only in the ad platform, at the account level**, and never reaches the CRM. ❌ Not trackable.

The second group is usually most of the engagement. So in a QBR, ABA shows little or no influence, even though real money was spent on it. This project adds the second group back by matching on the **account** instead of the person.

**The approach:** one influence report for **every program**, with ABA measured the same way as the others.

| Program type | An opportunity is influenced by the program if… | Data used |
|---|---|---|
| **Person-based** | a **contact** on the opportunity had a success activity in the program within **90 days before** the opportunity was created | CRM campaign members (plus marketing-tool members for unsynced ones, in the "if fixes are approved" view) |
| **Account-based** | the opportunity's **account** engaged with the program's ads (impressions, clicks, asset views) within **90 days before** the opportunity was created | Ad platform exports, matched to CRM accounts by account ID or website domain |

Example report:

| Program | Type | Influenced opps | Influenced pipeline | Spend | Cost per influenced opp |
|---|---|---|---|---|---|
| Content syndication | person-based | 22 | $610,000 | $40,000 | $1,818 |
| Webinars | person-based | 18 | $480,000 | $12,000 | $667 |
| **LinkedIn ABA** | **account-based** | **14** | **$380,000** | $55,000 | $3,929 |
| **6sense** | **account-based** | **17** | **$455,000** | $60,000 | $3,529 |

One opportunity can be influenced by several programs, so the rows don't add up to a total.

**Also shown for ABA:** engaged target accounts per platform, 6sense buying-stage movement (Target → Awareness → Consideration → Decision → Purchase), and a list of target accounts that engaged but have no opportunity yet (useful for sales).

**Honesty rules**

- **Influenced is not sourced.** Influence is never added to marketing-sourced pipeline or ARR (section 4), so nothing is counted twice.
- Influence **shows interest; it doesn't prove the program caused the opportunity.** Accounts that are already interested also engage more. The report says so, compares **engaged vs. non-engaged target accounts**, and suggests a **holdout group** (target accounts deliberately not shown ads) to measure real lift.
- When someone from an engaged account fills out a form, that's a normal person-based activity; if the form fill lost its UTM, the C3 ABM hint applies.

## 7. Metrics (data in phase 1, asked in chat in phase 2)

All by **quarter**, by **channel** and by **new logo / expansion**:

- **MQLs**: contacts who raised their hand to talk to sales (e.g. a contact-sales or demo request), counted on the MQL date
- **Opportunities created** and **pipeline created** (sum of amount of opportunities created in the quarter)
- **Closed won**: count and ARR (closed in the quarter)
- **Win rate**: won ÷ (won + lost) for opportunities closed in the quarter
- **Average deal size** and **sales cycle** (days from created to closed)
- **Quarter-over-quarter change** for each

Every metric can be shown **as reported today** and **if fixes are approved**, with the issues that affect it.

**Influence metrics** (section 6), per program, person-based and account-based alike: influenced opportunities, influenced pipeline, spend, cost per influenced opportunity; plus for ABA engaged accounts and buying-stage movement.

## 8. Data

Synthetic, generated by a seed script, covering **Q4 2025 – Q3 2026** plus **Q4 2026 in progress** (today is October 2026).

| File | Contents |
|---|---|
| `accounts.json` | id, name, domain, aba_target (and which platforms target it) |
| `contacts.json` | id, account_id, email, name, createdate, mql_date |
| `map_campaigns.json` | marketing-tool campaigns: id, name, channel, type, crm_campaign_id (empty if not synced) |
| `map_members.json` | campaign id, email, status, is_success, activity_date; for form fills also utm_source/campaign, referrer, landing_page, gclid, li_fat_id |
| `crm_campaigns.json` | id, name, channel |
| `crm_members.json` | campaign id, contact id, status, is_success, activity_date; for form fills the same UTM and hidden fields |
| `aba_engagement.json` | account id, platform (linkedin / 6sense), campaign, date, impressions, clicks, asset views |
| `buying_stages.json` | 6sense buying stage per account over time: account id, date, stage |
| `program_spend.json` | program, month, spend (for every program, so cost per influenced opportunity can be compared) |
| `opportunities.json` | id, account id, name, type (new_logo / expansion), amount (ARR), stage, createdate, closedate, contact_roles |
| `subscriptions.json` | id, account id, customer email, amount, interval, status, start_date |

**Opportunity stages** (default, can be changed): Discovery → Demo → Proposal → Negotiation → Closed Won / Closed Lost.

**Test scenarios** each come with an answer key (`ground-truth.json`): `clean`, one scenario per problem (6), `everything`, and `subtle`. Each has a story behind it, e.g. "the Q3 Customer Summit never synced," or "from Aug 14, the contact-sales form drops UTMs."

## 9. Phase 1 output: the report

- **Pipeline and ARR by channel**, for the quarter: as reported today vs. if fixes are approved, ✅/⚠️ per channel, split into new logo and expansion.
- **Issues**: what broke, since when, how many opportunities, how much pipeline/ARR, the proposed fix, and "needs review" where a person must decide.
- **ABM hints** listed separately, never added to the numbers.
- **Influenced opportunities by program** (section 6): person-based and account-based programs in one table, with spend and cost per influenced opportunity, ABA engagement and stage movement, and the engaged vs. non-engaged comparison.
- **Fix files**: campaigns to sync, statuses to update, merge list, opportunities missing contacts, billing mismatches.
- HTML (published example) + Markdown.

## 10. Phase 2: the chat

- A web page with a question box. Examples: "How many opportunities did we close in Q3?", "Was Q3 better than Q2?", "How much pipeline did 6sense create this year?", "How many MQLs from events in Q2 vs Q3?", "How many opportunities did LinkedIn ABA influence in Q3, compared with content syndication?", "Which target accounts engaged with ads but have no opportunity yet?" (a list for sales)
- Claude answers by calling **metric tools** (plain code). The **verifier** checks every number in the answer before it's shown.
- When a metric is affected by a sync problem, the answer says so: *"Events pipeline in Q3 is likely understated: the Customer Summit campaign never synced (4 opportunities, $96,000)."*
- Deployed online with an **access code** and a **monthly spending limit** on the API key.

## 11. Phase 3 (later)

Forecasting with a range (low / expected / high), computed by code; renewal dates and churn risk (contracts that start at different times); first-touch and multi-touch views.

## 12. Definitions

- **MQL:** a contact who asked to talk to sales (hand-raiser), on the date of that request.
- **Opportunity created:** the date sales created the opportunity.
- **Pipeline created (quarter):** sum of `amount` of opportunities created in the quarter.
- **Closed won ARR (quarter):** sum of `amount` of opportunities moved to Closed Won in the quarter. Billing is checked against it (C6).
- **New logo:** first opportunity won with an account. **Expansion:** any later won opportunity with an existing customer.
- **Marketing-sourced:** the opportunity's last marketing activity before creation exists and has a channel.
- **Engaged account (ABA):** a target account with ad impressions, clicks or asset views on a platform in the period.
- **Influenced opportunity:** an opportunity whose contact (person-based programs) or account (account-based programs) engaged with a program within 90 days before the opportunity was created. Shows interest, not cause; never added to marketing-sourced numbers.
- **Trusted ✅:** no open problem affects the number. **⚠️:** at least one does, with a link to it.

## 13. Plan

| Step | Work |
|---|---|
| 1 | Spec (this document) |
| 2 | Data generator: several quarters, 6 planted problems, answer keys |
| 3 | Attribution + 6 checks + metrics, with tests against the answer keys |
| 4 | Agent, verifier, report (reused from the marketing-data-watchdog project) |
| 5 | Eval on all scenarios; README; published example report |
| 6 | Phase 2: chat + deployment |

## 14. Open questions

- Opportunity stages are a default; to be confirmed.
- ABM hint window (14 days before the form fill) and minimum clicks (≥ 3) are defaults; to be tuned.
- Influence window: 90 days before the opportunity was created, the same for person-based and account-based programs (confirmed as a fit for the sales cycle).
- 6sense buying stages use 6sense's common names; to be confirmed.
