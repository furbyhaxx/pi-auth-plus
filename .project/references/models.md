---
document:
  type: "reference"
  id: "reference-models"
  title: "Current model ids for examples, docs and tests"
  description: "Curated list of current model ids; examples, docs and tests pick model ids only from this list"
  status: "published"
  revision: 3
  created_at: "2026-10-19T16:33:32+02:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "user"
  updated_by: "pi"
  source: "nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/references/models.md"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["document creation"]
      updated_at: "2026-10-22T15:55:00+02:00"
    - revision: 2
      reason: "frontmatter migration"
      changes: ["migrate flat frontmatter to the document block"]
    - revision: 3
      reason: "imported into pi-auth-plus"
      changes: ["copied from nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/references/models.md"]
---

# Current model ids

Examples, docs, tests and specs use model ids from this list only. Ids are nukular `provider/model` references (`claude` maps to models.dev `anthropic`). Capabilities were checked against models.dev and the live Synthetic listing on 2026-10-19. Update this file instead of guessing when a newer model is needed.

## Generate (text; all support reasoning and tool calling)

| Model | Image input | Notes |
|---|---|---|
| `opencode/big-pickle` | no | free, anonymous; free tier requires a tool with properties (tool-less requests need the placeholder opt-in) |
| `opencode/cat-jam-free` | no | free |
| `opencode/deepseek-v4.1-flash-free` | yes | free |
| `opencode/longcat-2.5-preview-free` | yes | free |
| `opencode/mimo-v2.6-flash-free` | yes (also audio, video) | free |
| `opencode/nemotron-3-ultra-free` | no | free |
| `opencode/nemotron-3.5-lightning-free` | no | free |
| `opencode/nemotron-3.5-super-vl-free` | yes | free; default vision model for examples |
| `opencode/muse-spark-1.3-contributor-free` | yes (also pdf, audio, video) | free |
| `opencode/glm-5.3-flash-free` | yes (also pdf, video) | free |
| `opencode/ll-alpha-free` | no | free |
| `openrouter/nvidia/nemotron-3.5-lightning:free` | no | free on OpenRouter (key required, rate-limited); default for examples; live 200 on 2026-10-22 |
| `openrouter/google/gemini-4-argon` | yes | selected for step-4 generation tests; returned logprobs not verified |
| `openrouter/openai/gpt-oss-20b` | no | additional logprob capability-probe candidate, not an enabled classifier; endpoint metadata advertises logprobs, runtime scoring unverified |
| `openai/gpt-6.1-sol` | yes | |
| `openai/gpt-6-luna` | yes | default for the thinking example; not a step-4 classifier target or a Decisions binding |
| `openai/gpt-6-astra` | yes | |
| `openai/gpt-5.5` | yes | |
| `openai/gpt-5.5-pro` | yes | expensive |
| `openai/gpt-5.6-terra` | yes | |
| `openai/gpt-5.6-sol` | yes | |
| `openai/gpt-5.6-luna` | yes | |
| `openai/gpt-daybreak-blue-latest` | yes | |
| `claude/claude-opus-5-5` | yes | subscription (Claude OAuth) |
| `claude/claude-fable-5-1` | yes | subscription (Claude OAuth) |
| `claude/claude-sonnet-5-5` | yes | subscription (Claude OAuth) |
| `claude/claude-haiku-5-5` | yes | subscription (Claude OAuth) |
| `xai/grok-4.7` | yes | |
| `deepseek/deepseek-flash` | yes | |
| `synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash` | yes | |
| `synthetic/hf:moonshotai/Kimi-K3` | yes | |
| `synthetic/hf:Qwen/Qwen3.8-27B` | yes | not on models.dev; from the Synthetic listing |
| `synthetic/hf:zai-org/GLM-5.3` | no | |
| `synthetic/hf:zai-org/GLM-5.3-Flash` | yes | |
| `synthetic/hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4` | no | |
| `synthetic/syn:large:text` | yes | Synthetic alias; id contains `:` |
| `synthetic/syn:small:text` | no | Synthetic alias; selected for step-4 generation tests |
| `synthetic/syn:large:vision` | yes | Synthetic alias |
| `synthetic/syn:small:vision` | yes | Synthetic alias |
| `synthetic/infinite:small:vision` | yes | Synthetic alias |
| `nvidia/deepseek-ai/deepseek-v4.1-flash` | yes | |
| `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` | no | |
| `nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b` | yes (also video) | |
| `nvidia/openai/gpt-oss-20b` | no | |
| `nvidia/z-ai/glm-5.3` | no | |
| `nvidia/z-ai/glm-5.3-flash` | yes (also pdf, video) | |

