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
      name: 'App.vue',
      language: 'html',
      code: `
<script setup>
  import { ref, onMounted } from 'vue'
  import { briven } from '../utils/briven'
  
  const todos = ref([])

  async function getTodos() {
    const { data } = await briven.from('todos').select()
    todos.value = data
  }

  onMounted(() => {
    getTodos()
  })

</script>

<template>
  <ul>
    <li v-for="todo in todos" :key="todo.id">{{ todo.name }}</li>
  </ul>
</template>
`,
    },
  ]

  return <MultipleCodeBlock files={files} />
}

export default ContentFile
