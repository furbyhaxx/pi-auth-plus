---
document:
  type: "research"
  id: "research-tokenizers"
  title: "M3 offline tokenizer support"
  description: "Vendor tokenizer artifacts, offline JavaScript runtimes, request overhead, and observed usage ratios for pi-auth-plus M3"
  status: "published"
  revision: 1
  created_at: "2026-10-27T19:39:45+01:00"
  updated_at: "2026-10-27T19:39:45+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "initial research report"
      changes: ["verified offline tokenizer sources and runtime constraints for M3"]
---

# M3 offline tokenizer support

## TL;DR

- **Best shared runtime for Hugging Face tokenizer files:** `@huggingface/tokenizers@0.2.0` (Apache-2.0, pure JS/TS, zero dependencies; about 99 KB ESM runtime, 8.3 KB gzip per its README). It reads a model's `tokenizer.json` and `tokenizer_config.json`, so the vocab stays in file assets rather than JS bytecode. Node and browsers are documented; Bun and Pi-Bolt AOT need a smoke test. It does not render model chat templates. [7]
- **OpenAI:** `gpt-oss-120b` has a model-matched Apache-2.0 `tokenizer.json` (27.9 MB) and a published Harmony template. The official tiktoken registry maps `gpt-oss-*` to `o200k_harmony`, whose rank data reuses `o200k_base` (3,613,922 bytes); current official tiktoken does **not** map the supplied GPT-6 ids. `gpt-tokenizer` supports `o200k_harmony`, but its `o200k_base` rank table is a 2.43 MB JavaScript module, over this project's 256 KB bytecode ceiling; do not import it unchanged. [1–5]
- **Google:** current GenAI SDK docs expose a remote `models.countTokens` call for Gemini, not a documented local tokenizer. Gemma 4 has a public 32.2 MB Apache-2.0 tokenizer file, but Google sources reviewed do not say it is the Gemini 3.8/4 Argon vocabulary. Do not use Gemma as a Gemini tokenizer without a verified mapping. [9, 10]
- **Anthropic and xAI:** no public vendor-endorsed standalone offline tokenizer was found. Anthropic documents `messages/count_tokens`; it returns an estimate and covers active models. xAI documents token usage/billing but no preflight tokenizer or count endpoint was found. [11, 13]
- **DeepSeek / Synthetic open models:** DeepSeek provides a vendor-official V4 tokenizer zip (1,911,504 bytes compressed; 6,367,096-byte tokenizer JSON), but the archive has no license file and does not document a match to the `deepseek-flash` alias. The Synthetic HF V4.1-Flash-1017, Qwen3.8-27B and GLM-5.3/Flash repos expose their own model-specific tokenizers. Kimi-K3 exposes prompt-encoding code, but no `tokenizer.json` in its root listing. [14–18]
- **Accuracy:** a real tokenizer would most clearly improve tail estimates for Claude, JSON/tool content on Gemini and GPT-OSS, and the anomalous Synthetic DeepSeek route. The Synthetic route's reported counts are already suspect; tokenizer counts must not be treated as its billed counts until checked. [20]

## Scope and evidence rules

This report covers the supplied current ids for `claude`, `antigravity`, OpenAI/Codex, `xai`, `deepseek`, Synthetic HF models and opencode Zen. Local model ids and the live-ratio measurements were read from `.project/references/models.md` (capability snapshot dated 2026-10-19) and `.project/analyses/tokens/usage-audit/report.md` (published 2026-10-27). [20, 21]

Official vendor/model sources and registries were checked on **2026-10-27**. Where a live page or repository has no publication date, the source entry says “accessed 2026-10-27”; explicit release/page dates are noted. A model-family name, route label or similar-looking model id is not evidence that the provider uses the same tokenizer or prompt template. A tokenizer file counts token IDs for its model vocabulary; it does not automatically reproduce another host's wrappers, multimodal expansion, policy text, tools or billing rules.

The artifact comparison distinguishes (a) exact model artifact, (b) model family/encoding candidates, and (c) API usage or count endpoints. “No public artifact found” means none was located in the first-party documentation/repos checked, not proof that a private internal tokenizer does not exist.

