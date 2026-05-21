import { useMonaco } from '@monaco-editor/react'
import { useTheme } from 'next-themes'
import { useMemo } from 'react'

/*
 * Briven Monaco theme — Phase 5 screen 4 of BACKEND_FORK_BRIEF.md.
 * Palette sourced from packages/config/tailwind/theme.css:
 *   bg          #0a0b0d
 *   text        #f5f7fa
 *   primary     #00e87a   (cursor, selection accent)
 *   code-comment #6b7280
 *   code-keyword #ff7a9f
 *   code-string  #9dffa8
 *   code-number  #ffb86b
 *   code-fn      #5b9fff
 */
const BRIVEN_DARK = {
  bg: '0a0b0d',
  text: 'f5f7fa',
  primary: '00e87a',
  comment: '6b7280',
  keyword: 'ff7a9f',
  string: '9dffa8',
  number: 'ffb86b',
  fn: '5b9fff',
}

const BRIVEN_LIGHT = {
  bg: 'f5f7fa',
  text: '0a0b0d',
  primary: '00c968',
  comment: '6b7280',
  keyword: 'd1265f',
  string: '0a8b3a',
  number: 'b85a00',
  fn: '2e5fbf',
}

export const getTheme = (theme: string) => {
  const isDarkMode = theme.includes('dark')
  const p = isDarkMode ? BRIVEN_DARK : BRIVEN_LIGHT
  return {
    base: isDarkMode ? ('vs-dark' as const) : ('vs' as const),
    inherit: true,
    rules: [
      { token: '', background: p.bg, foreground: p.text },
      { token: 'comment', foreground: p.comment, fontStyle: 'italic' },
      { token: 'string', foreground: p.string },
      { token: 'string.sql', foreground: p.string },
      { token: 'number', foreground: p.number },
      { token: 'keyword', foreground: p.keyword },
      { token: 'keyword.sql', foreground: p.keyword },
      { token: 'predefined.sql', foreground: p.fn },
      { token: 'operator.sql', foreground: p.primary },
      { token: 'identifier', foreground: p.text },
      { token: 'delimiter', foreground: p.text },
    ],
    colors: {
      'editor.background': `#${p.bg}`,
      'editor.foreground': `#${p.text}`,
      'editorCursor.foreground': `#${p.primary}`,
      'editorLineNumber.foreground': `#${p.comment}`,
      'editorLineNumber.activeForeground': `#${p.text}`,
      'editor.selectionBackground': `#${p.primary}33`,
      'editor.lineHighlightBackground': isDarkMode ? '#13151a' : '#e8eaef',
    },
  }
}

/**
 * This component is used to set the theme for the Monaco editor. This would be a hook but it needs to be placed between
 * ThemeProvider and the layout page so a component is the most convenient way to do this.
 */
export const MonacoThemeProvider = () => {
  const monaco = useMonaco()
  const { resolvedTheme } = useTheme()

  // Define the briven theme for Monaco before anything is rendered. Using useEffect would sometime load the theme
  // after the editor was loaded, so it looked off. useMemo will always be run before rendering
  useMemo(() => {
    if (monaco && resolvedTheme) {
      const mode = getTheme(resolvedTheme)
      monaco.editor.defineTheme('briven', mode)
    }
  }, [resolvedTheme, monaco])

  return null
}
