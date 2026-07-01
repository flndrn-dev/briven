import { describe, expect, it } from 'vitest'

import { buildStudioPageTitle, STUDIO_PAGE_TITLE_SEPARATOR } from './page-title'

describe('buildStudioPageTitle', () => {
  it('builds a project-scoped title in most-specific-first order', () => {
    expect(
      buildStudioPageTitle({
        surface: 'Database',
        project: 'Acme Project',
        org: 'Acme Org',
        brand: 'Briven',
      })
    ).toBe(
      `Database${STUDIO_PAGE_TITLE_SEPARATOR}Acme Project${STUDIO_PAGE_TITLE_SEPARATOR}Acme Org${STUDIO_PAGE_TITLE_SEPARATOR}Briven`
    )
  })

  it('includes entity and section when provided', () => {
    expect(
      buildStudioPageTitle({
        entity: 'users',
        section: 'Tables',
        surface: 'Database',
        project: 'Acme Project',
        org: 'Acme Org',
        brand: 'Briven',
      })
    ).toBe(
      `users${STUDIO_PAGE_TITLE_SEPARATOR}Tables${STUDIO_PAGE_TITLE_SEPARATOR}Database${STUDIO_PAGE_TITLE_SEPARATOR}Acme Project${STUDIO_PAGE_TITLE_SEPARATOR}Acme Org${STUDIO_PAGE_TITLE_SEPARATOR}Briven`
    )
  })

  it('omits missing segments', () => {
    expect(
      buildStudioPageTitle({
        section: 'Authentication',
        project: 'Acme Project',
        brand: 'Briven',
      })
    ).toBe(
      `Authentication${STUDIO_PAGE_TITLE_SEPARATOR}Acme Project${STUDIO_PAGE_TITLE_SEPARATOR}Briven`
    )
  })

  it('deduplicates adjacent segments case-insensitively', () => {
    expect(
      buildStudioPageTitle({
        section: 'Database',
        surface: 'database',
        project: 'Acme Project',
        org: 'Acme Org',
        brand: 'Briven',
      })
    ).toBe(
      `Database${STUDIO_PAGE_TITLE_SEPARATOR}Acme Project${STUDIO_PAGE_TITLE_SEPARATOR}Acme Org${STUDIO_PAGE_TITLE_SEPARATOR}Briven`
    )
  })

  it('normalizes whitespace in each segment', () => {
    expect(
      buildStudioPageTitle({
        entity: '  hello   world  ',
        surface: '  Edge    Functions ',
        brand: ' Briven ',
      })
    ).toBe(
      `hello world${STUDIO_PAGE_TITLE_SEPARATOR}Edge Functions${STUDIO_PAGE_TITLE_SEPARATOR}Briven`
    )
  })

  it('truncates very long segments', () => {
    const longName = 'x'.repeat(80)

    expect(
      buildStudioPageTitle({
        entity: longName,
        surface: 'Table Editor',
        brand: 'Briven',
      })
    ).toBe(
      `${'x'.repeat(59)}…${STUDIO_PAGE_TITLE_SEPARATOR}Table Editor${STUDIO_PAGE_TITLE_SEPARATOR}Briven`
    )
  })

  it('supports custom brand titles', () => {
    expect(
      buildStudioPageTitle({
        surface: 'Settings',
        brand: 'Briven Studio',
      })
    ).toBe(`Settings${STUDIO_PAGE_TITLE_SEPARATOR}Briven Studio`)
  })
})