## Findings by model family

### Anthropic Claude 5.5 / Fable 5.1

**Offline source:** no public standalone tokenizer or vocabulary file for Claude 3 or later was found in Anthropic's public docs/repos checked. Do not substitute a GPT or Gemma tokenizer. Anthropic's public, supported alternative is `POST https://api.anthropic.com/v1/messages/count_tokens`; it uses the Messages request shape and returns an input-token estimate. Anthropic says all active models are supported, including the 5.5 ids shown in current docs. [11]

Anthropic warns the count can differ slightly from the actual message input count and may include automatically added system-optimization tokens that are not billed. It does not accept server tools (except the advisor tool), MCP connector input, or remote URL/file image/document sources; send image/PDF bytes as base64. Messages with server tools/MCP should use returned `usage`. [11]

Current docs state Claude 4.7 and later use a newer tokenizer that yields roughly 30% more tokens than earlier models, with content-dependent variation. This applies to the supplied 5.5 models by version ordering, but not a public encoding specification. [11]

**Runtime/counting:** no local JS library can reproduce the private vocabulary. The Anthropic count endpoint is a server call, not offline. It may not be usable with this package's Claude subscription OAuth credentials: the public examples use Anthropic API-key authentication; compatibility with this provider's auth flow is unverified. Antigravity-hosted Claude is a separate route and should not call the Anthropic endpoint unless its credential/route allows it.

**Template overhead and accuracy:** there is no documented fixed “tokens per message/tool” constant. The API count endpoint handles system, message and client tool inputs using the request structure, but it is an estimate; hidden system-added tokens are not billed. In the live audit, direct Claude prose was 2.73 characters/token and the JSON tool-result sample 2.7; Antigravity Claude's JSON sample was 2.08 chars/token. Pi's 4-chars/token estimate was 41.8% low on the direct Claude JSON tail and 55.4% low on the Antigravity Claude tail. A correct Claude tokenizer would materially improve text-tail counting, but no public offline source exists. [11, 20]

### Google Gemini 4 Argon / Gemini 3.8 Flash (Antigravity)

**Offline source:** the current official `@google/genai` SDK provides `client.models.countTokens(...)`, but the documented implementation calls Google's model count API; no local tokenizer API/artifact is documented in the SDK pages reviewed. The 2026-10-27 docs demonstrate `gemini-3.8-flash`; SDK changelog 2.30.0 added Gemini 4 Argon on 2026-10-14 and 2.21.0 added Gemini 3.8 Flash on 2026-09-02. This verifies online endpoint/model coverage in official SDK docs, not local vocabulary coverage. [9, 10]

The remote Gemini count endpoint returns input-only counts; it accepts contents and the SDK supports multimodal inputs. Usage metadata is available from completed interactions and includes input, output, thought, cached-content and tool-use fields. No universal message/tool overhead constant is published. The count request must reproduce the same tools/system instruction/input to account for provider formatting. [10]

**Gemma distinction:** an official Google Gemma 4 model repo exposes `tokenizer.json` (32.2 MB) and `tokenizer_config.json` under Apache-2.0 repository licensing. Google's Gemma formatting docs say Gemma's control tokens are reserved in and specific to its tokenizer. They do not document Gemma/Gemini vocabulary identity, and do not establish that the Gemma 4 file matches Gemini 3.8 or Gemini 4 Argon. Treat this as Gemma-only until Google documents sharing. [10]

**Accuracy:** Google describes roughly 4 characters/token as a rule of thumb, but explicitly says models and tokenization differ. Local live audit measured 4.07 chars/token for 14,000 chars of Gemini 3.8 prose and 2.88 for the JSON tool-result sample; Pi's text-only 4-chars/token estimate undercounted that JSON sample by 28%. A real matching tokenizer would materially improve structured/tool tails, but there is no verified Gemini offline artifact. Antigravity's upstream usage remains authoritative for its route. [10, 20]

### OpenAI GPT-6 and GPT-OSS-120B (Antigravity)

