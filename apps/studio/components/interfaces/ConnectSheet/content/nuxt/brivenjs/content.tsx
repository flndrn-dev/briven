import { MultipleCodeBlock } from 'ui-patterns/MultipleCodeBlock'

import type { StepContentProps } from '@/components/interfaces/ConnectSheet/Connect.types'

const ContentFile = ({ projectKeys }: StepContentProps) => {
  const files = [
    {
      name: '.env.local',
      language: 'bash',
      code: [
        `BRIVEN_URL=${projectKeys.apiUrl ?? 'your-project-url'}`,
        `BRIVEN_KEY=${projectKeys.publishableKey ?? projectKeys.anonKey ?? 'your-anon-key'}`,
        '',
      ].join('\n'),
    },
    {
      name: 'nuxt.config.ts',
      language: 'ts',
      code: `
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      brivenUrl: process.env.BRIVEN_URL,
      brivenKey: process.env.BRIVEN_KEY,
    },
  },
})
`,
    },
    {
      name: 'app.vue',
      language: 'html',
      code: `
<script setup>
import { ref, onMounted } from 'vue'
import { createClient } from '@supabase/supabase-js'

const config = useRuntimeConfig()
const briven = createClient(config.public.brivenUrl, config.public.brivenKey)

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
