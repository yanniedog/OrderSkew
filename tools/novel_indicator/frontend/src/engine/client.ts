import { strToU8, zipSync } from 'fflate'
import type {
  BinanceDiagnosticsFeed,
  PlotOptions,
  PlotPayload,
  ResultSummary,
  RunConfig,
  RunCreated,
  RunStatus,
  TelemetryFeed,
} from '../api/types'

type RpcRequest = { id: string; method: string; params?: Record<string, unknown> }
type RpcResponse = { id: string; ok: boolean; result?: unknown; error?: string }

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type RunExportFile = {
  path: string
  content: string
  mime: string
}

type RunExportBundle = {
  run_id: string
  generated_at: string
  files: RunExportFile[]
}

class LocalEngineClient {
  private worker: Worker | null = null
  private pending = new Map<string, Pending>()
  private started = false

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker
    }
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<RpcResponse>) => {
      const payload = event.data
      const inFlight = this.pending.get(payload.id)
      if (!inFlight) {
        return
      }
      this.pending.delete(payload.id)
      if (payload.ok) {
        inFlight.resolve(payload.result)
      } else {
        inFlight.reject(new Error(payload.error ?? 'Worker call failed'))
      }
    }
    this.worker = worker
    return worker
  }

  private async rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const worker = this.ensureWorker()
    if (!this.started) {
      this.started = true
      await this.rpcInternal('init', {})
    }
    return this.rpcInternal<T>(method, params)
  }

  private rpcInternal<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const worker = this.ensureWorker()
    const id = crypto.randomUUID()
    const payload: RpcRequest = { id, method, params }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      worker.postMessage(payload)
    })
  }

  async createRun(config: Partial<RunConfig>): Promise<RunCreated> {
    return this.rpc<RunCreated>('createRun', { config })
  }

  async listRuns(): Promise<RunStatus[]> {
    return this.rpc<RunStatus[]>('listRuns')
  }

  async getRun(runId: string): Promise<RunStatus> {
    return this.rpc<RunStatus>('getRun', { runId })
  }

  async getResults(runId: string): Promise<ResultSummary> {
    return this.rpc<ResultSummary>('getResults', { runId })
  }

  async getPlot(runId: string, plotId: string, options?: PlotOptions): Promise<PlotPayload> {
    return this.rpc<PlotPayload>('getPlot', { runId, plotId, options })
  }

  async getTelemetry(runId: string, limit: number): Promise<TelemetryFeed> {
    return this.rpc<TelemetryFeed>('getTelemetry', { runId, limit })
  }

  async getBinanceDiagnostics(runId: string, limit: number): Promise<BinanceDiagnosticsFeed> {
    return this.rpc<BinanceDiagnosticsFeed>('getBinanceDiagnostics', { runId, limit })
  }

  async cancelRun(runId: string): Promise<void> {
    await this.rpc('cancelRun', { runId })
  }

  async generateReport(runId: string): Promise<void> {
    const result = await this.rpc<{ html: string }>('generateReport', { runId })
    const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${runId}_report.html`
    link.click()
    URL.revokeObjectURL(url)
  }

  async exportPine(runId: string): Promise<void> {
    const result = await this.rpc<{ files: Record<string, string> }>('exportPine', { runId })
    const entries = Object.entries(result.files)
    for (const [name, content] of entries) {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    }
  }

  async getRunStoragePayload(runId: string): Promise<Record<string, unknown>> {
    return this.rpc<Record<string, unknown>>('getRunStoragePayload', { runId })
  }

  async downloadRunBundle(runId: string): Promise<void> {
    const bundle = await this.rpc<RunExportBundle>('exportRunBundle', { runId })
    if (!bundle.files.length) {
      throw new Error('No export files available for this run')
    }

    const archive: Record<string, Uint8Array> = {}
    for (const file of bundle.files) {
      const path = file.path.replace(/\\/g, '/').replace(/^\/+/, '')
      if (!path) continue
      archive[path] = strToU8(file.content ?? '')
    }

    const zipped = zipSync(archive, { level: 6 })
    const zipBytes = Uint8Array.from(zipped)
    const stamp = bundle.generated_at.replace(/[:.]/g, '-')
    const blob = new Blob([zipBytes], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${runId}_results_${stamp}.zip`
    link.click()
    URL.revokeObjectURL(url)
  }
}

export const localEngine = new LocalEngineClient()
