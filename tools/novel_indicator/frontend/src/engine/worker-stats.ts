/**
 * Pure stats/math helpers for the Novel Indicator browser engine worker.
 * No RunBundle, DB, or fetch dependencies.
 */

export type Fold = { trainIdx: Int32Array; valIdx: Int32Array }

export function rollingMean(values: Float64Array, window: number): Float64Array {
  const out = new Float64Array(values.length)
  let sum = 0
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]
    if (i >= window) sum -= values[i - window]
    out[i] = i >= window - 1 ? sum / window : values[i]
  }
  return out
}

export function std(values: Float64Array): number {
  if (!values.length) return 1
  let meanVal = 0
  for (const v of values) meanVal += v
  meanVal /= values.length
  let acc = 0
  for (const v of values) {
    const d = v - meanVal
    acc += d * d
  }
  return Math.sqrt(Math.max(acc / values.length, 1e-9))
}

export function mean(values: Float64Array): number {
  if (!values.length) return 0
  let acc = 0
  for (const v of values) acc += v
  return acc / values.length
}

export function mae(a: Float64Array, b: Float64Array): number {
  let sum = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i])
  return n ? sum / n : 9999
}

export function rmse(a: Float64Array, b: Float64Array): number {
  let sum = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return n ? Math.sqrt(sum / n) : 9999
}

export function shiftTarget(close: Float64Array, h: number): Float64Array {
  const out = new Float64Array(close.length)
  out.fill(Number.NaN)
  for (let i = 0; i < close.length - h; i += 1) out[i] = close[i + h]
  return out
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function rollingStd(values: Float64Array, window: number): Float64Array {
  const out = new Float64Array(values.length)
  const c1 = new Float64Array(values.length + 1)
  const c2 = new Float64Array(values.length + 1)
  for (let i = 0; i < values.length; i += 1) {
    c1[i + 1] = c1[i] + values[i]
    c2[i + 1] = c2[i] + values[i] * values[i]
  }
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - window + 1)
    const count = i - start + 1
    const sum = c1[i + 1] - c1[start]
    const sum2 = c2[i + 1] - c2[start]
    const avg = sum / count
    out[i] = Math.sqrt(Math.max(sum2 / count - avg * avg, 0))
  }
  return out
}

export function ema(values: Float64Array, window: number): Float64Array {
  const out = new Float64Array(values.length)
  if (!values.length) return out
  const alpha = 2 / (window + 1)
  out[0] = values[0]
  for (let i = 1; i < values.length; i += 1) {
    out[i] = alpha * values[i] + (1 - alpha) * out[i - 1]
  }
  return out
}

export function rsi(close: Float64Array, window: number): Float64Array {
  const up = new Float64Array(close.length)
  const down = new Float64Array(close.length)
  for (let i = 1; i < close.length; i += 1) {
    const d = close[i] - close[i - 1]
    if (d > 0) up[i] = d
    else down[i] = -d
  }
  const upEma = ema(up, window)
  const downEma = ema(down, window)
  const out = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) {
    const rs = upEma[i] / (downEma[i] + 1e-9)
    out[i] = 100 - 100 / (1 + rs)
  }
  return out
}

export function buildWalkForwardFolds(n: number, horizon: number): Fold[] {
  const usable = n - horizon - 1
  if (usable < 320) return []
  const folds = 4
  const chunk = Math.floor(usable / (folds + 1))
  if (chunk < 60) return []
  const output: Fold[] = []
  for (let i = 0; i < folds; i += 1) {
    const trainEnd = chunk * (i + 1)
    const valStart = trainEnd + horizon
    const valEnd = Math.min(valStart + chunk, usable)
    const trainLen = Math.max(0, trainEnd - horizon)
    const valLen = Math.max(0, valEnd - valStart)
    if (trainLen < 120 || valLen < 40) continue
    const trainIdx = new Int32Array(trainLen)
    for (let j = 0; j < trainLen; j += 1) trainIdx[j] = j
    const valIdx = new Int32Array(valLen)
    for (let j = 0; j < valLen; j += 1) valIdx[j] = valStart + j
    output.push({ trainIdx, valIdx })
  }
  return output
}

