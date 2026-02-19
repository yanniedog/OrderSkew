"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { prepareSearchPayloadWithKeywordEnrichment } from "@/lib/keywords/submit";
import { sortRankedDomains, type DomainSortMode } from "@/lib/search/sort";
import {
  RANDOMNESS_VALUES,
  STYLE_VALUES,
  type RankedDomainResult,
  type SearchResults,
} from "@/lib/types";

type SearchStatus = "queued" | "running" | "done" | "failed";
type SearchPhase = "namelix" | "godaddy" | "looping" | "finalize" | null;

interface SearchJobResponse {
  id: string;
  status: SearchStatus;
  phase: SearchPhase;
  progress: number;
  currentLoop?: number;
  totalLoops?: number;
  error?: {
    code: string;
    message: string;
  };
  results?: SearchResults;
}

interface SearchFormState {
  keywords: string;
  description: string;
  style: (typeof STYLE_VALUES)[number];
  randomness: (typeof RANDOMNESS_VALUES)[number];
  blacklist: string;
  maxLength: number;
  tld: string;
  maxNames: number;
  yearlyBudget: number;
  loopCount: number;
}

const initialFormState: SearchFormState = {
  keywords: "",
  description: "",
  style: "default",
  randomness: "medium",
  blacklist: "",
  maxLength: 25,
  tld: "com",
  maxNames: 100,
  yearlyBudget: 50,
  loopCount: 10,
};

const DOMAIN_SORT_OPTIONS: DomainSortMode[] = [
  "marketability",
  "financialValue",
  "alphabetical",
  "syllableCount",
  "labelLength",
];

