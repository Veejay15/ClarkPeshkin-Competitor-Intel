# Clark Peshkin Competitor Intelligence

A weekly competitor intelligence tool for Clark Peshkin (clarkpeshkin.com), a divorce, family law, and estate planning firm with offices in Rochester, Buffalo, and Syracuse, NY. Built on Next.js + GitHub Actions + Claude API.

## What It Does

- Tracks competing family law and estate planning firm websites
- Each week, fetches their sitemaps and detects new pages built
- Ingests SEMrush CSV exports for backlinks and keyword changes
- Uses Claude to generate a written weekly intelligence report (one per competitor)
- Cross-references against clarkpeshkin.com's own sitemap so it never recommends building a page Clark Peshkin already has
- Reports are committed to the repo and viewable in a Next.js dashboard
- Hosted free on Vercel Hobby + GitHub Actions

## Architecture

```
GitHub Repo (this) ──► GitHub Actions (weekly cron, generates report)
       │                            │
       │                            ▼
       │                   reports/2026-05-04-{competitor-id}.md (committed back)
       │
       └──► Vercel (auto-deploys, serves dashboard at clark-peshkin-intel.vercel.app)
```

## Local Development

```bash
npm install
cp .env.example .env.local
# Fill in ANTHROPIC_API_KEY and GITHUB_TOKEN at minimum
npm run dev
```

Open http://localhost:3000

## Weekly Workflow

1. **Export SEMrush CSVs** for each competitor (backlinks, position changes). Upload via the dashboard `/upload` page or drop them in `data/csv/YYYY-MM-DD/`
2. **Wait for the Monday cron** (or trigger manually from `/run-report`)
3. **GitHub Actions runs:**
   - Fetches each competitor's sitemap
   - Diffs against last week's sitemap
   - Reads the uploaded CSVs
   - Fetches Clark Peshkin's own sitemap for cross-reference
   - Calls Claude to write a per-competitor report
   - Commits the reports to `reports/YYYY-MM-DD-{competitor-id}.md`
4. **View the reports** at `/reports` on the deployed dashboard

## Tracked Competitors (seed)

- Cimino Law Firm — cimino-law.com
- Marino Law Group — marinolawgroup.com
- Lamb Law Offices — lambattorneys.com
- Duke Law Firm, P.C. — dukelawfirm.net

Edit `data/competitors.json` or use the `/competitors` page in the dashboard to add, remove, or pause competitors.

## Deployment

1. Push this repo to GitHub (e.g. `clark-peshkin-competitor-intel`)
2. Connect the repo at vercel.com (free Hobby tier)
3. Add environment variables in Vercel: `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `ADMIN_PASSWORD`
4. Add the same secrets to GitHub: Settings → Secrets and variables → Actions

## Project Structure

```
clark-peshkin-competitor-intel/
├── app/                          Next.js App Router pages
│   ├── page.tsx                  Dashboard
│   ├── competitors/              Manage competitors
│   ├── reports/                  View reports
│   ├── upload/                   Upload SEMrush CSVs
│   └── api/                      API routes
├── data/
│   ├── competitors.json          List of tracked competitors
│   ├── sitemaps/                 Weekly sitemap snapshots (auto)
│   └── csv/                      Weekly SEMrush exports (manual)
├── reports/                      Generated weekly reports (auto)
├── scripts/                      Node scripts run by GitHub Actions
│   ├── fetch-sitemaps.ts
│   ├── diff-sitemaps.ts
│   ├── process-csvs.ts
│   └── generate-report.ts
├── lib/                          Shared utilities
└── .github/workflows/            GitHub Actions cron
```

## Costs

- Vercel Hobby: Free
- GitHub: Free
- GitHub Actions: Free (2,000 min/month, we use ~40)
- Anthropic API: Roughly $5–15/month based on report frequency
- Total: ~$5–15/month
