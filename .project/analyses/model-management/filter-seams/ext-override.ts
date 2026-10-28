export default function (pi) {
  const model = (id) => ({ id, name: id, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 });
  pi.registerProvider("fixture", { baseUrl: "https://fixture.invalid/v1", api: "openai-completions", apiKey: "$PROBE_KEY", models: [model("extension-only")] });
}
