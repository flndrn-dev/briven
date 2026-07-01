import { createClient } from '@supabase/supabase-js'

/**
 * Creates a Briven client using the secret key.
 * For use in server-side API routes only.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_BRIVEN_URL!, process.env.LIVE_BRIVEN_SECRET_KEY!)
}
