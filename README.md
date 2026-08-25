# Ontology Harness

Point it at a data source. It observes the data, works out what the data
*means*, builds an ontology, checks it, works out what it still does not know —
and decides for itself whether knowing more is worth the effort.

---

## The ideas

### 1. The loop decides its own length

Most schema-to-ontology tools run a fixed pipeline: dump the schema, ask a
model, print the result. This does not.

The loop is **observe → discover → build → validate → find gaps → decide
depth**. That last step is a real decision with three outcomes:

| Decision | What happens next |
|---|---|
| **Stop** | Finalize the ontology. |
| **Refine** | Another pass over the same nodes. |
| **Go deeper** | Pick a branch, plan observations against it, gather evidence, reason over it, re-enter the loop. |

Every iteration after the first exists because the depth controller asked for
it, and ends when the controller says so or a hard limit intervenes.

### 2. Depth is asymmetric, and earned

Different parts of an ontology deserve different amounts of attention. A lookup
table finished at depth 2 is finished. A revenue concept tangled up with
refunds, cancellations and three currencies may deserve depth 5.

Depth is **derived by the engine from what the ontology actually contains**,
never read from a model response. A node reaches tier 5 because a metric is
grounded in it, not because a model said so.

### 3. The model reasons, TypeScript executes

| Rule | How it is enforced |
|---|---|
| The model never touches the database | It picks from nine fixed observation types; identifiers are regex-validated and quoted. |
| The model never mutates the ontology | It emits typed operations; the engine applies them to a copy, validates, and commits only if valid. |
| Inference never becomes fact | Every assertion carries a status, a confidence and evidence. `OBSERVED` without evidence is refused. |
| The loop cannot run away | Hard limits, plus a stall detector, plus guards that downgrade an over-reaching `GO_DEEPER` to `STOP`. |
| Secrets never reach the model | `DATABASE_URL` and `LLM_API_KEY` are read only by the config module. |

### 4. How it sees the database

One SQL pass at the start of every run maps the whole schema — tables,
columns, primary keys, declared foreign keys — via PostgreSQL's system
catalog. That raw map seeds the first LLM call, which decides which tables
are actually **entities** (a `customer_addresses` table doesn't get its own
entity, it merges into `Customer`) and which are mechanism — join tables,
audit logs, staging copies.

Everything after that is on-demand: the model picks one of nine fixed query
**tools** and a target, `ObservationExecutor` validates and quotes the
identifier and runs it, and the result comes back as evidence for the next
decision. Full catalog of every tool — what it asks, the exact SQL, what it
returns — is in [`tools/`](tools/).

---

## How to run

Everything is configuration — there are no flags beyond `--interactive`.
Settings come from environment variables or a `.env` file.

### Build first

```powershell
npm install
npm run build
```

### Offline: no database, no model

A fixture observer and a scripted provider are registered in the real registry,
so the whole loop runs with nothing installed. Create `.env`:

```
SOURCE_KIND=fixture
LLM_PROVIDER=mock
LLM_MODEL=scripted
LLM_MOCK_SCRIPT=./tests/fixtures/llm/asymmetric-depth.json
```

Then pick one:

```powershell
npm start          # one run, print the report, exit
npm run cli        # interactive shell
```

### Interactive shell

`npm run cli` (or `node dist/index.js --interactive`) opens a prompt. One run
and exit stays the default, because that is what the container runs.

| Command | Does |
|---|---|
| `run` | Execute one exploration with the current settings |
| `config` / `keys` | Show settings / list what can be changed |
| `set <KEY> <VALUE>` | Change a setting for the next run |
| `unset <KEY>` | Drop an override, falling back to `.env` |
| `summary` `depth` `decisions` `gaps` `risks` | Views of the loaded run |
| `node <id>` | Everything the ontology holds about one node |
| `runs` / `load <runId>` | List saved runs / reopen one |
| `report` | Reprint the full report |
| `help` / `exit` | — |

