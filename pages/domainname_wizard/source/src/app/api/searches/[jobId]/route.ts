import { NextResponse } from "next/server";

import { getJob } from "@/lib/jobs/store";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json(
      {
        code: "NOT_FOUND",
        message: "Search job was not found or has expired.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      id: job.id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      currentLoop: job.currentLoop,
      totalLoops: job.totalLoops,
      results: job.results,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    },
    { status: 200 },
  );
}

