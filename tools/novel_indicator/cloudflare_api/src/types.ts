export type Bindings = {
  DB: D1Database
  SESSION_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GOOGLE_REDIRECT_URI: string
  EMAIL_API_KEY?: string
  EMAIL_FROM?: string
  APP_ORIGIN?: string
  COOKIE_DOMAIN?: string
  ALLOW_DEV_TOKEN_ECHO?: string
}

export type Variables = {
  authUser: AuthUser
  session: SessionRow
}

export type AppContext = {
  Bindings: Bindings
  Variables: Variables
}

export type AuthUser = {
  id: string
  username: string
  email: string
  display_name: string | null
  email_verified_at: string | null
  created_at: string
  updated_at: string
}

export type SessionRow = {
  id: string
  user_id: string
  token_hash: string
  csrf_token: string
  ip_hash: string | null
  user_agent_hash: string | null
  expires_at: string
  revoked_at: string | null
  created_at: string
  updated_at: string
}

export type JsonValue = string | number | boolean | null | JsonObject | JsonArray
export type JsonArray = JsonValue[]
export type JsonObject = { [k: string]: JsonValue }
