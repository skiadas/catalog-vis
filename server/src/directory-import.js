// Bulk directory import: parses the admin-uploaded CSV of accounts into
// canonical entries. Pure (no DB, no HTTP) so it unit-tests directly; the route
// applies the rows through the directory repo.
//
// Contract: one account per row, columns `username,displayName,departments`.
// The header row is optional (recognized when its first cell reads
// `username`). `displayName` is the real name; `departments` is a single cell
// listing course prefixes, separated by commas, semicolons, or whitespace
// (`"CS, MATH"` or `CS MATH`). Extra columns are ignored. A malformed row never
// aborts the file — it is reported with its row number, and the good rows
// still import.

import { parse } from 'csv-parse/sync'
import { canonicalUsername } from './names.js'
import { normalizePrefixList } from './db.js'

/** @typedef {import('./db.js').DB} DB */

/**
 * A row that parsed cleanly. `row` is the 1-based data-row number (after any
 * header row), for messages back to the admin.
 * @typedef {{ row: number, username: string, displayName: string | null, departments: string[] }} ImportRow
 */

/**
 * @typedef {{ row: number, reason: string }} ImportError
 * @typedef {{ rows: ImportRow[], errors: ImportError[] }} ImportResult
 */

// Splits a departments cell on commas/semicolons/whitespace, dropping blanks.
function splitDepartments(cell) {
  return String(cell ?? '')
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/**
 * Parses the import CSV into canonical rows. `domain` is AUTH_DOMAIN, applied
 * to bare usernames exactly as the login and access-list flows do.
 *
 * @param {string} text  the raw CSV file contents
 * @param {string} [domain]
 * @returns {ImportResult}
 */
export function parseDirectoryCsv(text, domain = '') {
  let records
  try {
    records = parse(String(text ?? ''), {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    })
  } catch {
    return { rows: [], errors: [{ row: 0, reason: 'unreadable_csv' }] }
  }

  // The header is optional; drop it when the first cell names the column.
  if (
    records.length &&
    String(records[0][0] ?? '')
      .trim()
      .toLowerCase() === 'username'
  ) {
    records = records.slice(1)
  }

  const rows = []
  const errors = []
  records.forEach((record, i) => {
    const row = i + 1
    const username = canonicalUsername(record[0], domain)
    if (!username) {
      errors.push({ row, reason: 'missing_username' })
      return
    }
    const displayName =
      String(record[1] ?? '')
        .trim()
        .slice(0, 120) || null
    const departments = normalizePrefixList(splitDepartments(record[2]))
    if (departments === null) {
      errors.push({ row, reason: 'bad_departments' })
      return
    }
    rows.push({ row, username, displayName, departments })
  })
  return { rows, errors }
}
