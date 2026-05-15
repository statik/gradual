import { Hono } from 'hono'
import type { AppContext } from '../types.js'

export interface DatasetEntry {
  id: string
  name: string
  description: string
  format: 'csv' | 'parquet'
  filename: string
  /** Upstream source — fetched server-side so the browser never sees it and CORS/auth is irrelevant. */
  url: string
  approxBytes: number
  /** Extra guidance surfaced to the agent when this dataset is mounted. */
  note?: string
}

const CATALOG: DatasetEntry[] = [
  {
    id: 'iris',
    name: 'Iris',
    description: '150 iris flowers, 4 measurements + species. The classic classification toy set.',
    format: 'csv',
    filename: 'iris.csv',
    url: 'https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv',
    approxBytes: 4_000,
  },
  {
    id: 'penguins',
    name: 'Palmer Penguins',
    description: '344 penguins: species, island, bill/flipper measurements, body mass, sex.',
    format: 'csv',
    filename: 'penguins.csv',
    url: 'https://raw.githubusercontent.com/mwaskom/seaborn-data/master/penguins.csv',
    approxBytes: 17_000,
  },
  {
    id: 'titanic',
    name: 'Titanic',
    description: '891 passengers: survival, class, sex, age, fare, embarkation.',
    format: 'csv',
    filename: 'titanic.csv',
    url: 'https://raw.githubusercontent.com/mwaskom/seaborn-data/master/titanic.csv',
    approxBytes: 57_000,
  },
  {
    id: 'tips',
    name: 'Restaurant Tips',
    description: '244 restaurant bills: total, tip, sex, smoker, day, time, party size.',
    format: 'csv',
    filename: 'tips.csv',
    url: 'https://raw.githubusercontent.com/mwaskom/seaborn-data/master/tips.csv',
    approxBytes: 9_000,
  },
  {
    id: 'seattle-weather',
    name: 'Seattle Weather',
    description: '~1,460 daily observations: precipitation, temp max/min, wind, weather label.',
    format: 'csv',
    filename: 'seattle-weather.csv',
    url: 'https://cdn.jsdelivr.net/npm/vega-datasets@3.2.1/data/seattle-weather.csv',
    approxBytes: 48_000,
  },
  {
    id: 'userdata-parquet',
    name: 'User Data (Parquet)',
    description: '1,000 synthetic user records: registration time, name, country, salary — a classic sample Parquet file.',
    format: 'parquet',
    filename: 'userdata1.parquet',
    url: 'https://raw.githubusercontent.com/Teradata/kylo/master/samples/sample-data/parquet/userdata1.parquet',
    approxBytes: 114_000,
    note: 'Parquet — read with `import pyarrow` then `pd.read_parquet(path)`. pyarrow auto-loads on first import.',
  },
]

export const datasets = new Hono<AppContext>()

datasets.get('/', (c) => {
  return c.json({
    datasets: CATALOG.map(({ url: _url, ...rest }) => rest),
  })
})

datasets.get('/:id/download', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const entry = CATALOG.find((d) => d.id === c.req.param('id'))
  if (!entry) return c.json({ error: 'unknown_dataset' }, 404)

  let upstream: Response
  try {
    upstream = await fetch(entry.url, {
      signal: c.req.raw.signal,
      headers: { 'user-agent': 'gradual-dataset-proxy' },
      redirect: 'follow',
    })
  } catch (err) {
    return c.json({ error: 'upstream_unreachable', detail: String(err) }, 502)
  }

  if (!upstream.ok || !upstream.body) {
    return c.json({ error: 'upstream_failed', status: upstream.status }, 502)
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': entry.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${entry.filename}"`,
      'Cache-Control': 'no-store',
      'X-Dataset-Filename': entry.filename,
      'X-Dataset-Format': entry.format,
    },
  })
})