**GPT-6 ids:** official OpenAI's input-token count endpoint is `POST https://api.openai.com/v1/responses/input_tokens`; the guide shows `gpt-6-astra` and says it counts request structure (roles/boundaries), tools, schemas, images and files. It is an online OpenAI API endpoint, not an offline tokenizer and not automatically available to the Antigravity route. [1]

The current official `openai/tiktoken` model registry maps GPT-5 and other listed models, but has no `gpt-6-` prefix or supplied GPT-6 ids. Thus no verified offline mapping for `gpt-6-luna`, `gpt-6-astra` or `gpt-6.1-sol` was found. `o200k_base` is a plausible fallback only if labelled an estimate; its use for those ids is not vendor-documented. The OpenAI rank data URL is `https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken`, **3,613,922 bytes**; OpenAI's official tiktoken source defines the encoding. The standalone data blob carries no separately stated license metadata in the source reviewed; the tiktoken repository is MIT, so the blob's distribution terms should be confirmed before bundling. [2, 3]

**GPT-OSS-120B:** OpenAI's official tiktoken registry maps `gpt-oss-*` to `o200k_harmony`. The encoding function reuses `o200k_base` merge ranks and adds Harmony special-token IDs; it is not a separate `o200k_harmony.tiktoken` file (the guessed URL returns 404). The exact open-model artifact is `https://huggingface.co/openai/gpt-oss-120b/resolve/main/tokenizer.json`, **27.9 MB**, under the model repo's Apache-2.0 license. The repo also contains a 16,738-byte `chat_template.jinja`; it is the matching model template, not a generic “four tokens per message” rule. [2, 4]

**JS/runtime:** `gpt-tokenizer@4.1.0` (MIT; pure JS/TS) documents all OpenAI encodings, including `o200k_harmony`, and an `encodeChat`/chat-completion helper. It was published 2026-10-18 and has 28,061,306 bytes unpacked. However, the published `cjs/bpeRanks/o200k_base.js` rank module is 2,431,443 bytes of generated JavaScript; that is incompatible with the 256 KB module-bytecode ceiling if imported unchanged. A separate `tokenizer.json` plus `@huggingface/tokenizers` keeps vocab data out of JS bytecode, but the model-specific chat template still needs to be rendered correctly. [5, 7]

**Accuracy:** the live audit's OpenAI GPT-6 Luna sample was 4.19 chars/token for prose and 3.51 for JSON; Pi was 24.7% low on that JSON tail, a moderate improvement opportunity. GPT-OSS had 2.5–3.0 chars/token on the JSON sample; Pi was 26–38% low, so exact model tokenization can materially improve content counts. These measurements are route/token counts, not a published tokenizer-versus-billing benchmark. Antigravity's request format and reported usage must not be assumed identical to OpenAI's Responses API. [1, 20]

### xAI Grok 4.7

**Offline source:** no vendor-endorsed public tokenizer asset or documented preflight token-count endpoint was found in the current xAI model/docs index. The current model docs list Grok 4.7 and token-based pricing; generation docs show the Responses API route. The safe truth source is returned request usage after generation, not a guessed `o200k_base` mapping. This is a negative finding limited to public docs checked. [12, 13]

**Template/accuracy:** no fixed per-message/tool token overhead or offline template was found. The live audit measured 4.17 chars/token for prose and 3.31 for the JSON tool-result sample; Pi was 28.9% low on that tail. The prose count is close to Pi's rough ratio, while the sampled JSON has moderate room for improvement. No exact tokenizer exists in the sources reviewed to realize that improvement. [12, 20]

### DeepSeek direct API and Synthetic HF `DeepSeek-V4.1-Flash(-1017)`

**DeepSeek API:** DeepSeek's official token-usage page links an offline artifact, `https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip`. The ZIP is **1,911,504 bytes** compressed (last modified 2026-08-28) and contains `tokenizer.json` (**6,367,096 bytes**), `tokenizer_config.json` (3,128 bytes), and a 277-byte Python wrapper. The docs call it a DeepSeek V4 tokenizer, explain that tokenization differs by model, and say actual returned usage is the source of truth. The archive contains no LICENSE file and the page does not specify a license. It is vendor-endorsed for offline counting, but redistribution rights and exact fit to the API alias `deepseek-flash` remain UNVERIFIED. The current docs give only rough English/Chinese character ratios and say results vary. [14]

