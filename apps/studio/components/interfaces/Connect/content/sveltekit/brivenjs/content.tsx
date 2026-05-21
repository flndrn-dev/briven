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
        <ConnectTabTrigger value="src/lib/brivenClient.js" />
        <ConnectTabTrigger value="src/routes/+page.server.js" />
        <ConnectTabTrigger value="src/routes/+page.svelte" />
      </ConnectTabTriggers>

      <ConnectTabContent value=".env.local">
        <SimpleCodeBlock className="bash" parentClassName="min-h-72">
          {[
            '',
            `PUBLIC_BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}`,
            projectKeys?.publishableKey
              ? `PUBLIC_BRIVEN_PUBLISHABLE_KEY=${projectKeys.publishableKey}`
              : `PUBLIC_BRIVEN_ANON_KEY=${projectKeys.anonKey ?? 'your-anon-key'}`,
            '',
          ].join('\n')}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/lib/brivenClient.js">
        <SimpleCodeBlock className="js" parentClassName="min-h-72">
          {`
import { createClient } from "@supabase/supabase-js";
import { PUBLIC_BRIVEN_URL, ${projectKeys.publishableKey ? 'PUBLIC_BRIVEN_PUBLISHABLE_KEY' : 'PUBLIC_BRIVEN_ANON_KEY'} } from "$env/static/public"

const brivenUrl = PUBLIC_BRIVEN_URL;
const brivenKey = ${projectKeys.publishableKey ? 'PUBLIC_BRIVEN_PUBLISHABLE_KEY' : 'PUBLIC_BRIVEN_ANON_KEY'};

export const briven = createClient(brivenUrl, brivenKey);
        `}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/routes/+page.server.js">
        <SimpleCodeBlock className="js" parentClassName="min-h-72">
          {`
import { briven } from "$lib/brivenClient";

export async function load() {
  const { data } = await briven.from("countries").select();
  return {
    countries: data ?? [],
  };
}
`}
        </SimpleCodeBlock>
      </ConnectTabContent>

      <ConnectTabContent value="src/routes/+page.svelte">
        <SimpleCodeBlock className="html" parentClassName="min-h-72">
          {`
<script>
  export let data;
</script>

<ul>
  {#each data.countries as country}
    <li>{country.name}</li>
  {/each}
</ul>
`}
        </SimpleCodeBlock>
      </ConnectTabContent>
    </ConnectTabs>
  )
}

export default ContentFile
