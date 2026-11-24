---
document:
  type: "analysis"
  id: "ANALYSIS-AGY-1.5.15-ORCHESTRATOR"
  title: "Antigravity 1.5.15 Orchestrator: plan-and-execute on the wire"
  description: "Captured agy Orchestrator turn: the Orchestrator ids are client-side, the client switches between a planner and an executor model in one conversation through exit_plan_mode / enter_plan_mode"
  status: "published"
  revision: 1
  created_at: "2026-11-24T16:40:49+01:00"
  updated_at: "2026-11-24T16:40:49+01:00"
  created_by: "omp"
  updated_by: "omp"
  changelog:
    - revision: 1
      reason: "answer KB antigravity-internals Q14 before modelling Orchestrator in the provider"
      changes:
        - "catalogue versus agy models versus binary"
        - "captured planner and executor requests with the hand-off"
        - "direct orchestrator ids answer 404"
---

# Antigravity 1.5.15 Orchestrator on the wire

## Setup

agy 1.5.15, consumer OAuth account, `agy -p "<fix calc.py>" --model gemini-pro-orchestrator-neon
--dangerously-skip-permissions` in a scratch workspace, behind `mitmdump` (`HTTPS_PROXY`,
`SSL_CERT_FILE` with the mitm CA). Authorization headers are redacted at capture; the project id is
replaced with `<project>`. Evidence: [`evidence/`](evidence/).

## Findings

1. **The Orchestrator ids are client-side.** `fetchAvailableModels` lists no orchestrator entry
   (not in `models`, `agentModelSorts` or `groupedModels`). `agy models` adds
   `gemini-pro-orchestrator-neon` "Orchestrator (Neon)", `gemini-pro-orchestrator` "Orchestrator
   (Carbon)", `gemini-pro-orchestrator-argon` "Orchestrator (Argon)"; the binary also holds
   `gemini-pro-orchestrator-g1-pro` and an `orchestrator-model-roles` key.
2. **No orchestrator id reaches the server in a normal turn.** Every `streamGenerateContent`
   names a real model: planner `gemini-4-neon-high` (`MODEL_PLACEHOLDER_M532`, `thinkingLevel:
   "HIGH"`), executor `gemini-4-hydrogen-high` (`MODEL_PLACEHOLDER_M525`, `HIGH`), plus
   `gemini-3.5-flash-lite` `agent_monitoring` side calls. One `cascade_id` covers both roles.
3. **Sequence** (`040` → `050`):

   | flow | model | contents | what the model did |
   |---|---|---|---|
   | 040 | neon-high | 1 | `read_file`, `run_command` (read-only investigation) |
   | 042 | neon-high | 3 | `exit_plan_mode(plan)` with numbered steps and a verification command |
   | 045 | hydrogen-high | 5 | `edit_file` |
   | 047 | hydrogen-high | 7 | `run_command` (the plan's verification) |
   | 050 | hydrogen-high | 9 | final text answer |

4. **Hand-off.** The planner gets tool `exit_plan_mode(plan: string)`; the executor gets
   `enter_plan_mode(reason: string)` in its place. All other tools are identical. The
   `exit_plan_mode` function response carries `Plan mode is off.` and a `<SYSTEM_MESSAGE>`
   ("Plan mode is off: this turn runs on the execution model. Carry out the plan below now …")
   wrapping `<plan>…</plan>`. The executor continues the same `contents`.
5. **System prompt per role.** Same base prompt; a two-phase section differs
   ([`system-planner.txt`](evidence/system-planner.txt), [`system-executor.txt`](evidence/system-executor.txt)):
   - planner: plan mode on, investigate read-only (edit tools are refused by the client),
     make every decision, write the plan for a less capable engineer, end with a "Re-plan if:"
     list, then call `exit_plan_mode`; questions and reviews are answered directly without a
     hand-off; a hidden `[plan review]` message opens a review turn.
   - executor: carry out the plan in order, fix small deviations, hand back with
     `enter_plan_mode` after a step fails twice, an assumption breaks, or an unplanned decision
     is needed; a hidden `[plan review due]` message forces a hand-back with a status report.
     The executor prompt adds `efficient_code_reading`, `code_quality` and
     `final_answer_accuracy` blocks (+2,016 characters).
   - Every user message starts a planning turn.
6. **Signatures cross roles.** The executor request keeps the planner's `thoughtSignature`
   parts (Neon signatures sent to Hydrogen) and the server accepts them.
7. **Direct ids are refused.** Replaying flow 040 with `model` set to any of the three
   orchestrator ids (with or without `MODEL_PLACEHOLDER_M537`, `thinkingLevel` `HIGH` or `100`)
   answers `404 NOT_FOUND`; the same body with `gemini-4-neon-high` answers 200. A first
   headless run without `--dangerously-skip-permissions` did send `gemini-pro-orchestrator-neon`
   (enum `M537`, 10 tools, 9.5k prompt) and got a 200 with that `modelVersion`; it did not
   reproduce and its flow was not kept.

## Consequence for pi-auth-plus

Orchestrator cannot be a catalogue row. Offering it means running plan-then-execute in our
own Antigravity stream: two real models, the two-phase prompt section, the
`exit_plan_mode`/`enter_plan_mode` hand-off and cross-role signature carry. Not observed: the
`[plan review due]` interval and the effort defaults for other planner/executor pairs.