**`run` shows progress as it happens**, not just the finished report — one
line per checkpoint (connecting, initial discovery, each depth decision with
its reason, the completion pass), each timestamped from the start of the run:

```
ontology> run
  running mock/scripted over fixture ...
  [0.0s] connecting and reading the schema ...
  [0.0s] discovery 3 entities, depth 2
  [0.0s] iteration 1 GO_DEEPER -> customer, order
        A declared foreign key links orders to customers; without the...
  [0.0s] iteration 2 GO_DEEPER -> order
        Revenue is not defined. total_amount mixes cancelled orders...
  [0.0s] iteration 3 STOP
        Revenue now states its exclusions and Net Revenue names its...
  [0.0s] writing the completion summary ...
```

Three things worth knowing:

- **A bad `set` is rejected and reverted**, not carried into the next run. The
  shell stays alive through configuration errors, so `set` is how you fix them.
- **Logs default to `warn`** in the shell, because structured logs and the
  prompt share stderr; the progress lines above cover what `LOG_LEVEL info`
  used to be needed for. `set LOG_LEVEL info` still turns the raw JSON logs
  back on for debugging — if your `.env` already sets `LOG_LEVEL=info`, both
  will print, which is noisy; `set LOG_LEVEL warn` quiets it back down.
- **Tab-completes commands and `set`/`unset` keys**, and **remembers command
  history across sessions** (`~/.ontology-harness_history`, capped at 200
  lines) — both need a real terminal and are silently inactive when stdin or
  stdout is piped, same as any shell's history.

### Connect to any database or warehouse

```
ontology> connect postgresql://user:password@host:5432/mydb
  PostgreSQL <- postgresql://user:***@host:5432/mydb
  connected. try run
```

A scheme in the URL picks the driver — the same registry the batch run resolves
`DATABASE_URL` through, so `connect` and `.env` reach the same code. `sources`
lists every scheme it recognises and how far that driver has actually been
taken:

| Tier | Meaning |
|---|---|
| **verified** | Observation queries run against a live instance |
| **wire-compatible** | Connects through the PostgreSQL driver; the queries themselves are untested against this system |
| **not implemented** | Recognised, refused with the package it would need |

| Tier | Schemes |
|---|---|
| verified | `postgres`, `postgresql`, `timescale`, `citus`, `neon`, `supabase`, `alloydb` |
| wire-compatible | `redshift`, `cockroachdb`, `greenplum`, `yugabyte`, `materialize`, `risingwave` |
| not implemented | `snowflake`, `bigquery`, `mysql`, `mssql`, `clickhouse`, `duckdb`, `sqlite`, `trino`, `athena`, `oracle`, … |

**"Wire-compatible" is a real caveat, not a formality.** `PostgreSQLObserver` is
ten fixed queries against `pg_catalog` — `pg_class`, `pg_namespace`,
`obj_description()`, `reltuples`. Redshift forked before those took their
current shape; CockroachDB emulates the catalog with `reltuples` unpopulated.
Connecting works; some observations may fail or come back empty. `connect`
prints the warning when it applies.

A password never appears in cleartext: `connect` echoes the URL with it
replaced by `***`, and the same masking applies everywhere `DATABASE_URL`
shows up — `config`, its overrides footer, a failed connection's error.

A bad or unrecognised URL is rejected at the point it's typed, before it
touches any session state:

```
ontology> connect snowflake://user:pw@account/db
 ERROR  No observer is implemented for Snowflake. Building one needs the
 `snowflake-sdk` package, plus the ten queries in the DatabaseObserver
 interface expressed in its dialect.
```

In a container, the shell is a separate service behind a profile, so
`docker compose up` never starts it:

```powershell
docker compose run --rm cli
```

It has no `depends_on`, so a fixture-mode session starts immediately. Bring up
the database yourself first when the session needs it:

```powershell
docker compose up -d postgres
docker compose run --rm cli
```