The direct API route's `deepseek-flash` id was not established by first-party material as the precise model/revision behind the V4 zip. Do not silently declare a match. If using the vendor zip at runtime, the JSON artifact is compatible in shape with Hugging Face Tokenizers.js; the 277-byte Python wrapper is not suitable as TypeScript runtime code. The included `tokenizer_config.json` provides a chat template, but no published per-message overhead constant. [14]

**Synthetic HF V4.1-Flash-1017:** the official model repo is `deepseek-ai/DeepSeek-V4.1-Flash-1017`, model version named explicitly by its model card. Its file is `https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/resolve/main/tokenizer.json`, **6.37 MB**, repo-licensed MIT. The model card says there is no Jinja chat template; it publishes `encoding/encoding.py` as a reference for multi-turn, tools, thinking, reasoning effort, system messages and image content, and recommends the Rust `deepseek-recipe` stack for production. [15]

The tokenizer JSON inside DeepSeek's V4 API zip and the HF V4.1-Flash-1017 tokenizer JSON have the same displayed size but different SHA-256 hashes, so they must not be treated as identical byte-for-byte or automatically interchangeable. The HF model's MIT repo license does not establish license terms for the separate vendor ZIP. [14, 15]

**Synthetic count accuracy:** the local audit records 9.89 chars/token for the 14K prose delta and 7.64 for JSON, with around 10.3 chars/token across a 71.7 KB request. The audit itself says these counts may not be token counts or may omit parts of the prompt. It also root-caused a separate cache-accounting double count in the Synthetic stream. The HF tokenizer is the right artifact to measure the open model's tokenization; it cannot validate Synthetic billing until compared against a real request with the exact Synthetic prompt serialization/count endpoint. [15, 20]

### Synthetic HF Kimi / GLM / Qwen

**Kimi-K3:** the official `moonshotai/Kimi-K3` model card reports a 160K vocabulary, a custom `kimi-k3` license and `trust_remote_code=True` for Transformers. The root listing contains `encoding_k3.py` (26.3 KB) but no standard `tokenizer.json`; that code composes K3's XTML chat segments and special markers, not the full model vocabulary/rank table. It is not enough to implement a model-matched offline tokenizer. Use returned usage or an endpoint only if Synthetic/vendor exposes and documents one; no such endpoint was verified here. The 2026 model card confirms the model identity, but exact standalone tokenizer artifact/license/size remain UNVERIFIED. [16]

**GLM-5.3:** `zai-org/GLM-5.3` exposes `tokenizer.json` (**20.2 MB**), and its repo metadata labels the license `other:glm-5.3` (model-specific terms). Use `@huggingface/tokenizers` with this exact file and the repo's `tokenizer_config.json`; do not use an unrelated GLM version's file. [17]

**GLM-5.3-Flash:** `zai-org/GLM-5.3-Flash` exposes a same-size (**20.2 MB**) `tokenizer.json`, but has a separate MIT license and a separately trained base model per its card. Use its exact repo artifact rather than infer byte identity from the file size. [18]

**Qwen3.8-27B:** `Qwen/Qwen3.8-27B` exposes `tokenizer.json` (**12.8 MB**) under Apache-2.0 repository licensing. This is a model-matched candidate for that Synthetic HF ID. It does not establish tokenization for other Qwen versions such as Qwen3.8 Max or unlisted Synthetic aliases. [19]

These Hugging Face tokenizers provide exact vocabulary counts for plain serialized text under the relevant model artifact. Request count still depends on rendering the model's `chat_template.jinja`/config and on Synthetic's wrapper. No vendor-published comparison of their local counts against Synthetic billed usage was found. The HF JS library covers tokenizer JSON components; it does not render Jinja chat templates. [7, 16–19]

### OpenCode Zen free routes

OpenCode Zen is a route catalog, not one tokenizer family. Its current public `/zen/v1/models` listing (accessed 2026-10-27) includes `deepseek-v4.1-flash-free`, `big-pickle`, `mimo-v2.6-flash-free`, `nemotron-3.5-super-vl-free`, and `nemotron-3.5-lightning-free`; the response identifies models as owned by OpenCode but does not disclose tokenizer repository ids or prompt templates. The `longcat-2.5-preview-free` id in the local project reference was not present in this live listing. [20, 21]