## Generate with image output

| Model | Notes |
|---|---|
| `openrouter/google/gemini-3.1-flash-image` | default for the image-output example |

## Embed

| Model | Notes |
|---|---|
| `synthetic/hf:nomic-ai/nomic-embed-text-v1.5` | default for the embed example; step-4 Synthetic target |
| `openrouter/voyageai/voyage-4-lite` | selected OpenRouter step-4 text embedding target; replaces direct OpenAI coverage |

## Classify

| Model | Notes |
|---|---|
| `opencode/jev-1.13-free` | native System One classifier; selected step-4 target and classify example default |
| `openrouter/typesafe/jev-1.13` | native System One classifier; selected step-4 OpenRouter target |

## Prompted classification requirement

General generation models must also be usable for classification through ordinary inference endpoints, system instructions and structured outputs. This is a planned adapter feature, distinct from native System One or OpenAI Decisions. It does not make every generation descriptor a native classifier binding. The original `openai/gpt-6-luna` classifier example incorrectly substituted the Decisions endpoint for this intent; step 4 must not require direct OpenAI credits. Adapter API, constraint policy and confidence provenance need design before implementation (SPEC §21).

Token-logprob classification is a third required method for supporting model/route combinations. It reads observed label scores rather than asking the model to invent probabilities. Gate support on the exact route and complete label evidence; missing top-k labels are not zero and conditional label probabilities are not calibrated confidence. None of the three selected generation routes is currently verified for this mode. `openrouter/openai/gpt-oss-20b` is an additional capability-probe candidate: public endpoint metadata advertises both `logprobs` and `top_logprobs` on several routes, but no inference has been run. See `.project/research/logprob-classification/report.md`.

OpenRouter is also selected for step-4 PKCE login through `npcli`. Its code exchange yields an API key; it does not exercise access/refresh-token rotation. See `.project/research/openrouter-oauth/report.md`.

## Step-4 selection evidence (2026-10-21)

- User selected `openrouter/google/gemini-4-argon` and `synthetic/syn:small:text` for generation, JEv through OpenCode/OpenRouter for native classification, and OpenRouter instead of direct OpenAI for the second embedding provider. OpenRouter credit availability is user-reported; no balance or inference request was made.
- [models.dev](https://models.dev/api.json) lists the OpenRouter Gemini route with image input, tools, reasoning and structured-output metadata. Such metadata does not establish a working nukular response-schema API.
- [OpenRouter embedding listing](https://openrouter.ai/api/v1/embeddings/models) lists `voyageai/voyage-4-lite` as a text embedding model. It is selected as a lightweight general-purpose test target; [embedding SDK documentation](https://openrouter.ai/docs/client-sdks/typescript/sdks/embeddings/README.md) confirms generation and model-listing endpoints.
- [OpenCode public listing](https://opencode.ai/zen/v1/models) lists `jev-1.13-free`. [OpenRouter decisions listing](https://openrouter.ai/api/v1/models?output_modalities=decisions) lists `typesafe/jev-1.13`; [System One documentation](https://openrouter.ai/docs/guides/community/typesafe-sdk.md) confirms `/api/v1/systemone` and OpenRouter-key billing. Matching the JEv version across hosts enables cross-provider fixtures; this is not a claim that it is the newest JEv.
- Public listings/docs were checked; anonymous JEv inference, account authorization, Synthetic alias resolution and all selected routes' execution through nukular remain UNVERIFIED until gated live tests. The older capability table retains its original 2026-10-19 evidence unless specifically refreshed above.
