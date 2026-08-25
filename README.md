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

Two things worth knowing:

- **A bad `set` is rejected and reverted**, not carried into the next run. The
  shell stays alive through configuration errors, so `set` is how you fix them.
- **Logs default to `warn`** in the shell, because structured logs and the
  prompt share stderr. `set LOG_LEVEL info` turns the commentary back on.

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
```

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

**113 offline tests**, no database or model needed. Ten further tests exercise
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
| Exploration loop, ontology engine, depth control, prompts, CLI | Verified end to end, 113 offline tests |
| `PostgreSQLObserver` | Verified against a live PostgreSQL, 10 integration tests |
| `OllamaProvider`, `OpenAICompatibleProvider` | **Implemented but never run against a live server** |

No model server was available in the build environment, so the transport code
for the two network providers is written to the documented API but unexercised.
Expect to shake it out on first contact with a real endpoint.

CSV/JSON/API sources, graph visualisation and an HTTP API are **not built** —
`PORT` is carried in configuration so adding an API layer later needs no config
change.
