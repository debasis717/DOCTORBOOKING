import { useState } from 'react'
import './ReportPanel.css'

const formatDateValue = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

function getDateRange(period, customFrom, customTo) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let from = new Date(today)
  let to = new Date(today)

  if (period === 'thisWeek') {
    const weekdayOffset = (today.getDay() + 6) % 7
    from.setDate(today.getDate() - weekdayOffset)
    to.setDate(from.getDate() + 6)
  } else if (period === 'thisMonth') {
    from = new Date(today.getFullYear(), today.getMonth(), 1)
    to = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  } else if (period === 'last7Days') {
    from.setDate(today.getDate() - 6)
  } else if (period === 'last30Days') {
    from.setDate(today.getDate() - 29)
  } else if (period === 'lastMonth') {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    to = new Date(today.getFullYear(), today.getMonth(), 0)
  } else if (period === 'thisYear') {
    from = new Date(today.getFullYear(), 0, 1)
    to = new Date(today.getFullYear(), 11, 31)
  } else if (period === 'custom') {
    from = new Date(`${customFrom}T00:00:00`)
    to = new Date(`${customTo}T00:00:00`)
    if (!customFrom || !customTo || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return null
    }
  }

  return { from: formatDateValue(from), to: formatDateValue(to) }
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value)
  const safeText = /^[\t\r=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function createReportRows(report) {
  const rows = [
    [report.projectName],
    [report.title],
    ['Generated', new Date(report.generatedAt).toLocaleString()],
    ['Date range', `${report.from} to ${report.to}`],
    [],
    ['Summary'],
    ['Metric', 'Value'],
    ...report.summary.map(({ label, value }) => [label, value]),
  ]

  for (const table of report.tables) {
    rows.push([], [table.title], table.columns)
    for (const row of table.rows) rows.push(Object.values(row))
  }

  return rows
}

export default function ReportPanel({ token, endpoint }) {
  const [period, setPeriod] = useState('thisMonth')
  const [customFrom, setCustomFrom] = useState(formatDateValue(new Date()))
  const [customTo, setCustomTo] = useState(formatDateValue(new Date()))
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const generateReport = async (event) => {
    event.preventDefault()
    const range = getDateRange(period, customFrom, customTo)

    if (!range) {
      setError('Choose a valid custom date range.')
      return
    }

    setBusy(true)
    setError('')
    setReport(null)
    try {
      const query = new URLSearchParams(range)
      const response = await fetch(`${endpoint}?${query}`, {
        headers: { Authorization: 'Bearer ' + token },
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Could not generate the report.')
      setReport(result)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  const downloadCsv = () => {
    const contents = createReportRows(report)
      .map((row) => row.map(escapeCsv).join(','))
      .join('\r\n')
    const blob = new Blob([`\uFEFF${contents}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `doctor-booking-report-${report.from}-to-${report.to}.csv`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const printReport = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setError('Allow pop-ups to print or save this report as PDF.')
      return
    }

    const summaryRows = report.summary.map(({ label, value }) =>
      `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')
    const tables = report.tables.map((table) => {
      const headers = table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')
      const rows = table.rows.map((row) => `<tr>${Object.values(row)
        .map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')
      return `<section><h2>${escapeHtml(table.title)}</h2><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></section>`
    }).join('')

    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(report.title)}</title><style>
      body{font:12px Arial,sans-serif;color:#24333a;margin:24px}h1{font-size:22px;margin-bottom:4px}h2{font-size:16px;margin:24px 0 8px}
      p{color:#5d6b65}.summary{width:100%;max-width:520px;margin:18px 0 26px}table{width:100%;border-collapse:collapse;margin-bottom:20px}
      th,td{border:1px solid #dfe6e1;padding:7px;text-align:left;vertical-align:top}th{background:#f2f6f3}
      @page{margin:18mm;@bottom-right{content:"Page " counter(page)}}
      @media print{body{margin:0}section{break-inside:avoid}}
    </style></head><body><h1>${escapeHtml(report.projectName)}</h1><h2>${escapeHtml(report.title)}</h2>
      <p>Generated: ${escapeHtml(new Date(report.generatedAt).toLocaleString())}<br>Date range: ${escapeHtml(report.from)} to ${escapeHtml(report.to)}</p>
      <h2>Summary</h2><table class="summary"><tbody>${summaryRows}</tbody></table>${tables}</body></html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  return (
    <section className="report-panel">
      <div className="report-heading">
        <div><p className="eyebrow">REPORTS &amp; ANALYTICS</p><h2>Generate Report</h2></div>
        {report && <div className="report-export-actions">
          <button type="button" onClick={downloadCsv}>Download CSV</button>
          <button type="button" onClick={printReport}>Print / Save PDF</button>
        </div>}
      </div>
      <form className="report-filters" onSubmit={generateReport}>
        <label>Report period<select value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value="today">Today</option>
          <option value="thisWeek">This Week</option>
          <option value="thisMonth">This Month</option>
          <option value="last7Days">Last 7 Days</option>
          <option value="last30Days">Last 30 Days</option>
          <option value="lastMonth">Last Month</option>
          <option value="thisYear">This Year</option>
          <option value="custom">Custom Date Range</option>
        </select></label>
        {period === 'custom' && <>
          <label>From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} required /></label>
          <label>To<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} required /></label>
        </>}
        <button type="submit" disabled={busy}>{busy ? 'Generating...' : 'Generate Report'}</button>
      </form>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {report && <>
        <p className="report-meta">Generated {new Date(report.generatedAt).toLocaleString()} · {report.from} to {report.to}</p>
        <div className="report-summary">{report.summary.map(({ label, value }) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
        {report.tables.map((table) => <section className="report-table-section" key={table.title}>
          <h3>{table.title}</h3>
          <div className="admin-table-wrap"><table><thead><tr>{table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{table.rows.map((row, index) => <tr key={`${table.title}-${index}`}>{Object.values(row).map((value, valueIndex) => <td key={`${table.title}-${index}-${valueIndex}`}>{value ?? ''}</td>)}</tr>)}</tbody>
          </table></div>
          {!table.rows.length && <p className="report-empty">No records in this date range.</p>}
        </section>)}
      </>}
    </section>
  )
}
