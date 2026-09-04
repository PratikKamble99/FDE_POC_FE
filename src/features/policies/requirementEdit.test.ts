import { describe, expect, it } from 'vitest'
import { requirementEdit } from './PolicyReviewPage'

/** What an officer's corrections turn into is what ends up enforced, so the
 *  one part of the review screen that is not rendering gets a check. */
describe('requirementEdit', () => {
  it('leaves untouched fields absent rather than sending nulls', () => {
    expect(requirementEdit({}, undefined)).toEqual({})
  })

  it('splits the disallowed-statuses cell and drops the trailing comma', () => {
    expect(requirementEdit({}, 'probationary, restricted, ')).toEqual({
      disallowed_authority_statuses: ['probationary', 'restricted'],
    })
  })

  it('sends an emptied statuses cell as an empty list, not as no change', () => {
    expect(requirementEdit({}, '')).toEqual({ disallowed_authority_statuses: [] })
  })

  it('drops a cleared renewal interval — the API discards null anyway', () => {
    expect(requirementEdit({ renewal_months: null, is_mandatory: true }, undefined)).toEqual({
      is_mandatory: true,
    })
  })

  it('keeps a blank jurisdiction, which is how the API clears one', () => {
    expect(requirementEdit({ jurisdiction: '' }, undefined)).toEqual({ jurisdiction: '' })
  })
})