### Telling it what to expect

`EXPECTED_SCHEMA` is an optional free-text hint of what the source should
roughly contain, added to the discovery prompt when set:

```powershell
$env:EXPECTED_SCHEMA="a customers table, an orders table, and a products table"
```

or in the shell: `set EXPECTED_SCHEMA a customers table, an orders table...`

It's a steer, not a fact — the prompt (`prompts/v1/ontology/expected-schema.md`)
explicitly tells the model to verify it against the real observations, not
trust it. Unset by default, so leaving it out changes nothing.

### With PostgreSQL and a local model

```powershell
copy .env.example .env
ollama serve
ollama pull qwen3:8b
docker compose up
```

Compose starts PostgreSQL (seeded from `sql/`) and the harness. The model is
deliberately **not** containerised — point `LLM_BASE_URL` at a host model via
`host.docker.internal`, or at any cloud endpoint.

| Service | Starts with `up` | What it does |
|---|---|---|
| `postgres` | yes | Seeded database |
| `ontology-harness` | yes | One run, then exits |
| `cli` | no (profile `cli`) | Interactive shell, via `docker compose run --rm cli` |

Both harness services read one shared environment block, so a setting cannot
drift between the batch run and the shell meant to reproduce it. Every value is
overridable from `.env` or the host environment.

### Setting variables without a `.env`

PowerShell does not accept the `VAR=x command` form:

```powershell
$env:SOURCE_KIND="fixture"; $env:LLM_PROVIDER="mock"; npm start
```

### Swapping models

No ontology code changes between these:

```
LLM_PROVIDER=ollama              LLM_MODEL=qwen3:8b  LLM_BASE_URL=http://localhost:11434
LLM_PROVIDER=openai-compatible   LLM_MODEL=qwen3     LLM_BASE_URL=http://localhost:8000/v1
LLM_PROVIDER=deepseek            LLM_MODEL=deepseek-v4-pro   LLM_API_KEY=sk-...
```

### DeepSeek

DeepSeek speaks the OpenAI `/chat/completions` shape, so the provider is a thin
delegation that supplies the endpoint and refuses to start without a key:

```
LLM_PROVIDER=deepseek
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-v4-pro
```

| Model | Notes |
|---|---|
| `deepseek-v4-flash` | Cheapest |
| `deepseek-v4-pro` | Strongest |
| `deepseek-v4-flash-vision-exp` | Experimental, accepts images |

**Nothing about DeepSeek is compiled in.** The endpoint, the models that accept
images and the context window are vendor facts that can change without warning,
so they are settings with defaults, not constants:

| Variable | Default |
|---|---|
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `DEEPSEEK_VISION_MODELS` | `deepseek-v4-flash-vision-exp` (comma-separated) |
| `DEEPSEEK_MAX_CONTEXT_TOKENS` | `1000000` |

If DeepSeek renames a model or moves the endpoint, that is an `.env` edit.

Three things that follow from DeepSeek's documented behaviour:

- **`LLM_BASE_URL` is not needed** — it falls back to `DEEPSEEK_BASE_URL`. Set it
  only to route through a proxy. **In Docker it must be set explicitly**,
  because compose always supplies the Ollama default.
- **`json_schema` is not claimed**, only `json_object`, so the client starts one
  rung down its constraint ladder. Output is Zod-validated either way.
- **`json_object` requires the literal word "json" in the prompt.** Every call
  carries `prompts/v1/system/base.md`, which says "one JSON object and nothing
  else" — so this holds today, but it is a constraint on editing that file.

A missing key is caught by config validation at startup, not as a 401 halfway
through a run.

### Temperature

`LLM_TEMPERATURE` defaults to `0` and applies to every call. That's the right
default: every agent but one produces structural output consumed directly by
code — typed operations, an enum decision, numeric scores feeding the depth
guards — and a higher temperature there only raises the odds of a correction
retry, for nothing in return.

