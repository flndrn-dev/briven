import { MultipleCodeBlock } from 'ui-patterns/MultipleCodeBlock'

import type { StepContentProps } from '@/components/interfaces/ConnectSheet/Connect.types'

const ContentFile = ({ projectKeys }: StepContentProps) => {
  const files = [
    {
      name: '.env',
      language: 'bash',
      code: `
VITE_BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}
VITE_BRIVEN_KEY=${projectKeys.publishableKey ?? projectKeys.anonKey ?? 'your-anon-key'}
        `,
    },
    {
      name: 'src/utils/briven.ts',
      language: 'ts',
      code: `
import { createClient } from "@supabase/supabase-js";

export const briven = createClient(
  import.meta.env.VITE_BRIVEN_URL,
  import.meta.env.VITE_BRIVEN_KEY
);
        `,
    },
    {
      name: 'src/routes/index.tsx',
      language: 'tsx',
      code: `
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
`,
    },
  ]

  return <MultipleCodeBlock files={files} />
}

export default ContentFile
