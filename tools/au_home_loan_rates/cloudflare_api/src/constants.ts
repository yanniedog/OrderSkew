import lendersConfigRaw from '../config/lenders.json'
import type { FeatureSet, LenderConfigFile, LvrTier, RateStructure, RepaymentType, SecurityPurpose } from './types'

export const API_BASE_PATH = '/api/home-loan-rates'
export const MELBOURNE_TIMEZONE = 'Australia/Melbourne'
export const MELBOURNE_TARGET_HOUR = 6
export const DEFAULT_PUBLIC_CACHE_SECONDS = 120
export const DEFAULT_LOCK_TTL_SECONDS = 7200
export const DEFAULT_MAX_QUEUE_ATTEMPTS = 6

export const SECURITY_PURPOSES: SecurityPurpose[] = ['owner_occupied', 'investment']
export const REPAYMENT_TYPES: RepaymentType[] = ['principal_and_interest', 'interest_only']
export const RATE_STRUCTURES: RateStructure[] = [
  'variable',
  'fixed_1yr',
  'fixed_2yr',
  'fixed_3yr',
  'fixed_4yr',
  'fixed_5yr',
]
export const LVR_TIERS: LvrTier[] = ['lvr_=60%', 'lvr_60-70%', 'lvr_70-80%', 'lvr_80-85%', 'lvr_85-90%', 'lvr_90-95%']
export const FEATURE_SETS: FeatureSet[] = ['basic', 'premium']

const lendersConfig = lendersConfigRaw as LenderConfigFile
export const TARGET_LENDERS = lendersConfig.lenders
export const CDR_REGISTER_DISCOVERY_URL = 'https://consumerdatastandardsaustralia.github.io/register/'