- `deepseek-v4.1-flash-free`: DeepSeek V4.1 HF tokenizer is a reasonable candidate by name, but Zen does not document that the free alias is the same exact revision or prompt wrapper; confirm mapping before claiming exactness.
- `big-pickle`: no public upstream tokenizer/model identity was found. No offline artifact can be recommended.
- `mimo-v2.6-flash-free`, both Nemotron free ids, and the previously referenced LongCat route: no official Zen-to-HF tokenizer mapping was found. Do not select another model's similarly named tokenizer by guesswork.

Use OpenCode response usage as the post-request count when present. The audit measured `opencode/deepseek-v4.1-flash-free` at 4.15 chars/token on its JSON tool-result sample; Pi's 4-chars/token estimate was only 4% high on that tail. It is not a reason to ship a mismatched vocabulary. No common Zen per-message/tool overhead constant was found. [20]

## JavaScript/TypeScript implementation choices

| Library | Current version / release | Data and license | Runtime and fit |
|---|---|---|---|
| `@huggingface/tokenizers` | `0.2.0`, 2026-09-07 | Apache-2.0; 360,962 bytes unpacked; `dist/tokenizers.mjs` 98,937 bytes; README says ~8.3 KB gzip | Pure JS/TS, zero dependencies; README documents Node and browsers, reads `tokenizer.json` + `tokenizer_config.json`, supports BPE and Unigram. Best fit for external file assets and 256 KB AOT budget. Bun is not named as a supported runtime; Pi-Bolt AOT is unverified. No chat-template renderer. [7] |
| `gpt-tokenizer` | `4.1.0`, 2026-10-18 | MIT; 28,061,306 bytes unpacked; `o200k_base` generated JS rank module 2,431,443 bytes | Pure JS/TS, no native addon, recent release; supports `o200k_base`, `o200k_harmony`, GPT-OSS and chat helpers. Its README benchmarks Node and browser support; Bun is not explicitly certified. AOT bytecode size is the blocker; needs data/code separation before this package can fit. [5] |
| `js-tiktoken` | `1.0.21`, 2025-08-09 | MIT; 22,432,828 bytes unpacked; `o200k_base` ranks JS module 2,325,563 bytes | JavaScript ESM/CJS package with no native addon, but latest publish is over a year old; its published rank modules are large JS source and there is no published `o200k_harmony` module. Bun is not explicitly certified. Does not fit the bytecode limit unchanged. [6] |
| `sentencepiece-js` | `1.1.0`, 2023-01-10 | Apache-2.0; 777,691 bytes unpacked | README says SentencePiece is compiled to WebAssembly and loads `.model`; Node use shown. Much older maintenance signal, Bun not documented. Redundant for HF models with `tokenizer.json` that Tokenizers.js supports as Unigram. [7, 22] |
| `@huggingface/transformers` | `4.3.2`, 2026-10-27 | Apache-2.0; 9,990,867 bytes unpacked | Tokenizer-only APIs are possible, but package dependencies include `onnxruntime-node` as well as `onnxruntime-web`; its full install graph is unsuitable under the no-native-addon rule. Prefer the standalone Tokenizers.js package. [8] |

Package sizes above are npm registry unpacked sizes, except individual JS files and gzip size explicitly noted. They are not final Pi-Bolt bundle measurements. Only a `just aot-verify`/Pi-Bolt build can establish compiled bytecode and embedded-asset behavior; this research run did not install or execute packages. [5–8]

## Accuracy, billing and chat-template overhead

The local live audit reports these measured ratios. Lower chars/token means more tokens per character and makes a fixed 4-chars/token estimator short. Ratios are route samples, not universal model constants. [20]

