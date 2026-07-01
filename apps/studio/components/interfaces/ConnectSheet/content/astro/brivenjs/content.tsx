import { MultipleCodeBlock } from 'ui-patterns/MultipleCodeBlock'

import type { StepContentProps } from '@/components/interfaces/ConnectSheet/Connect.types'

const ContentFile = ({ projectKeys }: StepContentProps) => {
  const files = [
    {
      name: '.env.local',
      language: 'bash',
      code: `
BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}
BRIVEN_KEY=${projectKeys.publishableKey ?? projectKeys.anonKey ?? 'your-anon-key'}
        `,
    },
    {
      name: 'src/db/briven.js',
      language: 'js',
      code: `
import { createClient } from "@supabase/supabase-js";

const brivenUrl = import.meta.env.BRIVEN_URL;
const brivenKey = import.meta.env.BRIVEN_KEY;

export const briven = createClient(brivenUrl, brivenKey);
        `,
    },
    {
      name: 'src/pages/index.astro',
      language: 'html',
      code: `
---
import { briven } from '../db/briven';

const { data, error } = await briven.from("todos").select('*');
---

{
  (
    <ul>
      {data.map((entry) => (
        <li>{entry.name}</li>
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
