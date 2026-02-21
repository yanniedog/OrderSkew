import {
  FEATURE_SETS,
  LVR_TIERS,
  RATE_STRUCTURES,
  REPAYMENT_TYPES,
  SECURITY_PURPOSES,
} from '../constants'

type LatestFilters = {
  bank?: string
  securityPurpose?: string
  repaymentType?: string
  rateStructure?: string
  lvrTier?: string
  featureSet?: string
  limit?: number
}

function safeLimit(limit: number | undefined, fallback: number, max = 500): number {
  if (!Number.isFinite(limit)) {
    return fallback
  }
  return Math.min(max, Math.max(1, Math.floor(limit as number)))
}

function rows<T>(result: D1Result<T>): T[] {
  return result.results ?? []
}

export async function getFilters(db: D1Database) {
  const [banks, securityPurposes, repaymentTypes, rateStructures, lvrTiers, featureSets] = await Promise.all([
    db.prepare('SELECT DISTINCT bank_name AS value FROM historical_loan_rates ORDER BY bank_name ASC').all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT security_purpose AS value FROM historical_loan_rates ORDER BY security_purpose ASC')
      .all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT repayment_type AS value FROM historical_loan_rates ORDER BY repayment_type ASC')
      .all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT rate_structure AS value FROM historical_loan_rates ORDER BY rate_structure ASC')
      .all<{ value: string }>(),
    db.prepare('SELECT DISTINCT lvr_tier AS value FROM historical_loan_rates ORDER BY lvr_tier ASC').all<{ value: string }>(),
    db
      .prepare('SELECT DISTINCT feature_set AS value FROM historical_loan_rates ORDER BY feature_set ASC')
      .all<{ value: string }>(),
  ])

  const fallbackIfEmpty = (values: string[], fallback: string[]) => (values.length > 0 ? values : fallback)

  return {
    banks: rows(banks).map((x) => x.value),
    security_purposes: fallbackIfEmpty(
      rows(securityPurposes).map((x) => x.value),
      SECURITY_PURPOSES,
    ),
    repayment_types: fallbackIfEmpty(
      rows(repaymentTypes).map((x) => x.value),
      REPAYMENT_TYPES,
    ),
    rate_structures: fallbackIfEmpty(
      rows(rateStructures).map((x) => x.value),
      RATE_STRUCTURES,
    ),
    lvr_tiers: fallbackIfEmpty(
      rows(lvrTiers).map((x) => x.value),
      LVR_TIERS,
    ),
    feature_sets: fallbackIfEmpty(
      rows(featureSets).map((x) => x.value),
      FEATURE_SETS,
    ),
  }
}

export async function queryLatestRates(db: D1Database, filters: LatestFilters) {
  const where: string[] = []
  const binds: Array<string | number> = []

  if (filters.bank) {
    where.push('bank_name = ?')
    binds.push(filters.bank)
  }
  if (filters.securityPurpose) {
    where.push('security_purpose = ?')
    binds.push(filters.securityPurpose)
  }
  if (filters.repaymentType) {
    where.push('repayment_type = ?')
    binds.push(filters.repaymentType)
  }
  if (filters.rateStructure) {
    where.push('rate_structure = ?')
    binds.push(filters.rateStructure)
  }
  if (filters.lvrTier) {
    where.push('lvr_tier = ?')
    binds.push(filters.lvrTier)
  }
  if (filters.featureSet) {
    where.push('feature_set = ?')
    binds.push(filters.featureSet)
  }

  const limit = safeLimit(filters.limit, 200, 1000)
  binds.push(limit)

  const sql = `
    SELECT
      bank_name,
      collection_date,
      product_id,
      product_name,
      security_purpose,
      repayment_type,
      rate_structure,
      lvr_tier,
      feature_set,
      interest_rate,
      comparison_rate,
      annual_fee,
      source_url,
      data_quality_flag,
      confidence_score,
      parsed_at,
      product_key
    FROM vw_latest_rates
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY bank_name ASC, product_name ASC, lvr_tier ASC, rate_structure ASC
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result)
}

export async function queryTimeseries(
  db: D1Database,
  input: {
    bank?: string
    productKey?: string
    startDate?: string
    endDate?: string
    limit?: number
  },
) {
  const where: string[] = []
  const binds: Array<string | number> = []

  if (input.bank) {
    where.push('bank_name = ?')
    binds.push(input.bank)
  }
  if (input.productKey) {
    where.push('product_key = ?')
    binds.push(input.productKey)
  }
  if (input.startDate) {
    where.push('collection_date >= ?')
    binds.push(input.startDate)
  }
  if (input.endDate) {
    where.push('collection_date <= ?')
    binds.push(input.endDate)
  }

  const limit = safeLimit(input.limit, 500, 5000)
  binds.push(limit)

  const sql = `
    SELECT
      collection_date,
      bank_name,
      product_id,
      product_name,
      lvr_tier,
      rate_structure,
      interest_rate,
      comparison_rate,
      annual_fee,
      data_quality_flag,
      confidence_score,
      source_url,
      product_key
    FROM vw_rate_timeseries
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY collection_date ASC
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()
  return rows(result)
}