export function fitLinear1D(
  feature: Float64Array,
  targetDelta: Float64Array,
  idx: Int32Array,
): { alpha: number; beta: number } | null {
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  let count = 0
  for (let i = 0; i < idx.length; i += 1) {
    const at = idx[i]
    const x = feature[at]
    const y = targetDelta[at]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
    count += 1
  }
  if (count < 80) return null
  const mx = sx / count
  const my = sy / count
  const varX = sxx - sx * mx
  if (Math.abs(varX) < 1e-9) return null
  const covXY = sxy - sx * my
  const beta = covXY / varX
  const alpha = my - beta * mx
  return { alpha, beta }
}

export function linearFit(
  feature: Float64Array,
  close: Float64Array,
  target: Float64Array,
  horizon: number,
): { yTrue: Float64Array; yPred: Float64Array; closeRef: Float64Array } {
  const folds = buildWalkForwardFolds(close.length, horizon)
  if (!folds.length) return { yTrue: new Float64Array(), yPred: new Float64Array(), closeRef: new Float64Array() }

  const targetDelta = new Float64Array(close.length)
  targetDelta.fill(Number.NaN)
  for (let i = 0; i < close.length; i += 1) {
    if (!Number.isFinite(target[i])) continue
    targetDelta[i] = (target[i] - close[i]) / (close[i] + 1e-9)
  }

  const yTrue: number[] = []
  const yPred: number[] = []
  const closeRef: number[] = []
  for (const fold of folds) {
    const model = fitLinear1D(feature, targetDelta, fold.trainIdx)
    if (!model) continue
    for (let i = 0; i < fold.valIdx.length; i += 1) {
      const at = fold.valIdx[i]
      if (!Number.isFinite(feature[at]) || !Number.isFinite(target[at])) continue
      const predDelta = clamp(model.alpha + model.beta * feature[at], -0.8, 0.8)
      const pred = close[at] * (1 + predDelta)
      yTrue.push(target[at])
      yPred.push(pred)
      closeRef.push(close[at])
    }
  }

  return {
    yTrue: Float64Array.from(yTrue),
    yPred: Float64Array.from(yPred),
    closeRef: Float64Array.from(closeRef),
  }
}

export function backtest(
  yTrue: Float64Array,
  yPred: Float64Array,
  closeRef: Float64Array,
  threshold: number,
): { pnl: number; maxDrawdown: number; turnover: number; equity: number[] } {
  const n = Math.min(yTrue.length, yPred.length, closeRef.length)
  if (n < 5) {
    return { pnl: 0, maxDrawdown: 0, turnover: 0, equity: [] }
  }
  const fee = 0.0012
  const signal = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    const f = (yPred[i] - closeRef[i]) / (closeRef[i] + 1e-9)
    if (f > threshold) signal[i] = 1
    else if (f < -threshold) signal[i] = -1
    else signal[i] = 0
  }

  const returns = new Float64Array(n)
  let turnover = 0
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  const curve: number[] = []
  for (let i = 0; i < n; i += 1) {
    const prev = i > 0 ? signal[i - 1] : 0
    const turn = Math.abs(signal[i] - prev)
    turnover += turn
    const realized = (yTrue[i] - closeRef[i]) / (closeRef[i] + 1e-9)
    const value = prev * realized - fee * turn
    returns[i] = value
    equity *= 1 + value
    if (equity > peak) peak = equity
    const dd = (equity - peak) / (peak + 1e-12)
    if (dd < maxDrawdown) maxDrawdown = dd
    curve.push(equity)
  }

  return {
    pnl: equity - 1,
    maxDrawdown,
    turnover: turnover / n,
    equity: curve,
  }
}
