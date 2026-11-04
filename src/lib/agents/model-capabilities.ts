export function modelSupportsImageInput(modelId: string): boolean {
  const normalized = modelId.trim().toLocaleLowerCase()
  return [
    /vision/,
    /multimodal/,
    /(^|[-_\s])omni([-_\s]|$)/,
    /(^|[-_\s])vl([-_\s]|$)/,
    /^gpt-/,
    /^o[34]([-_\s]|$)/,
    /^claude([-_\s]|$)/,
    /^gemini([-_\s]|$)/,
    /^qwen.*vl/,
    /^glm-.*v/,
    /^llava/,
  ].some((pattern) => pattern.test(normalized))
}
