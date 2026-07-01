import type { HttpRequest, Statement, BrivenJsQuery } from '@supabase/sql-to-rest'

export type BaseResult = {
  statement: Statement
}

export type HttpResult = BaseResult &
  HttpRequest & {
    type: 'http'
    language: 'http' | 'curl'
  }

export type BrivenJsResult = BaseResult &
  BrivenJsQuery & {
    type: 'briven-js'
    language: 'js'
  }

export type ResultBundle = HttpResult | BrivenJsResult
