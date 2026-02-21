import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createJob, markJobFailed } from "@/lib/jobs/store";
import { runSearchJob } from "@/lib/search/runner";
import { searchRequestSchema } from "@/lib/search/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = searchRequestSchema.parse(body);

    const job = createJob(input);

    void runSearchJob(job.id).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unexpected background failure.";
      markJobFailed(job.id, {
        code: "BACKGROUND_EXECUTION_ERROR",
        message,
      });
    });

    return NextResponse.json(
      {
        jobId: job.id,
        status: "queued",
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          code: "INVALID_REQUEST",
          message: "Request payload validation failed.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : "Unexpected server error.";

    return NextResponse.json(
      {
        code: "INTERNAL_ERROR",
        message,
      },
      { status: 500 },
    );
  }
}