| Measured route | Prose chars/token | JSON tool-result chars/token | Pi tail-estimate error in audit | Likely impact of correct offline tokenization |
|---|---:|---:|---:|---|
| Claude direct | 2.73 | 2.70 | -41.8% | Material for text tails; no public offline vocab. Count endpoint estimate is the only documented preflight path, subject to auth/route support. |
| Antigravity Claude | — | 2.08 | -55.4% | Material; no verified offline tokenizer or count endpoint for this Antigravity route. |
| Gemini 3.8 Flash | 4.07 | 2.88 | -38.1% | Prose is close to Pi's rough ratio; JSON/tool tails would improve materially if exact tokenizer/serialization were available. |
| Antigravity GPT-OSS-120B | — | 2.5–3.0 | -48.7% | Material for structured content; model tokenizer exists, but Antigravity wrapper equivalence is unverified. |
| GPT-6 Luna | 4.19 | 3.51 | -24.7% | Moderate for JSON tail; no verified offline model mapping. |
| Grok 4.7 | 4.17 | 3.31 | -28.9% | Moderate for JSON tail; no public local tokenizer located. |
| OpenCode DeepSeek V4.1 Flash Free | — | 4.15 | -28.0% | Ratio is near 4; a correct tokenizer may help the measured tail but expected gain is lower than Claude/GPT-OSS. Exact Zen alias/model match unverified. |
| Synthetic HF DeepSeek V4.1 Flash-1017 | 9.89 | 7.64 | n/a | A model tokenizer could materially change the raw estimate, but the audit flags the provider counts as suspect; not a billed-count accuracy claim. |

Provider usage remains the best count when it is correctly mapped. The audit found complete, correct usage on seven of eight routes and traced the Synthetic route's duplicated cache-write field; it also says the Synthetic 10.3-char/token whole-request ratio may mean the reported values are not ordinary token counts or omit request content. These observations favor using a tokenizer for Pi's unanchored tail, not replacing provider usage or treating a tokenizer as the billed source. [20]

There is no cross-provider constant for chat overhead. OpenAI's Responses count endpoint explicitly includes role/boundary formatting and tools/schemas; Anthropic accepts messages/system/tools and returns its server estimate; Google count requests include the same contents/tools and usage exposes tool-use counts. The gpt-oss and HF model files carry model-specific templates, which must be rendered before local tokenization. Counts from text alone omit wrappers, message endings, tool schema serialization, multimodal payload expansion and provider-added instructions. [1, 8, 11, 4, 15–19]

The DeepSeek official docs say to trust returned usage as source of truth and characterize their character ratios as approximate; the offline archive is a useful independent counter, not proof of bill equivalence. Anthropic explicitly says its count endpoint may differ slightly from actual input and excludes non-billable auto-added system tokens from billing. No vendor-published tokenizer-versus-billed benchmark or issue comparison was located for Antigravity, Synthetic or Zen. [11, 14, 20]

## Recommendation

1. Implement the offline interface around one JSON-asset-driven tokenizer runtime: evaluate `@huggingface/tokenizers@0.2.0` with `tokenizer.json`/`tokenizer_config.json` imported as embedded files and loaded lazily. Its runtime code is small and pure JS; verify Node, Bun and Pi-Bolt AOT against a pinned model fixture before committing artifacts.
2. Start with exact HF open-model pairs where the id is a known repo: GPT-OSS-120B, DeepSeek-V4.1-Flash-1017, GLM-5.3, GLM-5.3-Flash and Qwen3.8-27B. Pin repo revision/hash and include each model's license; store tokenizer data separately from executable bytecode. Add model-specific template rendering only when documented and tested.
3. Do not ship a guessed GPT-6 `o200k_base` mapping, Gemini tokenizer inferred from Gemma, or an alias-matched Zen vocabulary. Label generic encodings as estimates until a vendor mapping is found.
4. For Anthropic, use the count endpoint only where the actual route/auth supports it; otherwise no offline source exists. For Gemini, xAI and direct DeepSeek, retain provider usage and use documented count endpoints/archives only as their supported scope allows. Resolve the DeepSeek ZIP's license before embedding it.
5. Compare local counts against captured request bodies and response usage by exact model/route, especially Synthetic DeepSeek where the audit found anomalous counts. Record exact template, cache and modality conditions; do not compare only text length.

## Risks, caveats and open questions

