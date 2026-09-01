import { describe, expect, it } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { normalizeError } from './api'
import { isTerminal } from './useJobStream'
import { ledgerFromCredential } from '@/components/VerificationLedger'
import type { Credential } from './types'

/** The three pieces of non-trivial logic in the client. Everything else is
 *  rendering, and a broken render is visible on the first page load. */

function axiosErrorWith(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('failed', 'ERR', config, null, {
    status,
    statusText: 'Error',
    data,
    headers: {},
    config,
  } as never)
}

describe('normalizeError', () => {
  it('reads the AppError shape from app/main.py', () => {
    const error = normalizeError(axiosErrorWith(404, { code: 'not_found', message: 'clinician not found' }))
    expect(error.message).toBe('clinician not found')
    expect(error.code).toBe('not_found')
    expect(error.status).toBe(404)
  })

  it('reads the raw HTTPException shape used by orgs/clinicians/credentials', () => {
    expect(normalizeError(axiosErrorWith(403, { detail: 'not your record' })).message).toBe(
      'not your record',
    )
  })

  it('does not pass a validation-error list off as a message', () => {
    const error = normalizeError(axiosErrorWith(422, { detail: [{ msg: 'field required' }] }))
    expect(error.message).toBe('Error')
  })

  it('explains an unreachable API rather than showing a transport error', () => {
    const error = normalizeError(new AxiosError('Network Error'))
    expect(error.status).toBe(0)
    expect(error.message).toMatch(/port 8000/)
  })
})

describe('isTerminal', () => {
  it('ends the stream on the three terminal steps', () => {
    for (const step of ['complete', 'error', 'awaiting_approval']) {
      expect(isTerminal({ step })).toBe(true)
    }
  })

  it('keeps the stream open on progress steps', () => {
    for (const step of ['queued', 'd4_ocr', 'd4_government_api', 'd3_compose']) {
      expect(isTerminal({ step })).toBe(false)
    }
  })
})

describe('ledgerFromCredential', () => {
  const credential = {
    holder_name: 'Jane Doe',
    identifier: 'CA-88912',
    jurisdiction: 'CA',
    expires_on: '2027-01-31',
  } as Credential

  it('marks only the fields the authority disagreed with', () => {
    const rows = ledgerFromCredential(credential, [
      { field: 'identifier', document: 'CA-88912', authority: 'CA-88921' },
    ])

    expect(rows).toHaveLength(4)
    const identifier = rows.find((r) => r.field === 'identifier')!
    expect(identifier.agrees).toBe(false)
    expect(identifier.authority).toBe('CA-88921')
    expect(rows.filter((r) => !r.agrees)).toHaveLength(1)
  })

  it('shows every field as matching when nothing differed', () => {
    expect(ledgerFromCredential(credential, []).every((r) => r.agrees)).toBe(true)
  })
})
