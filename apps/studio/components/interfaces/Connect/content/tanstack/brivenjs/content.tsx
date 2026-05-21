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
        <ConnectTabTrigger value=".env" />
        <ConnectTabTrigger value="src/utils/briven.ts" />
        <ConnectTabTrigger value="src/routes/index.tsx" />
      </ConnectTabTriggers>

      <ConnectTabContent value=".env">
        <SimpleCodeBlock className="bash" parentClassName="min-h-72">
          {`
VITE_BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}
VITE_BRIVEN_KEY=${projectKeys.publishableKey ?? projectKeys.anonKey ?? 'your-anon-key'}
        `}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/utils/briven.ts">
        <SimpleCodeBlock className="ts" parentClassName="min-h-72">
          {`
import { createClient } from "@supabase/supabase-js";

export const briven = createClient(
  import.meta.env.VITE_BRIVEN_URL,
  import.meta.env.VITE_BRIVEN_KEY
);
        `}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/routes/index.tsx">
        <SimpleCodeBlock className="tsx" parentClassName="min-h-72">
          {`
import { createFileRoute } from '@tanstack/react-router'
import { briven } from '../utils/briven'

export const Route = createFileRoute('/')({
  loader: async () => {
    const { data: todos } = await briven.from('todos').select()
    return { todos }
  },
  component: Home,
})

function Home() {
  const { todos } = Route.useLoaderData()

  return (
    <ul>
      {todos?.map((todo) => (
        <li key={todo.id}>{todo.name}</li>
      ))}
    </ul>
  )
}
`}
        </SimpleCodeBlock>
      </ConnectTabContent>
    </ConnectTabs>
  )
}

export default ContentFile
