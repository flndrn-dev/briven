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
        <ConnectTabTrigger value="src/db/briven.js" />
        <ConnectTabTrigger value="src/pages/index.astro" />
      </ConnectTabTriggers>

      <ConnectTabContent value=".env.local">
        <SimpleCodeBlock className="bash" parentClassName="min-h-72">
          {`
BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}
BRIVEN_KEY=${projectKeys.publishableKey ?? projectKeys.anonKey ?? 'your-anon-key'}
        `}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/db/briven.js">
        <SimpleCodeBlock className="js" parentClassName="min-h-72">
          {`
import { createClient } from "@supabase/supabase-js";

const brivenUrl = import.meta.env.BRIVEN_URL;
const brivenKey = import.meta.env.BRIVEN_KEY;

export const briven = createClient(brivenUrl, brivenKey);
        `}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/pages/index.astro">
        <SimpleCodeBlock className="html" parentClassName="min-h-72">
          {`
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
`}
        </SimpleCodeBlock>
      </ConnectTabContent>
    </ConnectTabs>
  )
}

export default ContentFile
