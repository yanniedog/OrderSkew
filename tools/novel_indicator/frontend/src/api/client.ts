import { localEngine } from '../engine/client'
import type {
  BinanceDiagnosticsFeed,
  PlotPayload,
  ResultSummary,
  RunConfig,
  RunCreated,
  RunStatus,
  TelemetryFeed,
} from './types'

export async function createRun(config: Partial<RunConfig>): Promise<RunCreated> {
  return localEngine.createRun(config)
}

export async function listRuns(): Promise<RunStatus[]> {
  return localEngine.listRuns()
}

export async function getRun(runId: string): Promise<RunStatus> {
  return localEngine.getRun(runId)
}

export async function getResults(runId: string): Promise<ResultSummary> {
  return localEngine.getResults(runId)
}

export async function getPlot(runId: string, plotId: string): Promise<PlotPayload> {
  return localEngine.getPlot(runId, plotId)
}

export async function getTelemetry(runId: string, limit = 300): Promise<TelemetryFeed> {
  return localEngine.getTelemetry(runId, limit)
}

export async function getBinanceDiagnostics(runId: string, limit = 40): Promise<BinanceDiagnosticsFeed> {
  return localEngine.getBinanceDiagnostics(runId, limit)
}

export async function cancelRun(runId: string): Promise<void> {
  return localEngine.cancelRun(runId)
}

export async function generateReport(runId: string): Promise<void> {
  return localEngine.generateReport(runId)
}

export async function exportPine(runId: string): Promise<void> {
  return localEngine.exportPine(runId)
}

export async function downloadRunBundle(runId: string): Promise<void> {
  return localEngine.downloadRunBundle(runId)
}
