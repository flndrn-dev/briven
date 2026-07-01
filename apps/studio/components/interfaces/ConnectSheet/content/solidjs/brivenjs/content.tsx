import { MultipleCodeBlock } from 'ui-patterns/MultipleCodeBlock'

import type { StepContentProps } from '@/components/interfaces/ConnectSheet/Connect.types'

const ContentFile = ({ projectKeys }: StepContentProps) => {
  const files = [
    {
      name: '.env.local',
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
import { createClient } from "@supabase/supabase-js";

const brivenUrl = import.meta.env.VITE_BRIVEN_URL;
const brivenKey = import.meta.env.${projectKeys.publishableKey ? 'VITE_BRIVEN_PUBLISHABLE_KEY' : 'VITE_BRIVEN_ANON_KEY'};

export const briven = createClient(brivenUrl, brivenKey);
`,
    },
    {
      name: 'src/App.tsx',
      language: 'tsx',
      code: `
import { briven } from '../utils/briven'
import { createResource, For } from "solid-js";

async function getTodos() {
  const { data: todos } = await briven.from("todos").select();
  return todos;
}

function App() {
  const [todos] = createResource(getTodos);

  return (
    <ul>
      <For each={todos()}>{(todo) => <li>{todo.name}</li>}</For>
    </ul>
  );
}

export default App;
`,
    },
  ]

  return <MultipleCodeBlock files={files} />
}

export default ContentFile