- **UNVERIFIED:** whether `claude` subscription OAuth credentials can call Anthropic's public `messages/count_tokens` endpoint; docs examples use API-key auth.
- **UNVERIFIED:** whether Google Gemma 4 tokenizer vocabulary is shared with any Gemini 3.8 or Gemini 4 model. No official claim was found.
- **UNVERIFIED:** which encoding OpenAI GPT-6 ids use. Official tiktoken's current map has no GPT-6 entry; online OpenAI count is documented.
- **UNVERIFIED:** whether Antigravity GPT-OSS and Claude usage counts correspond to the upstream model's local tokenizer after Google/Antigravity wrappers.
- **UNVERIFIED:** license/redistribution terms for `deepseek_v4_tokenizer.zip`; its ZIP has no LICENSE file. Also unverified: its exact model-version mapping to the direct API id `deepseek-flash`.
- **UNVERIFIED:** Synthetic's V4.1-Flash-1017 token counts, serialization and usage semantics; the vendor's HF artifact is MIT, but the live route has anomalous reported ratios/cache accounting.
- **UNVERIFIED:** Kimi-K3's full tokenizer/vocabulary artifact and exact license scope for any tokenizer data; the repo has custom-license encoding code but no root `tokenizer.json`.
- **UNVERIFIED:** underlying upstream model/revision and prompt template for OpenCode Zen's Big Pickle, MiMo, Nemotron and LongCat routes. Big Pickle has no public upstream mapping found; the current Zen listing omits the previously referenced LongCat free id.
- **UNVERIFIED:** `@huggingface/tokenizers` under Bun and Pi-Bolt AOT, or whether any tokenizer JSON parses identically to provider-specific billed inputs. No packages were installed, benchmarked or run in this research-only task.

## Sources

All live pages below were accessed 2026-10-27. Unless noted, page/repository publication dates are not exposed by the source.

[1] OpenAI, “Counting tokens” — https://platform.openai.com/docs/guides/token-counting (current docs include `gpt-6-astra`; accessed 2026-10-27).

[2] OpenAI tiktoken, official encoding and model maps — https://github.com/openai/tiktoken/blob/main/tiktoken_ext/openai_public.py and https://github.com/openai/tiktoken/blob/main/tiktoken/model.py (accessed 2026-10-27; current `main`).

[3] OpenAI `o200k_base.tiktoken` rank asset — https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken (3,613,922 bytes; server Last-Modified 2024-05-13; HEAD checked 2026-10-27); tiktoken source license — https://github.com/openai/tiktoken/blob/main/LICENSE (MIT; accessed 2026-10-27).

[4] OpenAI, `gpt-oss-120b` model card and file listing — https://huggingface.co/openai/gpt-oss-120b; tokenizer file https://huggingface.co/openai/gpt-oss-120b/blob/main/tokenizer.json; current chat template https://huggingface.co/openai/gpt-oss-120b/blob/main/chat_template.jinja (repo card lists Apache-2.0; accessed 2026-10-27).

[5] `gpt-tokenizer` README/source — https://github.com/niieani/gpt-tokenizer (accessed 2026-10-27); npm metadata https://registry.npmjs.org/gpt-tokenizer/4.1.0 (MIT, 28,061,306 unpacked, published 2026-10-18); package file sizes https://data.jsdelivr.com/v1/package/npm/gpt-tokenizer@4.1.0/flat.

[6] `js-tiktoken` npm metadata — https://registry.npmjs.org/js-tiktoken/1.0.21 (MIT, 22,432,828 unpacked, published 2025-08-09); package files https://unpkg.com/js-tiktoken@1.0.21/?meta.

[7] Hugging Face Tokenizers.js README — https://unpkg.com/@huggingface/tokenizers@0.2.0/README.md (pure JS/TS, Node/browser, 8.3 KB gzip, tokenizer JSON/config API; accessed 2026-10-27); npm metadata https://registry.npmjs.org/@huggingface%2Ftokenizers/0.2.0 (Apache-2.0, 360,962 unpacked; published 2026-09-07); file sizes https://unpkg.com/@huggingface/tokenizers@0.2.0/?meta.

