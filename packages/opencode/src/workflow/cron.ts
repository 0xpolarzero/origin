import { Temporal } from "@js-temporal/polyfill"

const minute_ms = 60_000

const month_names = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
} as const

const weekday_names = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
} as const

type Field = {
  any: boolean
  values: Set<number>
}

type Spec = {
  minute: Field
  hour: Field
  day_of_month: Field
  month: Field
  day_of_week: Field
}

type RunItem = {
  kind: "run"
  slot_local: string
  slot_utc: number
}

type SkipItem = {
  kind: "skip"
  reason_code: "cron_missed_slot" | "dst_gap_skipped"
  slot_local: string
  slot_utc: number | null
}

type Event = RunItem | SkipItem

function local(value: Temporal.ZonedDateTime | Temporal.PlainDateTime, timezone: string) {
  if (value instanceof Temporal.ZonedDateTime) {
    return value.toString({ smallestUnit: "minute" })
  }
  return `${value.toString({ smallestUnit: "minute" })}[${timezone}]`
}

function range(min: number, max: number) {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index)
}

function normalize(value: number, min: number, max: number, wrap = false) {
  if (wrap && value === max + 1) return min
  if (value < min || value > max) {
    throw new Error(`cron field value out of range: ${value}`)
  }
  return value
}

function parse_atom(input: string, names?: Record<string, number>, wrap = false) {
  const key = input.trim().toLowerCase()
  if (!key) throw new Error("cron field is empty")
  const named = names?.[key]
  if (named !== undefined) return named
  const value = Number.parseInt(key, 10)
  if (Number.isNaN(value)) {
    throw new Error(`invalid cron field value: ${input}`)
  }
  if (wrap && value === 7) return 0
  return value
}

function parse_part(
  part: string,
  min: number,
  max: number,
  names?: Record<string, number>,
  wrap = false,
) {
  const [base_raw, step_raw] = part.split("/")
  const step = step_raw ? Number.parseInt(step_raw, 10) : 1
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`invalid cron step: ${part}`)
  }

  const base = base_raw.trim()
  if (base === "*" || base === "?") {
    return range(min, max).filter((value) => (value - min) % step === 0)
  }

  if (!base.includes("-")) {
    return [normalize(parse_atom(base, names, wrap), min, max, wrap)]
  }

  const [start_raw, end_raw] = base.split("-")
  const start = normalize(parse_atom(start_raw, names, wrap), min, max, wrap)
  const end = normalize(parse_atom(end_raw, names, wrap), min, max, wrap)
  if (end < start) {
    throw new Error(`invalid cron range: ${part}`)
  }

  return range(start, end).filter((value) => (value - start) % step === 0)
}

function parse_field(
  raw: string,
  min: number,
  max: number,
  names?: Record<string, number>,
  wrap = false,
): Field {
  if (raw === "*" || raw === "?") {
    return {
      any: true,
      values: new Set(range(min, max)),
    }
  }

  const values = raw
    .split(",")
    .flatMap((part) => parse_part(part, min, max, names, wrap))
    .map((value) => normalize(value, min, max, wrap))

  return {
    any: false,
    values: new Set(values),
  }
}

function parse(input: string): Spec {
  const parts = input.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`unsupported cron expression: ${input}`)
  }

  return {
    minute: parse_field(parts[0]!, 0, 59),
    hour: parse_field(parts[1]!, 0, 23),
    day_of_month: parse_field(parts[2]!, 1, 31),
    month: parse_field(parts[3]!, 1, 12, month_names),
    day_of_week: parse_field(parts[4]!, 0, 6, weekday_names, true),
  }
}

function dow(input: Temporal.ZonedDateTime | Temporal.PlainDateTime) {
  return input.dayOfWeek % 7
}

function match(spec: Spec, input: Temporal.ZonedDateTime | Temporal.PlainDateTime) {
  if (!spec.minute.values.has(input.minute)) return false
  if (!spec.hour.values.has(input.hour)) return false
  if (!spec.month.values.has(input.month)) return false

  const dom = spec.day_of_month.values.has(input.day)
  const day_of_week = spec.day_of_week.values.has(dow(input))
  if (!spec.day_of_month.any && !spec.day_of_week.any) {
    return dom || day_of_week
  }
  if (!spec.day_of_month.any) return dom
  if (!spec.day_of_week.any) return day_of_week
  return true
}

function boundary(value: number) {
  return Math.floor(value / minute_ms) * minute_ms
}

function gap(
  prev: Temporal.ZonedDateTime | undefined,
  current: Temporal.ZonedDateTime,
  spec: Spec,
  timezone: string,
) {
  if (!prev) return [] as SkipItem[]

  const delta = Number((current.offsetNanoseconds - prev.offsetNanoseconds) / 60_000_000_000)
  if (delta <= 0) return [] as SkipItem[]

  return range(1, delta)
    .map((index) => prev.toPlainDateTime().add({ minutes: index }))
    .filter((item) => match(spec, item))
    .map(
      (item) =>
        ({
          kind: "skip",
          reason_code: "dst_gap_skipped",
          slot_local: local(item, timezone),
          slot_utc: null,
        }) satisfies SkipItem,
    )
}

export namespace WorkflowCron {
  export type Run = RunItem
  export type Skip = SkipItem

  export function parse_expression(input: string) {
    return parse(input)
  }

  export function evaluate(input: {
    cron: string
    timezone: string
    cursor_at: number
    now: number
  }) {
    const spec = parse(input.cron)
    const current = boundary(input.now)
    if (current <= input.cursor_at) {
      return {
        cursor_at: input.cursor_at,
        execute: null as Run | null,
        skipped: [] as Skip[],
      }
    }

    const events: Event[] = []
    let prev: Temporal.ZonedDateTime | undefined

    for (let utc = input.cursor_at + minute_ms; utc <= current; utc += minute_ms) {
      const instant = Temporal.Instant.fromEpochMilliseconds(utc)
      const item = instant.toZonedDateTimeISO(input.timezone)
      events.push(...gap(prev, item, spec, input.timezone))
      if (match(spec, item)) {
        events.push({
          kind: "run",
          slot_local: local(item, input.timezone),
          slot_utc: utc,
        })
      }
      prev = item
    }

    const last = [...events].reverse().find((item): item is RunItem => item.kind === "run")
    const execute = last?.slot_utc === current ? last : null
    const skipped = events.flatMap((item) => {
      if (item.kind === "skip") return [item]
      if (execute && item.slot_utc === execute.slot_utc) return []
      return [
        {
          kind: "skip",
          reason_code: "cron_missed_slot",
          slot_local: item.slot_local,
          slot_utc: item.slot_utc,
        } satisfies SkipItem,
      ]
    })

    return {
      cursor_at: current,
      execute,
      skipped,
    }
  }
}
