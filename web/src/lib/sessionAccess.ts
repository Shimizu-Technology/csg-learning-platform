import type { ApiResponse } from './api'

const ACCESS_DENIED_CODES = new Set(['account_not_authorized', 'account_archived'])

export function isAccessDeniedResponse(response: Pick<ApiResponse<unknown>, 'status' | 'errorCode'>) {
  return response.status === 403 && Boolean(response.errorCode && ACCESS_DENIED_CODES.has(response.errorCode))
}