The one exception is `CompletionAgent`'s closing summary and risk list — prose
for a human reader, not parsed by anything. `LLM_COMPLETION_TEMPERATURE`
overrides just that call; it's unset by default, so nothing changes unless you
set it.

---

## Expected results

### What a run prints

**stdout** gets the report; **stderr** gets structured JSON logs. Split them
with `node dist/index.js 2>run.log`.

The report has five parts:

1. **Counts** — entities, relationships, concepts, metrics, uncertain marks,
   plus iterations, LLM calls, observations, elapsed time.
2. **Semantic depth per node** — a bar per node, shaded by tier.
3. **Exploration decisions** — every depth decision with the reason behind it.
4. **What this data is about** — the completion summary.
5. **What could still be got wrong** — remaining risks, in amber.

### A real run over the demo fixture

```
  3 entities · 1 relationships · 1 concepts · 1 metrics · 1 uncertain
  3 iterations · 10 LLM calls · 4 observations

  revenue      █████  5 METRIC
  net_revenue  █████  5 METRIC
  order        ████   4 CONCEPT
  customer     ███    3 RELATIONSHIP
  product      ██     2 ATTRIBUTE

  stopped by the depth controller
```

Read that as the point of the whole thing:

| Node | Depth | Why it stopped there |
|---|---|---|
| `product` | 2 (ATTRIBUTE) | Identified, attributed, self-contained. Nothing more to say. |
| `customer` | 3 (RELATIONSHIP) | Earned a relationship from a declared foreign key. |
| `order` | 4 (CONCEPT) | Grounds a business concept. |
| `revenue` | 5 (METRIC) | Ambiguous enough that a metric had to make its exclusions explicit. |

Three termination messages are possible: **stopped by the depth controller**
(the good one), **stopped by the stall detector**, or **stopped by a hard
limit**.

### What lands on disk

`./out/ontology-<runId>.json` — the ontology, the depth state, every decision,
the gaps, the validation result, and the completion assessment. The execution
trace lands beside it. Exit code is `1` if the run failed.

### Tests

```powershell
npm test
```

**150 offline tests**, no database or model needed. Ten further tests exercise
the PostgreSQL observer against a live database and skip unless one is
configured:

```powershell
docker compose up -d postgres
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ontology"; npm test
```

The tests that matter most are about **restraint**: branches finish at
different depths, a simple source stops after one assessment, deepening that
costs more than it buys is refused, and a model that answers `GO_DEEPER`
forever is stopped by the harness.

---

## What has not been verified

| Component | Status |
|---|---|
| Exploration loop, ontology engine, depth control, prompts, CLI | Verified end to end, 150 offline tests |
| `PostgreSQLObserver` | Verified against a live PostgreSQL, 10 integration tests |
| Source registry, `connect`, URL redaction | Unit-tested; scheme resolution, masking and error paths all exercised |
| `redshift`/`cockroachdb`/`greenplum`/`yugabyte`/`materialize`/`risingwave` | Route through `PostgreSQLObserver`; **the queries were never run against any of them** |
| `deepseek` provider wiring | Registry, capabilities and config validation are unit-tested; **no live call was made** |
| `OllamaProvider`, `OpenAICompatibleProvider` | **Implemented but never run against a live server** |

No model server or API key was available in the build environment, so the
transport code for the network providers is written to the documented API but
unexercised. `deepseek` delegates to `OpenAICompatibleProvider`, so it inherits
that gap: what is tested is that it registers, defaults its base URL, reports
the right capabilities, and refuses a missing key. Expect to shake the rest out
on first contact with a real endpoint.

DeepSeek's `reasoning_effort` and `thinking` parameters are **not** wired up.
`LLMRequest` has no field for them and the behaviour could not be verified here.

CSV/JSON/API sources, graph visualisation and an HTTP API are **not built** —
`PORT` is carried in configuration so adding an API layer later needs no config
change.
