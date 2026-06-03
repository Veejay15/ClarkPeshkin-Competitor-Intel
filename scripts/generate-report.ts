import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { Competitor, CompetitorsData } from '../lib/types';
import { fetchSitemap, isListingNoise } from '../lib/sitemap';

const ROOT = process.cwd();
const TODAY = new Date().toISOString().split('T')[0];

const CLIENT_SITEMAP_URL = 'https://clarkpeshkin.com/sitemap.xml';
const CLIENT_NAME = 'Clark Peshkin';
const CLIENT_DOMAIN = 'clarkpeshkin.com';
const BACKLINK_DAYS = Number(process.env.SERANKING_BACKLINK_DAYS || 30);

interface DiffEntry {
  url: string;
  lastmod?: string;
}
interface CompetitorDiff {
  competitorId: string;
  newUrls: DiffEntry[];
  removedUrls: DiffEntry[];
  updatedUrls: DiffEntry[];
}
interface DiffData {
  date: string;
  previousDate: string | null;
  diffs: CompetitorDiff[];
}

interface CsvSummary {
  filename: string;
  competitorId: string;
  type: string;
  rowCount: number;
  topRows: Record<string, string>[];
}
interface CsvSummariesData {
  date: string;
  summaries: CsvSummary[];
}

function loadDiffs(): DiffData | null {
  const p = path.join(ROOT, 'data', 'diffs', `${TODAY}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function loadCsvSummaries(): CsvSummariesData | null {
  const p = path.join(ROOT, 'data', 'csv-summaries', `${TODAY}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function loadCompetitors(): Competitor[] {
  const p = path.join(ROOT, 'data', 'competitors.json');
  const data: CompetitorsData = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return data.competitors.filter((c) => c.active);
}

async function fetchClientPages(): Promise<string[]> {
  try {
    console.log(`Fetching ${CLIENT_NAME}'s own sitemap for cross-reference...`);
    const entries = await fetchSitemap(CLIENT_SITEMAP_URL);
    const paths = entries
      .map((e) => e.url)
      .filter((url) => !isListingNoise(url))
      .map((url) => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })
      .filter((p, i, arr) => arr.indexOf(p) === i)
      .sort();
    console.log(`  Found ${paths.length} content pages on ${CLIENT_DOMAIN}`);
    return paths;
  } catch (err) {
    console.warn(`  Could not fetch ${CLIENT_NAME} sitemap: ${(err as Error).message}`);
    return [];
  }
}

async function generateForCompetitor(
  client: Anthropic,
  competitor: Competitor,
  diff: CompetitorDiff | null,
  csvs: CsvSummary[],
  clientPages: string[],
  previousDate: string | null
): Promise<{ markdown: string; inputTokens: number; outputTokens: number }> {
  const dataPayload = {
    date: TODAY,
    previousDate,
    competitor: {
      id: competitor.id,
      name: competitor.name,
      domain: competitor.domain,
    },
    clientExistingPages: clientPages,
    sitemapDiff: diff || { newUrls: [], removedUrls: [], updatedUrls: [] },
    csvData: csvs,
  };

  const systemPrompt = `You are a senior SEO analyst preparing a focused weekly competitor intelligence report for ${CLIENT_NAME}, a divorce, family law, and estate planning firm with offices in Rochester, Buffalo, and Syracuse, NY. Practice areas include divorce and custody, mediation, collaborative divorce, child and spousal support, estate planning (wills, trusts, powers of attorney, healthcare directives, Medicaid planning), estate administration and probate, and real estate closings.

This report covers ONE competitor: ${competitor.name} (${competitor.domain}).

Tone: confident, direct, no fluff. No emojis. No em dashes (use periods, commas, parentheses, or "and/but" instead).

Structure:
1. Executive Summary (2 to 4 bullet points, what this competitor did this week and what to do about it)

2. New Pages Built by ${competitor.name}
   ALWAYS render this section as a markdown table with exactly two columns: "URL" and "Inferred Target".
   - URL column: the full URL wrapped in backticks (inline code) so it renders monospace.
   - Inferred Target column: 1 to 3 short sentences. Identify what the page targets (practice area, location, audience), and state plainly whether the topic overlaps with ${CLIENT_NAME}'s practice areas or sits outside them. Examples of helpful framings: "Direct overlap with [practice area]", "Adjacent to [practice area], minor threat", "Outside ${CLIENT_NAME}'s practice areas, no action needed".
   After the table, you may include a single bold "Notable observation:" paragraph (no more than 2 sentences) if there is a pattern worth flagging (e.g., hiring posts that signal scaling). If there are no new pages, write a single line "No new pages built this week." instead of a table.

3. Backlink Movements
   ALWAYS include this section. If a "backlinks" entry exists in csvData with rowCount > 0, render a markdown table with exactly five columns: "Referring Page", "Anchor", "DA", "Type", "Nofollow".
   - Referring Page: the source_page URL wrapped in backticks. If source_page_title exists, append it after the URL on a new line in italics like *(Title)*.
   - Anchor: the anchor text in plain text. If empty or null, write "(no anchor)".
   - DA: the domain_authority number as a plain integer.
   - Type: classify each link as one of: Press / news, Industry directory, Local citation, Partner / referral, Spam / low-quality, or Other (use your judgement).
   - Nofollow: "Yes" or "No".
   Sort by DA descending. Cap the table at 15 rows. After the table, include 1 short paragraph flagging the most authoritative links and any spam patterns.
   If the entry is present but rowCount is 0, write a single line: "No new backlinks discovered by SE Ranking in the last ${BACKLINK_DAYS} days."
   Only skip the section entirely if no "backlinks" entry exists in csvData at all.

4. Keyword and Ranking Changes
   ALWAYS include this section. If a "positions" entry exists in csvData with rowCount > 0, render a markdown table with exactly six columns: "Keyword", "Position", "Previous", "Change", "Volume", "URL".
   - Keyword: plain text.
   - Position: current position as integer.
   - Previous: previous_position as integer, or "—" if it's a new entry.
   - Change: the position_change value verbatim ("new", "+5", "-3", "0").
   - Volume: search_volume as integer.
   - URL: the ranking url wrapped in backticks. If too long, truncate display to the path and put the full URL in the link.
   Pick rows that matter: (a) keywords with position_change "new" entering at or near page 1 (position <= 20), (b) the 5 biggest positive movers (largest +N), (c) the 5 biggest negative movers (largest -N), (d) any keyword with search_volume >= 1000 and position <= 10. Cap the table at 15 rows total. Sort by absolute Change descending. After the table, write 1 short paragraph noting which of these keywords actually overlap with ${CLIENT_NAME}'s practice areas (the rest are noise for our purposes).
   If the entry is present but rowCount is 0, state that explicitly.
   Only skip entirely if no "positions" entry exists in csvData.

5. Recommended Actions for ${CLIENT_NAME}
   A numbered list of 3 to 6 specific, immediately actionable moves in response to ${competitor.name}'s activity this period. Every recommendation MUST stay inside ${CLIENT_NAME}'s actual practice areas (see HARD RULE below).

HARD RULE ON RECOMMENDATIONS (NON-NEGOTIABLE):
${CLIENT_NAME} ONLY offers the following services. Every recommendation must fall inside this list:
- Divorce: contested, uncontested, mediation, collaborative
- Custody and visitation disputes
- Child support and spousal support / maintenance
- Domestic violence orders of protection
- Paternity
- Estate planning: wills, trusts, powers of attorney, healthcare directives / advance directives, Medicaid planning
- Estate administration: probate, trust administration, contested estates
- Real estate closings (residential, in their NY service areas)

${CLIENT_NAME} does NOT offer (do NOT recommend any work, page, or content related to these):
- Property management or landlord services
- Landlord-tenant litigation, eviction defense / notices, lease disputes
- Personal injury, medical malpractice, wrongful death
- Criminal defense, DWI, traffic
- Bankruptcy or debt relief
- Immigration (visas, green cards, asylum, deportation)
- Employment law (discrimination, wrongful termination, federal employment, security clearance)
- Education law, special education, student discipline
- Tax law, IRS disputes
- Business / corporate transactions (M&A, formation, contracts) beyond residential real estate closings
- Liquor licensing, retail / hospitality regulatory work
- Intellectual property
- Civil rights, class actions

If a competitor builds pages, earns links, or ranks for keywords in any of the "does NOT offer" categories above, your recommendation for that activity is: "No action. Outside ${CLIENT_NAME}'s practice areas." Do NOT pivot it into a stretch recommendation. The goal is to surface competitor activity that genuinely overlaps with ${CLIENT_NAME}'s services. If 100% of the competitor's activity this period is outside ${CLIENT_NAME}'s practice areas, say so plainly and recommend monitoring only.

CROSS-REFERENCE RULE FOR IN-SCOPE RECOMMENDATIONS:
Before recommending that ${CLIENT_NAME} build any new page (practice area page, location/city/county page, attorney bio, FAQ, blog topic, resource page, etc.), you MUST cross-reference the "clientExistingPages" list in the data payload. That list contains every content URL path that currently exists on ${CLIENT_DOMAIN}.
- If ${CLIENT_NAME} ALREADY has an equivalent page, do NOT recommend building it. Instead, you may recommend updating, expanding, or strengthening that existing page (and reference the existing URL).
- If ${CLIENT_NAME} does NOT have an equivalent page, you may recommend building it as a genuine content gap.
- When in doubt, search the list for keywords (e.g., a city or county name like "rochester", "buffalo", "syracuse", "monroe", "erie", "onondaga", or a topic like "divorce", "custody", "child-support", "mediation", "will", "trust", "probate", "medicaid") to check before suggesting a new build.
- Acceptable equivalence checks: URL path contains the location/topic AND the practice area intent. Slight wording differences are fine (e.g., "uncontested-divorce" vs "no-fault-divorce").

Do not invent data. Never recommend a page ${CLIENT_NAME} already has. Keep this report focused and specific to ${competitor.name} only, do not discuss other competitors.`;

  const userPrompt = `Here is this week's data for ${competitor.name} for the report dated ${TODAY}.

${diff ? '' : '(No sitemap diff available for this competitor this week.)'}
${csvs.length === 0 ? '(No SEMrush CSV data uploaded for this competitor this week.)' : ''}
${clientPages.length === 0 ? `(Warning: could not fetch ${CLIENT_NAME} existing pages this run. Be extra careful recommending new pages.)` : `(${CLIENT_NAME}'s existing ${clientPages.length} content pages are listed in "clientExistingPages" for cross-reference.)`}

DATA:
${JSON.stringify(dataPayload, null, 2)}

Write the full report in markdown. Start with a top-level H1 like "# ${competitor.name}: Week of ${TODAY}".`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text in Claude response');
  }
  return {
    markdown: textBlock.text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  const competitors = loadCompetitors();
  if (competitors.length === 0) {
    console.log('No active competitors. Skipping report generation.');
    process.exit(0);
  }

  const diffs = loadDiffs();
  const csvSummaries = loadCsvSummaries();
  const clientPages = await fetchClientPages();

  if (!diffs && !csvSummaries) {
    console.log('No data to report on. Run fetch-sitemaps and process-csvs first.');
    process.exit(0);
  }

  const client = new Anthropic({ apiKey });
  const reportsDir = path.join(ROOT, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  let totalInput = 0;
  let totalOutput = 0;
  const succeeded: string[] = [];
  const failed: string[] = [];

  for (const competitor of competitors) {
    console.log(`\nGenerating report for ${competitor.name}...`);
    const diff = diffs?.diffs.find((d) => d.competitorId === competitor.id) || null;
    const csvs = csvSummaries?.summaries.filter((s) => s.competitorId === competitor.id) || [];

    try {
      const result = await generateForCompetitor(
        client,
        competitor,
        diff,
        csvs,
        clientPages,
        diffs?.previousDate || null
      );
      const filename = `${TODAY}-${competitor.id}.md`;
      const outPath = path.join(reportsDir, filename);
      fs.writeFileSync(outPath, result.markdown);
      console.log(`  ✓ Saved ${outPath}`);
      console.log(`    Tokens: input ${result.inputTokens}, output ${result.outputTokens}`);
      totalInput += result.inputTokens;
      totalOutput += result.outputTokens;
      succeeded.push(competitor.name);
    } catch (err) {
      console.error(`  ✗ Failed: ${(err as Error).message}`);
      failed.push(competitor.name);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Succeeded: ${succeeded.length} (${succeeded.join(', ') || 'none'})`);
  console.log(`Failed: ${failed.length} (${failed.join(', ') || 'none'})`);
  console.log(`Total tokens: input ${totalInput}, output ${totalOutput}`);

  if (succeeded.length === 0) {
    console.error('All competitor reports failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
