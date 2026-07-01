import { MultipleCodeBlock } from 'ui-patterns/MultipleCodeBlock'

import type { StepContentProps } from '@/components/interfaces/ConnectSheet/Connect.types'

const ContentFile = ({ projectKeys }: StepContentProps) => {
  const files = [
    {
      name: '.env.local',
      language: 'bash',
      code: [
        `PUBLIC_BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}`,
        projectKeys?.publishableKey
          ? `PUBLIC_BRIVEN_PUBLISHABLE_KEY=${projectKeys.publishableKey}`
          : `PUBLIC_BRIVEN_ANON_KEY=${projectKeys.anonKey ?? 'your-anon-key'}`,
        '',
      ].join('\n'),
    },
    {
      name: 'src/lib/brivenClient.js',
      language: 'js',
      code: `
import { createClient } from "@supabase/supabase-js";
import { PUBLIC_BRIVEN_URL, ${projectKeys.publishableKey ? 'PUBLIC_BRIVEN_PUBLISHABLE_KEY' : 'PUBLIC_BRIVEN_ANON_KEY'} } from "$env/static/public"

const brivenUrl = PUBLIC_BRIVEN_URL;
const brivenKey = ${projectKeys.publishableKey ? 'PUBLIC_BRIVEN_PUBLISHABLE_KEY' : 'PUBLIC_BRIVEN_ANON_KEY'};

export const briven = createClient(brivenUrl, brivenKey);
        `,
    },
    {
      name: 'src/routes/+page.server.js',
      language: 'js',
      code: `
import { briven } from "$lib/brivenClient";

export async function load() {
  const { data } = await briven.from("countries").select();
  return {
    countries: data ?? [],
  };
}
`,
    },
    {
      name: 'src/routes/+page.svelte',
      language: 'html',
      code: `
<script>
  export let data;
</script>

<ul>
  {#each data.countries as country}
    <li>{country.name}</li>
  {/each}
</ul>
`,
    },
  ]

  return <MultipleCodeBlock files={files} />
}

export default ContentFile
