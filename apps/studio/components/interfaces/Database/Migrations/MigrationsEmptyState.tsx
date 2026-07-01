import { useParams } from 'common'
import { Terminal } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from 'ui'
import { EmptyStatePresentational } from 'ui-patterns'

import CommandRender from '@/components/interfaces/Functions/CommandRender'

export const MigrationsEmptyState = () => {
  const { ref } = useParams()

  const commands = [
    {
      comment: 'Link your project',
      command: `briven link --project-ref ${ref}`,
      jsx: () => {
        return (
          <>
            <span className="text-brand-600">briven</span> link --project-ref {ref}
          </>
        )
      },
    },
    {
      comment: 'Create a new migration called "new-migration"',
      command: `briven migration new new-migration`,
      jsx: () => {
        return (
          <>
            <span className="text-brand-600">briven</span> migration new new-migration
          </>
        )
      },
    },
    {
      comment: 'Run all migrations for this project',
      command: `briven db push`,
      jsx: () => {
        return (
          <>
            <span className="text-brand-600">briven</span> db push
          </>
        )
      },
    },
  ]

  return (
    <EmptyStatePresentational
      icon={Terminal}
      title="Run your first migration"
      description="Create and run your first migration using the Briven CLI."
      className="gap-y-6"
    >
      <Card>
        <CardHeader>
          <CardTitle>Terminal instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <CommandRender commands={commands} />
        </CardContent>
      </Card>
    </EmptyStatePresentational>
  )
}
