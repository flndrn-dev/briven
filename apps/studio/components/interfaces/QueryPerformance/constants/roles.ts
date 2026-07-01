export type KnownRole =
  | 'anon'
  | 'authenticated'
  | 'service_role'
  | 'postgres'
  | 'authenticator'
  | 'briven_auth_admin'
  | 'briven_storage_admin'
  | 'briven_etl_admin'
  | 'briven_realtime_admin'
  | 'briven_replication_admin'
  | 'briven_read_only_user'
  | 'dashboard_user'
  | 'briven_admin'

export const APP_ACCESS_ROLES: KnownRole[] = ['anon', 'authenticated', 'service_role'] as const
export const BRIVEN_SYSTEM_ROLES: KnownRole[] = [
  'postgres',
  'authenticator',
  'briven_auth_admin',
  'briven_storage_admin',
  'briven_etl_admin',
  'briven_realtime_admin',
  'briven_replication_admin',
  'briven_read_only_user',
  'dashboard_user',
  'briven_admin',
] as const

export type RoleInfo = {
  displayName: string
}

export const ROLE_INFO: Record<KnownRole, RoleInfo> = {
  anon: {
    displayName: 'Anonymous (Logged Out)',
  },
  authenticated: {
    displayName: 'Authenticated (Logged In)',
  },
  service_role: {
    displayName: 'Service Role',
  },
  postgres: {
    displayName: 'Postgres',
  },
  authenticator: {
    displayName: 'Authenticator',
  },
  briven_auth_admin: {
    displayName: 'Auth Admin',
  },
  briven_storage_admin: {
    displayName: 'Storage Admin',
  },
  briven_etl_admin: {
    displayName: 'ETL Admin',
  },
  briven_realtime_admin: {
    displayName: 'Realtime Admin',
  },
  briven_replication_admin: {
    displayName: 'Replication Admin',
  },
  briven_read_only_user: {
    displayName: 'Read-Only User',
  },
  dashboard_user: {
    displayName: 'Dashboard User',
  },
  briven_admin: {
    displayName: 'Briven Admin',
  },
}

export function isKnownRole(role: string): role is KnownRole {
  return role in ROLE_INFO
}

export type RoleGroup = {
  name: string
  options: string[]
}
