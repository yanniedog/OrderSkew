import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('schema migration smoke test', () => {
  it('contains expected core tables and views', () => {
    const file = resolve(process.cwd(), 'migrations/0001_init.sql')
    const sql = readFileSync(file, 'utf8')

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS historical_loan_rates')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS raw_payloads')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS run_reports')
    expect(sql).toContain('CREATE VIEW IF NOT EXISTS vw_latest_rates')
    expect(sql).toContain('CREATE VIEW IF NOT EXISTS vw_rate_timeseries')
  })
})