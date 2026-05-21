import { MultipleCodeBlock } from 'ui-patterns/MultipleCodeBlock'

import type { StepContentProps } from '@/components/interfaces/ConnectSheet/Connect.types'

const ContentFile = ({ projectKeys }: StepContentProps) => {
  const files = [
    {
      name: '.env',
      language: 'bash',
      code: [
        `VITE_BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}`,
        projectKeys?.publishableKey
          ? `VITE_BRIVEN_PUBLISHABLE_KEY=${projectKeys.publishableKey}`
          : `VITE_BRIVEN_ANON_KEY=${projectKeys.anonKey ?? 'your-anon-key'}`,
        '',
      ].join('\n'),
    },
    {
      name: 'utils/briven.ts',
      language: 'ts',
      code: `
import { createClient } from '@supabase/supabase-js';

const brivenUrl = import.meta.env.VITE_BRIVEN_URL;
const brivenKey = import.meta.env.${projectKeys.publishableKey ? 'VITE_BRIVEN_PUBLISHABLE_KEY' : 'VITE_BRIVEN_ANON_KEY'};

export const briven = createClient(brivenUrl, brivenKey);
`,
    },
    {
      name: 'App.tsx',
      language: 'tsx',
      code: `
import { useState, useEffect } from 'react'
import { briven } from './utils/briven'

export default function App() {
  const [todos, setTodos] = useState([])

  useEffect(() => {
    async function getTodos() {
      const { data: todos } = await briven.from('todos').select()

      if (todos) {
        setTodos(todos)
      }
    }

    getTodos()
  }, [])

  return (
    <ul>
      {todos.map((todo) => (
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
