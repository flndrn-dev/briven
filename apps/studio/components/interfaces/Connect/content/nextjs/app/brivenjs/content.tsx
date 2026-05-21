import { SimpleCodeBlock } from 'ui-patterns/SimpleCodeBlock'

import type { ContentFileProps } from '@/components/interfaces/Connect/Connect.types'
import {
  ConnectTabContent,
  ConnectTabs,
  ConnectTabTrigger,
  ConnectTabTriggers,
} from '@/components/interfaces/Connect/ConnectTabs'

const ContentFile = ({ projectKeys }: ContentFileProps) => {
  return (
    <ConnectTabs>
      <ConnectTabTriggers>
        <ConnectTabTrigger value=".env.local" />
        <ConnectTabTrigger value="page.tsx" />
        <ConnectTabTrigger value="utils/briven/server.ts" />
        <ConnectTabTrigger value="utils/briven/client.ts" />
        <ConnectTabTrigger value="utils/briven/middleware.ts" />
      </ConnectTabTriggers>

      <ConnectTabContent value=".env.local">
        <SimpleCodeBlock className="bash" parentClassName="min-h-72">
          {[
            '',
            `NEXT_PUBLIC_BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}`,
            projectKeys?.publishableKey
              ? `NEXT_PUBLIC_BRIVEN_PUBLISHABLE_KEY=${projectKeys.publishableKey}`
              : `NEXT_PUBLIC_BRIVEN_ANON_KEY=${projectKeys.anonKey ?? 'your-anon-key'}`,
            '',
          ].join('\n')}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="page.tsx">
        <SimpleCodeBlock className="tsx" parentClassName="min-h-72">
          {`
import { createClient } from '@/utils/briven/server'
import { cookies } from 'next/headers'

export default async function Page() {
  const cookieStore = await cookies()
  const briven = createClient(cookieStore)

  const { data: todos } = await briven.from('todos').select()

  return (
    <ul>
      {todos?.map((todo) => (
        <li>{todo}</li>
      ))}
    </ul>
  )
}
`}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="utils/briven/server.ts">
        <SimpleCodeBlock className="ts" parentClassName="min-h-72">
          {`
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const brivenUrl = process.env.NEXT_PUBLIC_BRIVEN_URL;
const brivenKey = process.env.${projectKeys?.publishableKey ? 'NEXT_PUBLIC_BRIVEN_PUBLISHABLE_KEY' : 'NEXT_PUBLIC_BRIVEN_ANON_KEY'};

export const createClient = (cookieStore: ReturnType<typeof cookies>) => {
  return createServerClient(
    brivenUrl!,
    brivenKey!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // The \`setAll\` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  );
};
`}
        </SimpleCodeBlock>
      </ConnectTabContent>
      <ConnectTabContent value="utils/briven/client.ts">
        <SimpleCodeBlock className="ts" parentClassName="min-h-72">
          {`
import { createBrowserClient } from "@supabase/ssr";

const brivenUrl = process.env.NEXT_PUBLIC_BRIVEN_URL;
const brivenKey = process.env.${projectKeys?.publishableKey ? 'NEXT_PUBLIC_BRIVEN_PUBLISHABLE_KEY' : 'NEXT_PUBLIC_BRIVEN_ANON_KEY'};

export const createClient = () =>
  createBrowserClient(
    brivenUrl!,
    brivenKey!,
  );
`}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="utils/briven/middleware.ts">
        <SimpleCodeBlock className="ts" parentClassName="min-h-72">
          {`
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const brivenUrl = process.env.NEXT_PUBLIC_BRIVEN_URL;
const brivenKey = process.env.${projectKeys?.publishableKey ? 'NEXT_PUBLIC_BRIVEN_PUBLISHABLE_KEY' : 'NEXT_PUBLIC_BRIVEN_ANON_KEY'};

export const createClient = (request: NextRequest) => {
  // Create an unmodified response
  let brivenResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const briven = createServerClient(
    brivenUrl!,
    brivenKey!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          brivenResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            brivenResponse.cookies.set(name, value, options)
          )
        },
      },
    },
  );

  return brivenResponse
};
`}
        </SimpleCodeBlock>
      </ConnectTabContent>
    </ConnectTabs>
  )
}

// [Joshen] Used as a dynamic import
// eslint-disable-next-line no-restricted-exports
export default ContentFile
