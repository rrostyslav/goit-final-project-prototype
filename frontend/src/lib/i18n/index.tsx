'use client'

import type { Locale } from '@gp/shared'
import { SUPPORTED_LOCALES } from '@gp/shared'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import en from './en.json'
import uk from './uk.json'

type Dictionary = Record<string, string>

const DICTIONARIES: Record<Locale, Dictionary> = { uk, en }

const DEFAULT_LOCALE: Locale = 'uk'
const LOCALE_STORAGE_KEY = 'gp-locale'

type TranslateVars = Record<string, string | number>

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, vars?: TranslateVars) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function isSupportedLocale(value: string | null): value is Locale {
  return value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

function interpolate(template: string, vars: TranslateVars | undefined): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key]
    return value === undefined ? match : String(value)
  })
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Always start at the default locale on both the server render and the
  // client's first (hydration) render, so the two match exactly. A saved
  // preference in localStorage is only applied after mount (see the effect
  // below) -- this trades "correct locale on the very first paint" for "no
  // hydration mismatch", the same tradeoff the auth store makes for its own
  // localStorage-backed state.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isSupportedLocale(stored)) {
      setLocaleState(stored)
    }
  }, [])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
  }, [])

  const t = useCallback(
    (key: string, vars?: TranslateVars) => {
      const template = DICTIONARIES[locale][key]
      if (template === undefined) return key
      return interpolate(template, vars)
    },
    [locale],
  )

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return ctx
}