[8] Hugging Face Transformers.js npm metadata — https://registry.npmjs.org/@huggingface%2Ftransformers/4.3.2 (Apache-2.0, 9,990,867 unpacked; dependencies include `onnxruntime-node`; published 2026-10-27); accessed 2026-10-27.

[9] Google Gen AI SDK changelog — https://github.com/googleapis/js-genai/blob/main/CHANGELOG.md (2.31.0 dated 2026-10-22; 2.30.0 adds Gemini 4 Argon dated 2026-10-14; 2.21.0 adds Gemini 3.8 dated 2026-09-02).

[10] Google AI for Developers, “Tokens” — https://ai.google.dev/gemini-api/docs/tokens; Gemma formatting/token controls — https://ai.google.dev/gemma/docs/formatting; Gemma 4 HF model — https://huggingface.co/google/gemma-4-31B-it; tokenizer file https://huggingface.co/google/gemma-4-31B-it/blob/main/tokenizer.json (32.2 MB; Apache-2.0 repo metadata; accessed 2026-10-27).

[11] Anthropic, “Token counting” — https://docs.anthropic.com/en/docs/build-with-claude/token-counting (current active models; 4.7+ tokenizer note; accessed 2026-10-27).

[12] xAI, models and pricing — https://docs.x.ai/developers/models (Grok 4.7 token pricing/model availability; accessed 2026-10-27).

[13] xAI, “Generate Text” — https://docs.x.ai/developers/model-capabilities/text/generate-text; official developer docs index — https://docs.x.ai/llms.txt (Responses API and public API/doc surface; accessed 2026-10-27).

[14] DeepSeek, “Token & Token Usage” — https://api-docs.deepseek.com/quick_start/token_usage; vendor ZIP https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip (ZIP 1,911,504 bytes, last modified 2026-08-28; archive listing/inner sizes checked 2026-10-27).

[15] DeepSeek, `DeepSeek-V4.1-Flash-1017` model card — https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/blob/main/README.md (MIT; 2026 model card; accessed 2026-10-27); tokenizer file https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/blob/main/tokenizer.json (6.37 MB); prompt encoding source https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/tree/main/encoding.

[16] Moonshot AI, `Kimi-K3` — https://huggingface.co/moonshotai/Kimi-K3 (160K vocab, custom `kimi-k3` license; accessed 2026-10-27); official `encoding_k3.py` https://huggingface.co/moonshotai/Kimi-K3/blob/main/encoding_k3.py (26.3 KB); root file listing https://huggingface.co/moonshotai/Kimi-K3/tree/main.

[17] Z.ai, `GLM-5.3` — https://huggingface.co/zai-org/GLM-5.3/raw/main/README.md (license metadata `other: glm-5.3`; accessed 2026-10-27); tokenizer https://huggingface.co/zai-org/GLM-5.3/blob/main/tokenizer.json (20.2 MB).

[18] Z.ai, `GLM-5.3-Flash` — https://huggingface.co/zai-org/GLM-5.3-Flash/raw/main/README.md (MIT; accessed 2026-10-27); tokenizer https://huggingface.co/zai-org/GLM-5.3-Flash/blob/main/tokenizer.json (20.2 MB).

[19] Qwen, `Qwen3.8-27B` — https://huggingface.co/Qwen/Qwen3.8-27B (Apache-2.0; accessed 2026-10-27); tokenizer https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/tokenizer.json (12.8 MB).

[20] Local usage audit — `.project/analyses/tokens/usage-audit/report.md` (published 2026-10-27; raw provider frames, ratios, cached usage and tool-tail errors).

[21] Local current model reference — `.project/references/models.md` (revision 3, updated 2026-10-27; model ids were capability-checked against models.dev and Synthetic listing on 2026-10-19); OpenCode Zen current model list — https://opencode.ai/zen/v1/models (accessed 2026-10-27).

[22] `sentencepiece-js` README — https://unpkg.com/sentencepiece-js@1.1.0/README.md (Emscripten/WebAssembly SentencePiece wrapper; README includes Node usage; accessed 2026-10-27); npm metadata https://registry.npmjs.org/sentencepiece-js/1.1.0 (Apache-2.0, 777,691 unpacked, published 2023-01-10).
