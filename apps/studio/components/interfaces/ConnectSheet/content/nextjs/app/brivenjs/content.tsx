import { MultipleCodeBlock } from 'ui-patterns/MultipleCodeBlock'

import type { StepContentProps } from '@/components/interfaces/ConnectSheet/Connect.types'

const ContentFile = ({ projectKeys }: StepContentProps) => {
  const files = [
    {
      name: '.env.local',
      language: 'bash',
      code: [
        `NEXT_PUBLIC_BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}`,
        projectKeys?.publishableKey
          ? `NEXT_PUBLIC_BRIVEN_PUBLISHABLE_KEY=${projectKeys.publishableKey}`
          : `NEXT_PUBLIC_BRIVEN_ANON_KEY=${projectKeys.anonKey ?? 'your-anon-key'}`,
        '',
      ].join('\n'),
    },
    {
      name: 'page.tsx',
      language: 'tsx',
      code: `
import { createClient } from '@/utils/briven/server'
import { cookies } from 'next/headers'

export default async function Page() {
  const cookieStore = await cookies()
  const briven = createClient(cookieStore)

  const { data: todos } = await briven.from('todos').select()

  return (
    <ul>
      {todos?.map((todo) => (
        <li key={todo.id}>{todo.name}</li>
      ))}
    </ul>
  )
}
`,
    },
    {
      name: 'utils/briven/server.ts',
      language: 'ts',
      code: `
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const brivenUrl = process.env.NEXT_PUBLIC_BRIVEN_URL;
const brivenKey = process.env.${projectKeys?.publishableKey ? 'NEXT_PUBLIC_BRIVEN_PUBLISHABLE_KEY' : 'NEXT_PUBLIC_BRIVEN_ANON_KEY'};

export const createClient = (cookieStore: Awaited<ReturnType<typeof cookies>>) => {
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
`,
    },
    {
      name: 'utils/briven/client.ts',
      language: 'ts',
      code: `
import { createBrowserClient } from "@supabase/ssr";

const brivenUrl = process.env.NEXT_PUBLIC_BRIVEN_URL;
const brivenKey = process.env.${projectKeys?.publishableKey ? 'NEXT_PUBLIC_BRIVEN_PUBLISHABLE_KEY' : 'NEXT_PUBLIC_BRIVEN_ANON_KEY'};

export const createClient = () =>
  createBrowserClient(
    brivenUrl!,
    brivenKey!,
  );
`,
    },
    {
      name: 'utils/briven/middleware.ts',
      language: 'ts',
      code: `
import { createServerClient } from "@supabase/ssr";
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
`,
    },
  ]

  return <MultipleCodeBlock files={files} />
}

// [Joshen] Used as a dynamic import
// eslint-disable-next-line no-restricted-exports
export default ContentFile
