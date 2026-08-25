# Ontology Harness

An adaptive semantic exploration harness. It observes a data source, reasons
about what the data *means*, builds an ontology, validates it, works out what it
still does not know — and then decides for itself whether knowing more is worth
the effort.

**The LLM reasons. TypeScript executes. Evidence grounds the ontology.
Validation protects it. The depth controller decides how far to go.**

---

## The core idea

Most schema-to-ontology tools run a fixed pipeline: dump the schema, ask a model,
print the result. This does something different.

```
OBSERVE → DISCOVER → BUILD → VALIDATE → FIND GAPS → DECIDE DEPTH
                                                          │
                        ┌─────────────────┬───────────────┤
                        ▼                 ▼               ▼
                      STOP            REFINE          GO DEEPER
                        │                 │               │
                   FINALIZE         same nodes      pick a branch
                                                          │
                                                    plan observations
                                                          │
                                                       evidence
                                                          │
                                                        reason ──┐
                                                                 │
                        ◄────────────────────────────────────────┘
```

Every iteration after the first exists because the depth controller asked for
it, targets what the controller pointed at, and ends when the controller says so
or a hard limit intervenes.

### Depth is asymmetric, and earned

Different parts of an ontology deserve different amounts of attention. A lookup
table finished at depth 2 is finished. A revenue concept tangled up with refunds,
cancellations and three currencies may deserve depth 5.

A real run over the demo schema:

| Node | Depth | Why it stopped there |
|---|---|---|
| `product` | 2 (ATTRIBUTE) | Identified, attributed, self-contained. Nothing more to say. |
| `customer` | 3 (RELATIONSHIP) | Earned a relationship from a declared foreign key. |
| `order` | 4 (CONCEPT) | Grounds a business concept. |
| `revenue` | 5 (METRIC) | Ambiguous enough that a metric had to make its exclusions explicit. |

Critically, **depth is derived by the engine from what the ontology actually
contains** (`src/ontology/depth.ts`) — never read from a model response. A node
reaches tier 5 because a metric is grounded in it, not because a model said so.

---

## Quick start

### Without a database or a model

The harness ships with a fixture-backed observer and a deterministic scripted
provider registered in the real provider registry, so the whole loop runs
offline:

```bash
npm install
npm test          # 113 tests, no database or model needed
npm run build

SOURCE_KIND=fixture \
LLM_PROVIDER=mock LLM_MODEL=scripted \
LLM_MOCK_SCRIPT=./tests/fixtures/llm/asymmetric-depth.json \
node dist/index.js
```

The run prints a colourised report: a bar chart of per-node semantic depth, each
depth decision with the reason behind it, and the risks the ontology still
carries. Colour is applied by meaning — depth shades with tier, anything
uncertain is amber — and chalk strips it automatically when output is piped.

Structured logs go to **stderr**, the report to **stdout**, so `| jq` on the
logs and a readable terminal are not in conflict:

```bash
node dist/index.js 2>run.log        # report on screen, logs to a file
node dist/index.js 2>&1 1>/dev/null | jq   # logs only
```

### With Docker and a local model

```bash
cp .env.example .env
ollama serve && ollama pull qwen3:8b     # on the host, not in a container
docker compose up
```

Compose starts PostgreSQL (seeded from `sql/`) and the harness. The LLM is
deliberately **not** containerised: point `LLM_BASE_URL` at a host model via
`host.docker.internal`, or at any cloud endpoint.

---

## Configuration

Everything comes from environment variables, validated with Zod at startup, and
`src/config/Config.ts` is the only module that reads `process.env`. An invalid
environment fails immediately rather than halfway through a run.

See `.env.example` for the full set. The ones that matter most:

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `ollama`, `openai-compatible`, `mock` |
| `LLM_MODEL`, `LLM_BASE_URL`, `LLM_API_KEY` | provider connection |
| `SOURCE_KIND` | `postgres` or `fixture` |
| `PROMPTS_DIR`, `PROMPT_VERSION` | which prompt set to run |
| `ONTOLOGY_MAX_*` | hard limits: iterations, LLM calls, nodes, depth, runtime |

### Swapping models

