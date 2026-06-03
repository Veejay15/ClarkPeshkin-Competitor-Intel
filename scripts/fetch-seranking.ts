import fs from 'fs';
import path from 'path';
import { Competitor, CompetitorsData } from '../lib/types';
import {
  BacklinkEntry,
  KeywordEntry,
  fetchNewBacklinks,
  fetchTopOrganicKeywords,
} from '../lib/seranking';

const ROOT = process.cwd();
const TODAY = new Date().toISOString().split('T')[0];
const KEYWORD_SOURCE = process.env.SERANKING_SOURCE || 'us';
const BACKLINK_DAYS = Number(process.env.SERANKING_BACKLINK_DAYS || 7);

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

function loadCompetitors(): Competitor[] {
  const p = path.join(ROOT, 'data', 'competitors.json');
  if (!fs.existsSync(p)) return [];
  const data: CompetitorsData = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return data.competitors.filter((c) => c.active);
}

function loadExistingSummaries(): CsvSummariesData {
  const p = path.join(ROOT, 'data', 'csv-summaries', `${TODAY}.json`);
  if (!fs.existsSync(p)) return { date: TODAY, summaries: [] };
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function backlinkToRow(b: BacklinkEntry): Record<string, string> {
  return {
    source_page: b.url_from || '',
    source_page_title: b.title || '',
    target_page: b.url_to || '',
    anchor: b.anchor || '',
    domain_authority: b.domain_inlink_rank != null ? String(b.domain_inlink_rank) : '',
    page_authority: b.inlink_rank != null ? String(b.inlink_rank) : '',
    nofollow: b.nofollow ? 'yes' : 'no',
    first_seen: b.first_seen || b.new_lost_date || '',
  };
}

function keywordToRow(k: KeywordEntry): Record<string, string> {
  const pos = k.position;
  const prev = k.prev_pos;
  let change = '';
  if (pos != null && prev != null) {
    const delta = prev - pos;
    if (delta > 0) change = `+${delta}`;
    else if (delta < 0) change = String(delta);
    else change = '0';
  } else if (pos != null && prev == null) {
    change = 'new';
  }
  return {
    keyword: k.keyword || '',
    position: pos != null ? String(pos) : '',
    previous_position: prev != null ? String(prev) : '',
    position_change: change,
    url: k.url || '',
    search_volume: k.volume != null ? String(k.volume) : '',
    cpc: k.cpc != null ? String(k.cpc) : '',
    difficulty: k.difficulty != null ? String(k.difficulty) : '',
    estimated_traffic: k.traffic != null ? String(k.traffic) : '',
  };
}

async function fetchForCompetitor(c: Competitor): Promise<CsvSummary[]> {
  const out: CsvSummary[] = [];

  try {
    console.log(`  Fetching new backlinks for ${c.name} (last ${BACKLINK_DAYS} days)...`);
    const backlinks = await fetchNewBacklinks(c.domain, BACKLINK_DAYS, 100);
    console.log(`    ${backlinks.length} new backlinks`);
    out.push({
      filename: `seranking-backlinks-${c.id}.json`,
      competitorId: c.id,
      type: 'backlinks',
      rowCount: backlinks.length,
      topRows: backlinks.slice(0, 25).map(backlinkToRow),
    });
  } catch (err) {
    console.warn(`    ! backlinks failed: ${(err as Error).message}`);
  }

  try {
    console.log(`  Fetching top organic keywords for ${c.name} (${KEYWORD_SOURCE})...`);
    const keywords = await fetchTopOrganicKeywords(c.domain, KEYWORD_SOURCE, 100);
    console.log(`    ${keywords.length} organic keywords`);
    out.push({
      filename: `seranking-keywords-${c.id}.json`,
      competitorId: c.id,
      type: 'positions',
      rowCount: keywords.length,
      topRows: keywords.slice(0, 25).map(keywordToRow),
    });
  } catch (err) {
    console.warn(`    ! keywords failed: ${(err as Error).message}`);
  }

  return out;
}

async function main() {
  if (!process.env.SERANKING_API_KEY) {
    console.log('SERANKING_API_KEY not set. Skipping SE Ranking fetch.');
    process.exit(0);
  }

  const competitors = loadCompetitors();
  if (competitors.length === 0) {
    console.log('No active competitors. Skipping SE Ranking fetch.');
    process.exit(0);
  }

  const existing = loadExistingSummaries();
  const newSummaries: CsvSummary[] = [];

  for (const c of competitors) {
    console.log(`\n${c.name} (${c.domain})`);
    const summaries = await fetchForCompetitor(c);
    newSummaries.push(...summaries);
  }

  // Merge: SE Ranking takes priority for backlinks/positions when both sources
  // exist for the same competitor (since the API is the canonical source going
  // forward). Other CSV-uploaded data is preserved.
  const serankingKeys = new Set(newSummaries.map((s) => `${s.competitorId}:${s.type}`));
  const preservedCsv = existing.summaries.filter(
    (s) => !serankingKeys.has(`${s.competitorId}:${s.type}`)
  );
  const merged: CsvSummariesData = {
    date: TODAY,
    summaries: [...preservedCsv, ...newSummaries],
  };

  const outDir = path.join(ROOT, 'data', 'csv-summaries');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${TODAY}.json`);
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(
    `\nWrote ${merged.summaries.length} summaries to ${outPath} (${newSummaries.length} from SE Ranking, ${preservedCsv.length} from CSVs).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
