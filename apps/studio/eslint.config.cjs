const { defineConfig } = require('eslint/config')
const barrelFiles = require('eslint-plugin-barrel-files')
const jsxA11y = require('eslint-plugin-jsx-a11y')
const brivenConfig = require('eslint-config-briven/next')

module.exports = defineConfig([
  { files: ['**/*.ts', '**/*.tsx'] },
  brivenConfig,
  {
    plugins: {
      'barrel-files': barrelFiles,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      '@next/next/no-img-element': 'off',
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'warn',
      'react/no-unstable-nested-components': 'warn',
      'react/jsx-key': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'components/ui/DataTable/DataTableColumn/DataTableColumnHeader',
              message: 'Use TanStackTableHeadSort from ui-patterns/Table instead.',
            },
          ],
        },
      ],
      'barrel-files/avoid-re-export-all': 'error',
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'error',
    },
  },
])