```bash
# local Ollama
LLM_PROVIDER=ollama LLM_MODEL=qwen3:8b LLM_BASE_URL=http://localhost:11434

# local vLLM / LM Studio / llama.cpp
LLM_PROVIDER=openai-compatible LLM_MODEL=qwen3 \
LLM_BASE_URL=http://localhost:8000/v1 LLM_API_KEY=local

# any cloud OpenAI-compatible endpoint
LLM_PROVIDER=openai-compatible LLM_MODEL=<model> \
LLM_BASE_URL=<endpoint> LLM_API_KEY=<key>
```

No ontology code changes between these. Adding a provider means registering one
object in `src/llm/LLMRegistry.ts`.

**Capabilities are negotiated, not assumed.** Providers declare what they
support and the environment can override it, but a native schema constraint is
only ever an optimisation: output is always Zod-validated, and a rejected
`response_format` degrades (`json_schema → json_object → none`) instead of
failing the run. A correction retry drops the constraint entirely, so a wrong
guess about a server cannot make the retry unwinnable.

### What has actually been run

Be aware of where the verification stops:

| Component | Status |
|---|---|
| Exploration loop, ontology engine, depth control, prompts | verified end to end, 113 offline tests |
| `PostgreSQLObserver` | verified against a live PostgreSQL, 10 integration tests |
| `MockProvider` | verified — it drives every loop test |
| `OllamaProvider`, `OpenAICompatibleProvider` | **implemented but never run against a live server** |

No model server was available in the build environment, so the transport code
for the two network providers — the Ollama `format` field, the
`response_format` downgrade ladder — is written to the documented API but
unexercised. Expect to shake it out on first contact with a real endpoint.

---

## Prompts are files, not strings

Every prompt lives in `prompts/<version>/` as Markdown. **No prompt text appears
in `src/` — a test enforces this.** Prompts can be reviewed, diffed, versioned
and swapped without touching or rebuilding the harness, and the Docker image
copies `prompts/` into the runtime stage rather than compiling it away.

```
prompts/v1/
├── system/       base.md, correction.md
├── ontology/     discovery.md, entity-resolution.md,
│                 relationship-detection.md, concept-discovery.md
├── exploration/  depth-decision.md, observation-planning.md,
│                 gap-analysis.md
└── validation/   validation.md, refinement.md, completion.md
```

The loader returns a descriptor — name, version, sha256 — so the execution trace
can attribute every decision to the exact prompt that produced it. Templates
support `{{VARIABLE}}` substitution and nothing else: no expressions, no code.

---

## Safety properties

These are enforced in TypeScript, not requested of the model.

**The LLM never touches the database.** It picks from nine fixed observation
types and supplies a target; identifiers are regex-validated and quoted before
any query runs (`src/observation/`). There is no path from a model response to
arbitrary SQL.

**The LLM never mutates the ontology.** It emits typed operations. The engine
applies them to a *copy*, validates the candidate, and commits only if it is
valid — a batch that would leave the ontology inconsistent is rolled back whole
and the rejection is fed back as a correction signal.

**Inference never becomes fact.** Every assertion carries a status
(`OBSERVED` / `INFERRED` / `DERIVED` / `ASSUMED` / `UNKNOWN`), a confidence and
evidence. `OBSERVED` without evidence is refused. So is confidence ≥ 0.7 with no
evidence.

**The loop cannot run away.** Beyond the hard limits, the depth controller
overrides the model when it over-reaches: `GO_DEEPER` naming a node that does not
exist, or whose expected value does not exceed its complexity cost, becomes
`STOP`. A stall detector ends runs where an iteration changed nothing or a
decision repeats a previous signature — because max-iterations alone would let an
enthusiastic model burn the entire budget.

**Secrets never reach the model.** `DATABASE_URL` and `LLM_API_KEY` are read only
by the config module and never enter a prompt.

---

## Design patterns

Patterns here are load-bearing, not decorative. Each one exists because
something had to be substitutable, and `tests/patterns.test.ts` proves each seam
by actually substituting it.

