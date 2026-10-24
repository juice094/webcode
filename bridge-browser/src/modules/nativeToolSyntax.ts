export interface NativeToolSyntaxHit {
  family: string;
  marker: string;
}

interface NativeSyntaxPattern {
  family: string;
  pattern: RegExp;
}

// Keep this list to syntaxes we have actually observed escaping the JSON
// contract. Each pattern must require a structural marker, not a bare word, so
// ordinary prose that merely mentions the platform name does not trigger.
const NATIVE_SYNTAX_PATTERNS: readonly NativeSyntaxPattern[] = [
  {
    family: "DeepSeek DSML",
    pattern: /｜{1,2}\s*DSML\s*｜{1,2}/,
  },
  {
    family: "Anthropic antml",
    pattern: /antml:(?:invoke|parameter|function_calls)\b/,
  },
];

/**
 * Detect a known platform-native tool-call syntax inside assistant text.
 *
 * The JSON contract only recognises fenced JSON code blocks. When a model drifts
 * back to its own platform syntax, the scanner never sees a code block, the
 * gateway never receives a request, and the failure is silent. This pure check
 * lets the content script surface that case instead of leaving the user with a
 * stray paragraph of tokens.
 */
export function detectNativeToolSyntax(text: string): NativeToolSyntaxHit | null {
  if (!text) {
    return null;
  }

  for (const candidate of NATIVE_SYNTAX_PATTERNS) {
    const match = candidate.pattern.exec(text);
    if (match) {
      return {
        family: candidate.family,
        marker: match[0].trim(),
      };
    }
  }

  return null;
}