function formatMoney(value?: number, currency?: string): string {
  if (typeof value !== "number") {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function phaseLabel(status: SearchStatus, phase: SearchPhase): string {
  if (status === "queued") {
    return "Queued";
  }

  if (status === "done") {
    return "Done";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (phase === "looping") {
    return "Iterative tuning";
  }

  if (phase === "namelix") {
    return "Generating names";
  }

  if (phase === "godaddy") {
    return "Checking domains";
  }

  if (phase === "finalize") {
    return "Finalizing";
  }

  return "Running";
}

function ScoreBadge({ score }: { score: number }) {
  return <span>{score.toFixed(1)}</span>;
}

function BudgetTable({ rows }: { rows: RankedDomainResult[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Price</th>
            <th>Available</th>
            <th>Definitive</th>
            <th>Premium</th>
            <th>Marketability</th>
            <th>Financial</th>
            <th>Overall</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.domain}:${row.sourceName}`}>
              <td>{row.domain}</td>
              <td>{formatMoney(row.price, row.currency)}</td>
              <td>{row.available ? "Yes" : "No"}</td>
              <td>{row.definitive ? "Yes" : "No"}</td>
              <td>{row.isNamelixPremium ? "Yes" : "No"}</td>
              <td><ScoreBadge score={row.marketabilityScore} /></td>
              <td><ScoreBadge score={row.financialValueScore} /></td>
              <td><ScoreBadge score={row.overallScore} /></td>
              <td>{row.reason ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankedTable({ rows }: { rows: RankedDomainResult[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Availability</th>
            <th>Price</th>
            <th>Marketability</th>
            <th>Financial</th>
            <th>Overall</th>
            <th>Syllables</th>
            <th>Label Len</th>
            <th>Discovered</th>
            <th>First Loop</th>
            <th>Last Loop</th>
            <th>Value Drivers</th>
            <th>Value Detractors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.domain}:${row.firstSeenLoop}:${row.lastSeenLoop}`}>
              <td>{row.domain}</td>
              <td>Available</td>
              <td>{formatMoney(row.price, row.currency)}</td>
              <td><ScoreBadge score={row.marketabilityScore} /></td>
              <td><ScoreBadge score={row.financialValueScore} /></td>
              <td><ScoreBadge score={row.overallScore} /></td>
              <td>{row.syllableCount}</td>
              <td>{row.labelLength}</td>
              <td>{row.timesDiscovered}</td>
              <td>{row.firstSeenLoop}</td>
              <td>{row.lastSeenLoop}</td>
              <td>
                {row.valueDrivers.map((item) => `${item.component} (${item.impact.toFixed(1)})`).join(", ") || "-"}
              </td>
              <td>
                {row.valueDetractors.map((item) => `${item.component} (${item.impact.toFixed(1)})`).join(", ") || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Page() {
  const [form, setForm] = useState<SearchFormState>(initialFormState);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<SearchJobResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<DomainSortMode>("marketability");

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let active = true;

    const fetchJob = async () => {
      const response = await fetch(`/api/searches/${jobId}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as SearchJobResponse;

      if (!active) {
        return;
      }

      setJob(payload);
    };

    void fetchJob();

    const interval = setInterval(() => {
      if (!active) {
        return;
      }

      if (job?.status === "done" || job?.status === "failed") {
        return;
      }

      void fetchJob();
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [jobId, job?.status]);

  const isPollingComplete = useMemo(() => {
    return job?.status === "done" || job?.status === "failed";
  }, [job]);

  const allRankedRows = useMemo(() => {
    return sortRankedDomains(job?.results?.allRanked ?? [], sortMode);
  }, [job?.results?.allRanked, sortMode]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setLoading(true);
    setJob(null);
    setJobId(null);
    setSortMode("marketability");

    try {
      const prepared = await prepareSearchPayloadWithKeywordEnrichment(form).catch(() => ({
        payload: form,
        enrichment: null,
      }));

      const response = await fetch("/api/searches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(prepared.payload),
      });

      const payload = (await response.json()) as { jobId?: string; message?: string };

      if (!response.ok || !payload.jobId) {
        throw new Error(payload.message ?? "Unable to start the search job.");
      }

      if (process.env.NODE_ENV !== "production") {
        console.debug("search-submit", {
          originalKeywords: form.keywords,
          submittedKeywords: prepared.payload.keywords,
          enriched: Boolean(prepared.enrichment),
          usedDatamuse: prepared.enrichment?.usedDatamuse ?? false,
          usedWordnik: prepared.enrichment?.usedWordnik ?? false,
          fallbackReason: prepared.enrichment?.fallbackReason ?? null,
        });
      }

      setJobId(payload.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error while creating search job.";
      setSubmitError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <section className="card">
        <h1>Namelix-to-GoDaddy Budget Finder</h1>

        <form onSubmit={onSubmit} className="grid">
          <label>
            Keywords
            <input
              required
              value={form.keywords}
              onChange={(event) => setForm((previous) => ({ ...previous, keywords: event.target.value }))}
              placeholder="e.g. AI productivity"
            />
          </label>

          <label>
            Description
            <input
              value={form.description}
              onChange={(event) => setForm((previous) => ({ ...previous, description: event.target.value }))}
              placeholder="Optional business description"
            />
          </label>

          <label>
            Style
            <select
              value={form.style}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  style: event.target.value as SearchFormState["style"],
                }))
              }
            >
              {STYLE_VALUES.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </label>

          <label>
            Randomness
            <select
              value={form.randomness}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  randomness: event.target.value as SearchFormState["randomness"],
                }))
              }
            >
              {RANDOMNESS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Blacklist
            <input
              value={form.blacklist}
              onChange={(event) => setForm((previous) => ({ ...previous, blacklist: event.target.value }))}
              placeholder="comma,separated,words"
            />
          </label>

          <label>
            Maximum Name Length
            <input
              type="number"
              min={5}
              max={25}
              value={form.maxLength}
              onChange={(event) => setForm((previous) => ({ ...previous, maxLength: Number(event.target.value) || 25 }))}
            />
          </label>

          <label>
            TLD
            <input
              value={form.tld}
              onChange={(event) => setForm((previous) => ({ ...previous, tld: event.target.value }))}
              placeholder="com"
            />
          </label>

          <label>
            Max Names
            <input
              type="number"
              min={1}
              max={250}
              value={form.maxNames}
              onChange={(event) => setForm((previous) => ({ ...previous, maxNames: Number(event.target.value) || 100 }))}
            />
          </label>

          <label>
            Yearly Budget
            <input
              type="number"
              min={1}
              value={form.yearlyBudget}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  yearlyBudget: Number(event.target.value) || previous.yearlyBudget,
                }))
              }
            />
          </label>

          <label>
            Loop Count
            <input
              type="number"
              min={1}
              max={250}
              value={form.loopCount}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  loopCount: Number(event.target.value) || previous.loopCount,
                }))
              }
            />
          </label>

          <button type="submit" disabled={loading}>
            {loading ? "Starting..." : "Start Search"}
          </button>
        </form>

        {submitError && <p className="error">{submitError}</p>}
      </section>

      {job && (
        <section className="card">
          <h2>Status</h2>
          <p>
            <strong>{phaseLabel(job.status, job.phase)}</strong>
            {" "}
            ({job.progress}%)
            {typeof job.currentLoop === "number" && typeof job.totalLoops === "number"
              ? ` | Loop ${job.currentLoop}/${job.totalLoops}`
              : ""}
          </p>
          <div className="progress">
            <div style={{ width: `${job.progress}%` }} />
          </div>

          {job.error && <p className="error">{job.error.code}: {job.error.message}</p>}

          {job.results && (
            <>
              <h3>All Discovered Domains ({job.results.allRanked.length})</h3>
              <label>
                Sort By
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as DomainSortMode)}
                >
                  {DOMAIN_SORT_OPTIONS.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              <RankedTable rows={allRankedRows} />

              <h3>Within Budget ({job.results.withinBudget.length})</h3>
              <BudgetTable rows={job.results.withinBudget} />

              <h3>Loop Summaries ({job.results.loopSummaries.length})</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Loop</th>
                      <th>Required Quota</th>
                      <th>Available Collected</th>
                      <th>Quota Met</th>
                      <th>251 Hit</th>
                      <th>Considered</th>
                      <th>Batches</th>
                      <th>Keywords</th>
                      <th>Description</th>
                      <th>Style</th>
                      <th>Randomness</th>
                      <th>Mutation</th>
                      <th>Within Budget</th>
                      <th>Avg Score</th>
                      <th>Top Domain</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.results.loopSummaries.map((summary) => (
                      <tr key={summary.loop}>
                        <td>{summary.loop}</td>
                        <td>{summary.requiredQuota}</td>
                        <td>{summary.availableCount}</td>
                        <td>{summary.quotaMet ? "Yes" : "No"}</td>
                        <td>{summary.limitHit ? "Yes" : "No"}</td>
                        <td>{summary.consideredCount}</td>
                        <td>{summary.batchCount}</td>
                        <td>{summary.keywords}</td>
                        <td>{summary.description || "-"}</td>
                        <td>{summary.style}</td>
                        <td>{summary.randomness}</td>
                        <td>{summary.mutationIntensity}</td>
                        <td>{summary.withinBudgetCount}</td>
                        <td>{summary.averageOverallScore.toFixed(1)}</td>
                        <td>{summary.topDomain ?? "-"}</td>
                        <td>{summary.skipReason ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {isPollingComplete && !job.results && !job.error && <p>No data returned.</p>}
        </section>
      )}
    </main>
  );
}