| Pattern | Where | What it buys |
|---|---|---|
| **Registry + Abstract Factory** | `LLMRegistry` / `LLMProvider.createClient` | A new provider is one object and one registration; no ontology code changes. |
| **Strategy** | `LLMClient`, `DatabaseObserver`, `observationStrategies` | Transport, data source and observation kind vary independently of the loop. `PostgreSQLObserver` and `FixtureObserver` are two implementations of a purpose-built interface — Strategy, not Adapter: nothing foreign is being adapted. |
| **Command** | `OntologyOperation` + `operations/*Handler` | The model proposes; the engine disposes. One handler per operation type. |
| **Composite** | `OntologyValidator` over `ValidationRule[]` | A structural check is a rule object, and a caller can compose its own set. |
| **Chain of Responsibility** | `DepthDecisionPolicy` over `DepthGuard[]` | Each constraint on a depth decision is named, ordered and independently testable. |
| **Template Method** | `BaseAgent.reason`, `defineGroundedNodeHandler` | Shared steps once; only the variant part per agent or node kind. |
| **Decorator** | `StructuredGenerator` wrapping `LLMClient` | Validation, correction retries and budgeting added without touching transport. |
| **Composition Root** | `composition/CompositionRoot.ts` | Object graph construction separated from the control loop it feeds. |
| **Test double as first-class strategy** | `MockProvider` in the real registry | The loop is verifiable offline through the production code path. |

### Two invariants the patterns must not dissolve

**Atomicity stays in the engine.** Handlers mutate a candidate and report
rejections. They get no validator reference and cannot commit — `apply()` alone
runs clone → apply → validate → commit-or-roll-back. A handler that writes an
invalid node is still rolled back, and there is a test for exactly that.

**A guard chain can only reduce work.** `override()` refuses to act once the
decision is `STOP`, so no ordering of guards can turn a stop into more
exploration.

### Patterns deliberately declined

| Rejected | Why |
|---|---|
| **State pattern** for `HarnessStatus` | Twelve states with two-line transitions. State objects would triple the code and scatter the loop the harness is specified to own. |
| **Repository / Unit of Work** over `OntologyStore` | Two methods and a file write. |
| **Visitor** over the ontology | No double-dispatch need exists. |
| **DI container** | The graph is a dozen objects sharing one `AgentDeps`. A container would add a dependency to solve a problem this project does not have. |
| **Any refactor of the two network providers** | They are the only zero-coverage code in the tree. Restructuring unverifiable code trades working-but-untested for changed-and-untested. |
| **Rule objects for `GapAnalyzer.analyzeDeterministic`** | The same Composite treatment applies and would be a fair next step. Left alone this pass because at 167 lines it is not yet painful, and every extraction is a chance to change behaviour — the validator earned it, the gap analyzer has not yet. |

## Layout

```
src/
├── agents/        one agent per responsibility; DepthController is the authority
├── ontology/      Ontology, engine (atomic apply), validator, depth derivation
├── observation/   observer interface, PostgreSQL, fixture, executor
├── llm/           client contract, registry, providers, structured generation
├── exploration/   state, stall detection, step controller
├── prompts/       loader only — no prompt text
├── schemas/       Zod (authoritative) + JSON Schema (provider hint)
├── cli/           terminal presentation, separate from the loop
├── trace/         append-only execution trace
└── OntologyHarness.ts   the control loop
```

## Tests

```bash
npm test
```

113 offline tests covering provider switching and failure, prompt loading and
rendering, structured-output correction and its budget cost, ontology operations
and atomic rollback, evidence grounding, validation, observation safety, and the
loop itself.

Ten further tests exercise the PostgreSQL observer against a live database.
They skip unless one is configured:

```bash
docker compose up -d postgres
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ontology npm test
```

The ones that matter most are about **restraint**:

- branches finish at different depths (Customer 3, Product 2, Revenue 5)
- a simple source stops after one assessment
- deepening that costs more than it buys is refused
- deepening a node that does not exist is refused
- a model that answers `GO_DEEPER` forever is stopped by the harness
- a discovery that yields nothing fails loudly rather than reporting an empty
  ontology as a success

## Scope

Per the MVP definition: PostgreSQL, a local model, and the full adaptive loop.
CSV/JSON/API sources, cloud-specific providers, graph visualisation and the HTTP
API are deliberately **not** built yet — `PORT` is carried in configuration so
adding an API layer later needs no config change.
