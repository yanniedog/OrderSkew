import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api") && request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }
  const response = NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api")) {
    Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
  }
  return response;
}
