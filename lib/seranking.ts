// Thin typed wrapper around the SE Ranking Data API.
// Docs: https://seranking.com/api/data/
// Auth: Authorization: Token <SERANKING_API_KEY>

const BASE_URL = 'https://api.seranking.com';

export interface BacklinkEntry {
  url_from: string;
  url_to: string;
  anchor?: string;
  title?: string;
  domain_from?: string;
  nofollow?: boolean;
  inlink_rank?: number;
  domain_inlink_rank?: number;
  first_seen?: string;
  new_lost_date?: string;
  new_lost_type?: string;
}

export interface KeywordEntry {
  keyword: string;
  position?: number;
  prev_pos?: number | null;
  url?: string;
  volume?: number;
  cpc?: number;
  difficulty?: number;
  traffic?: number;
  traffic_percent?: number;
  competition?: number;
}

function apiKey(): string {
  const key = process.env.SERANKING_API_KEY;
  if (!key) {
    throw new Error(
      'SERANKING_API_KEY is not set. Add it to GitHub Actions secrets and Vercel env vars.'
    );
  }
  return key;
}

async function call<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = `${BASE_URL}${path}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Token ${apiKey()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SE Ranking ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export function normalizeDomain(input: string): string {
  return input
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./i, '')
    .toLowerCase();
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function fetchNewBacklinks(
  domain: string,
  days: number = 7,
  limit: number = 100
): Promise<BacklinkEntry[]> {
  const target = normalizeDomain(domain);
  const data = await call<
    | BacklinkEntry[]
    | { new_lost_backlinks?: BacklinkEntry[]; backlinks?: BacklinkEntry[] }
  >('/v1/backlinks/history', {
    target,
    mode: 'domain',
    new_lost_type: 'new',
    date_from: isoDaysAgo(days),
    date_to: isoDaysAgo(0),
    limit,
  });
  if (Array.isArray(data)) return data;
  return data.new_lost_backlinks || data.backlinks || [];
}

export async function fetchTopOrganicKeywords(
  domain: string,
  source: string = 'us',
  limit: number = 100
): Promise<KeywordEntry[]> {
  const target = normalizeDomain(domain);
  const data = await call<KeywordEntry[] | { keywords?: KeywordEntry[] }>(
    '/v1/domain/keywords',
    {
      source,
      domain: target,
      type: 'organic',
      order_field: 'traffic',
      order_direction: 'desc',
      limit,
    }
  );
  if (Array.isArray(data)) return data;
  return data.keywords || [];
}
