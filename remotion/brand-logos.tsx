import React from 'react';
// Only brands that ACTUALLY exist in @lobehub/icons — a missing named import
// crashes the whole bundle, so this list is verified against the package.
import {
  Anthropic, OpenAI, Google, Gemini, Claude, Vercel, Microsoft, Meta,
  Github, Notion, Figma, Replit, Cursor, Perplexity, Mistral,
  Grok, HuggingFace, Nvidia, Apple, AdobeFirefly, Adobe,
  ElevenLabs, Midjourney, Runway, Suno, Zapier, Cloudflare,
  Ollama, LangChain,
} from '@lobehub/icons';

// ─────────────────────────────────────────────────────────────────────────────
// BRAND LOGO REGISTRY — maps a brand NAME (as the LLM emits it) to a lobehub
// logo component. Every layout that references a brand renders its REAL logo via
// this registry, so the reel always "makes sense" (per the Huashu core-asset
// rule: a brand must be recognizable, and that's the logo). Unknown brands fall
// back to a clean monogram chip so nothing ever breaks.
// ─────────────────────────────────────────────────────────────────────────────

type LogoComp = any;

// Normalize a brand string → registry key. Maps sub-products to parents so the
// logo matches (Claude Code → Anthropic, NotebookLM → Google, Codex → OpenAI).
function normalizeBrand(raw: string): string {
  const s = String(raw || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const map: Record<string, string> = {
    'claude': 'anthropic', 'claude code': 'anthropic', 'sonnet': 'anthropic', 'opus': 'anthropic', 'haiku': 'anthropic', 'anthropic': 'anthropic',
    'chatgpt': 'openai', 'gpt': 'openai', 'gpt4': 'openai', 'gpt4o': 'openai', 'sora': 'openai', 'dalle': 'openai', 'codex': 'openai', 'openai': 'openai',
    'gemini': 'gemini', 'bard': 'google', 'notebooklm': 'google', 'veo': 'google', 'imagen': 'google', 'google': 'google', 'aistudio': 'google',
    'vercel': 'vercel', 'v0': 'vercel', 'netlify': 'netlify',
    'github': 'github', 'copilot': 'github', 'notion': 'notion', 'figma': 'figma', 'slack': 'slack',
    'stripe': 'stripe', 'replit': 'replit', 'cursor': 'cursor', 'perplexity': 'perplexity',
    'mistral': 'mistral', 'grok': 'grok', 'xai': 'grok', 'huggingface': 'huggingface', 'hugging face': 'huggingface',
    'nvidia': 'nvidia', 'apple': 'apple', 'amazon': 'amazon', 'aws': 'amazon',
    'adobe': 'adobe', 'firefly': 'adobefirefly', 'canva': 'canva', 'elevenlabs': 'elevenlabs', 'eleven labs': 'elevenlabs',
    'midjourney': 'midjourney', 'runway': 'runway', 'suno': 'suno', 'zapier': 'zapier',
    'linear': 'linear', 'supabase': 'supabase', 'cloudflare': 'cloudflare', 'spline': 'spline',
    'framer': 'framer', 'webflow': 'webflow', 'ollama': 'ollama', 'langchain': 'langchain', 'pinecone': 'pinecone',
    'microsoft': 'microsoft', 'meta': 'meta', 'llama': 'meta',
  };
  return map[s] || s;
}

const REGISTRY: Record<string, LogoComp> = {
  anthropic: Anthropic, openai: OpenAI, google: Google, gemini: Gemini, claude: Claude,
  vercel: Vercel, microsoft: Microsoft, meta: Meta, github: Github,
  notion: Notion, figma: Figma, replit: Replit,
  cursor: Cursor, perplexity: Perplexity, mistral: Mistral, grok: Grok,
  huggingface: HuggingFace, nvidia: Nvidia, apple: Apple,
  adobe: Adobe, adobefirefly: AdobeFirefly, elevenlabs: ElevenLabs,
  midjourney: Midjourney, runway: Runway, suno: Suno, zapier: Zapier,
  cloudflare: Cloudflare, ollama: Ollama, langchain: LangChain,
};

export function hasBrandLogo(name: string): boolean {
  const key = normalizeBrand(name);
  return Boolean(REGISTRY[key]);
}

// Render a brand's color logo at a given size. Falls back to a monogram chip.
export const BrandLogo: React.FC<{name: string; size?: number; ink?: string; accent?: string; mono?: boolean}> = ({name, size = 48, ink = '#1E1B17', accent = '#C04A1A', mono}) => {
  const key = normalizeBrand(name);
  const Comp = REGISTRY[key];
  if (Comp) {
    const ColorVariant = (Comp as any).Color;
    try {
      if (!mono && ColorVariant) return <ColorVariant size={size} />;
      // Mono marks use fill:currentColor — tint via a wrapping colored span.
      return <span style={{color: ink, display: 'inline-flex', lineHeight: 1}}><Comp size={size} /></span>;
    } catch {
      /* fall through to monogram */
    }
  }
  // Monogram fallback chip.
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        background: accent,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.5,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {initial}
    </div>
  );
};

// A horizontal row of brand logo chips (name + logo) — used as a persistent
// "featuring" strip and inside layouts that reference multiple brands.
export const BrandChips: React.FC<{names: string[]; size?: number; ink?: string; accent?: string; paper?: string}> = ({names, size = 38, ink = '#1E1B17', accent = '#C04A1A', paper = '#F7F4EF'}) => {
  const list = (names || []).filter(Boolean).slice(0, 4);
  if (!list.length) return null;
  return (
    <div style={{display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center'}}>
      {list.map((n, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '8px 16px 8px 10px',
            borderRadius: 100,
            background: paper,
            border: `1px solid ${ink}1A`,
            boxShadow: `0 6px 18px ${ink}14`,
          }}
        >
          <BrandLogo name={n} size={size * 0.7} ink={ink} accent={accent} />
          <span style={{fontFamily: 'system-ui, sans-serif', fontSize: size * 0.42, fontWeight: 600, color: ink}}>{n}</span>
        </div>
      ))}
    </div>
  );
};
