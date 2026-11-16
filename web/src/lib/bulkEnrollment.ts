export interface EnrollmentRow { email: string; first_name?: string; last_name?: string; error?: string }
// CSV quoting supports commas, doubled quotes and multiline fields.
export function parseEnrollmentRows(input: string): EnrollmentRow[] {
  const records: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const source = input.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && (c === ',' || c === '\t' || c === ';' || c === '\n' || c === '\r')) {
      row.push(cell.trim()); cell = ''
      if (c === '\n' || c === '\r') { if (row.some(Boolean)) records.push(row); row = []; if (c === '\r' && source[i + 1] === '\n') i++ }
    } else cell += c
  }
  row.push(cell.trim()); if (row.some(Boolean)) records.push(row)
  const header = records[0]?.map(c => c.toLowerCase().replace(/ /g, '_'))
  const hasHeader = header?.includes('email')
  const seen = new Set<string>()
  return (hasHeader ? records.slice(1) : records).map(cells => {
    const get = (name: string, index: number) => cells[hasHeader ? header.indexOf(name) : index] || ''
    const email = get('email', 0).toLowerCase()
    const error = quoted ? 'Unclosed CSV quote' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Invalid email' : seen.has(email) ? 'Duplicate in upload' : undefined
    seen.add(email)
    return { email, first_name: get('first_name', 1), last_name: get('last_name', 2), error }
  })
}
