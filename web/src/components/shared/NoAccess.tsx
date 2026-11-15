import { StatusPage } from './StatusPage'

/** Same response for missing and restricted records; never disclose record details. */
export function NoAccess() { return <StatusPage variant="no-access" /> }
