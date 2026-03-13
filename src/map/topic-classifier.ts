// Two-pass topic classification ported from Neurobuttr web app.
// Pass 1: Extract keywords per text block, matching against curated dictionaries.
// Pass 2: Normalize across all nodes for cross-graph consistency.

const STOP_WORDS = new Set([
  "the", "is", "a", "an", "in", "on", "for", "to", "of", "and", "or", "it",
  "this", "that", "with", "be", "was", "are", "were", "been", "have", "has",
  "had", "do", "does", "did", "but", "not", "you", "your", "we", "our",
  "they", "their", "he", "she", "its", "if", "can", "will", "would", "should",
  "could", "about", "from", "what", "when", "where", "how", "which", "who",
  "all", "each", "every", "some", "any", "no", "more", "most", "also", "just",
  "than", "then", "so", "very", "too", "here", "there", "now", "up", "out",
  "only", "into", "over", "such", "as", "at", "by", "my", "me", "like",
  "use", "using", "used", "make", "get", "know", "want", "need", "tell",
  "say", "said", "think", "see", "look", "find", "give", "take", "come",
  "go", "way", "well", "back", "even", "new", "because", "good", "great",
  "help", "try", "ask", "work", "call", "first", "after", "two", "may",
  "down", "been", "many", "them", "these", "other", "please", "explain",
  "something", "thing", "things", "really", "still", "let", "being", "much",
  "own", "those", "right", "between", "through", "same", "different", "while",
  "write", "create", "show", "code", "example", "function", "would", "could",
  "implement", "following", "given", "question", "answer", "understand",
]);

const MULTI_WORD_TERMS: Record<string, string> = {
  "machine learning": "ML/AI",
  "deep learning": "ML/AI",
  "neural network": "ML/AI",
  "neural networks": "ML/AI",
  "natural language": "NLP",
  "natural language processing": "NLP",
  "computer vision": "Computer Vision",
  "data structure": "Data Structures",
  "data structures": "Data Structures",
  "linked list": "Data Structures",
  "binary tree": "Data Structures",
  "hash map": "Data Structures",
  "design pattern": "Architecture",
  "design patterns": "Architecture",
  "dependency injection": "Architecture",
  "version control": "Git",
  "pull request": "Git",
  "merge conflict": "Git",
  "type hint": "TypeScript",
  "type annotation": "TypeScript",
  "error handling": "Error Handling",
  "exception handling": "Error Handling",
  "unit test": "Testing",
  "unit testing": "Testing",
  "web scraping": "Web Scraping",
  "web development": "Web Dev",
  "regular expression": "Regex",
  "regular expressions": "Regex",
  "command line": "CLI",
  "file system": "System",
  "object oriented": "OOP",
  "functional programming": "Functional",
  "event loop": "Async",
  "async await": "Async",
  "rest api": "APIs",
  "web socket": "APIs",
  "state management": "State",
  "data analysis": "Data Science",
  "data science": "Data Science",
  "data visualization": "Data Science",
  "best practice": "Best Practices",
  "best practices": "Best Practices",
  "real time": "Real-Time",
  "real-time": "Real-Time",
  "user interface": "UI/UX",
  "user experience": "UI/UX",
};

const SINGLE_WORD_TERMS: Record<string, string> = {
  python: "Python", javascript: "JavaScript", typescript: "TypeScript",
  rust: "Rust", go: "Go", golang: "Go", java: "Java", kotlin: "Kotlin",
  swift: "Swift", ruby: "Ruby", php: "PHP", cpp: "C++", bash: "Shell",
  shell: "Shell", sql: "SQL", postgres: "SQL", mysql: "SQL", html: "HTML/CSS",
  css: "HTML/CSS",
  react: "React", nextjs: "React", vue: "Vue", angular: "Angular",
  svelte: "Svelte", django: "Django", flask: "Flask", fastapi: "FastAPI",
  express: "Express", nodejs: "Node.js", node: "Node.js",
  tailwind: "Styling", pandas: "Data Science", numpy: "Data Science",
  pytorch: "ML/AI", tensorflow: "ML/AI",
  mongodb: "Databases", database: "Databases", redis: "Databases",
  prisma: "Databases", orm: "Databases",
  api: "APIs", rest: "APIs", graphql: "APIs", grpc: "APIs",
  endpoint: "APIs", http: "APIs", webhook: "APIs",
  docker: "DevOps", kubernetes: "DevOps", k8s: "DevOps",
  terraform: "DevOps", aws: "Cloud", azure: "Cloud", gcp: "Cloud",
  testing: "Testing", test: "Testing", jest: "Testing", pytest: "Testing",
  git: "Git", github: "Git",
  algorithm: "Algorithms", sorting: "Algorithms", recursion: "Algorithms",
  regex: "Regex", async: "Async", promise: "Async", concurrent: "Async",
  authentication: "Auth/Security", auth: "Auth/Security", oauth: "Auth/Security",
  jwt: "Auth/Security", security: "Auth/Security", encryption: "Auth/Security",
  debugging: "Debugging", debug: "Debugging", bug: "Debugging",
  error: "Error Handling", exception: "Error Handling",
  performance: "Performance", optimization: "Performance", cache: "Performance",
  refactor: "Refactoring", refactoring: "Refactoring",
  architecture: "Architecture", microservice: "Architecture",
  deployment: "DevOps", deploy: "DevOps",
  llm: "ML/AI", gpt: "ML/AI", transformer: "ML/AI", embedding: "ML/AI",
  prompt: "ML/AI", model: "ML/AI",
  payment: "Finance", stripe: "Finance", billing: "Finance",
  email: "Email", notification: "Notifications",
  ui: "UI/UX", ux: "UI/UX", design: "UI/UX", component: "UI/UX",
  setup: "Setup", install: "Setup", config: "Configuration",
  migration: "Migration",
};

const MULTI_WORD_SORTED = Object.keys(MULTI_WORD_TERMS).sort(
  (a, b) => b.length - a.length
);

function extractFromText(text: string): { term: string; score: number }[] {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const matched: { term: string; score: number }[] = [];
  let remaining = cleaned;

  for (const phrase of MULTI_WORD_SORTED) {
    if (remaining.includes(phrase)) {
      const canonical = MULTI_WORD_TERMS[phrase];
      const existing = matched.find((m) => m.term === canonical);
      if (existing) {
        existing.score += 3;
      } else {
        matched.push({ term: canonical, score: 3 });
      }
      remaining = remaining.replaceAll(phrase, " ");
    }
  }

  const words = remaining
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  for (const word of words) {
    const canonical = SINGLE_WORD_TERMS[word];
    if (canonical) {
      const existing = matched.find((m) => m.term === canonical);
      if (existing) {
        existing.score += 2;
      } else {
        matched.push({ term: canonical, score: 2 });
      }
    }
  }

  if (matched.length === 0) {
    const freq: Record<string, number> = {};
    for (const w of words) {
      if (w.length > 2) {
        freq[w] = (freq[w] || 0) + 1;
      }
    }
    const topWord = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    if (topWord) {
      matched.push({
        term: topWord[0].charAt(0).toUpperCase() + topWord[0].slice(1),
        score: topWord[1],
      });
    }
  }

  return matched;
}

export function extractNormalizedKeywords(text: string): string[] {
  return extractFromText(text)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((m) => m.term);
}

export function extractWeightedKeywords(
  sources: { text: string; weight: number }[]
): string[] {
  const merged: Record<string, number> = {};

  for (const { text, weight } of sources) {
    if (!text.trim()) continue;
    const matches = extractFromText(text);
    for (const { term, score } of matches) {
      merged[term] = (merged[term] || 0) + score * weight;
    }
  }

  return Object.entries(merged)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([term]) => term);
}

// Simple single-text classification — returns the top topic
export function classifyTopic(text: string, anchorContext?: string): string {
  if (anchorContext) {
    const keywords = extractWeightedKeywords([
      { text, weight: 3 },
      { text: anchorContext, weight: 1 },
    ]);
    return keywords[0] || "General";
  }
  const keywords = extractNormalizedKeywords(text);
  return keywords[0] || "General";
}

// Pass 2: Normalize topics across all nodes

interface NodeKeywords {
  nodeId: string;
  keywords: string[];
}

function stem(word: string): string {
  return word
    .replace(/ies$/, "y")
    .replace(/tion$/, "t")
    .replace(/ing$/, "")
    .replace(/ed$/, "")
    .replace(/s$/, "");
}

export function normalizeTopicsAcrossNodes(
  nodeKeywords: NodeKeywords[]
): Record<string, string> {
  const globalFreq: Record<string, number> = {};
  for (const { keywords } of nodeKeywords) {
    for (const kw of keywords) {
      globalFreq[kw] = (globalFreq[kw] || 0) + 1;
    }
  }

  const stemMap: Record<string, string[]> = {};
  for (const kw of Object.keys(globalFreq)) {
    const isDictMatch =
      kw.charAt(0) === kw.charAt(0).toUpperCase() ||
      kw.includes("/") ||
      kw.includes(".");
    if (isDictMatch) continue;

    const s = stem(kw.toLowerCase());
    if (!stemMap[s]) stemMap[s] = [];
    stemMap[s].push(kw);
  }

  const mergeMap: Record<string, string> = {};
  for (const variants of Object.values(stemMap)) {
    if (variants.length <= 1) continue;
    variants.sort((a, b) => (globalFreq[b] || 0) - (globalFreq[a] || 0));
    const canonical = variants[0];
    for (let i = 1; i < variants.length; i++) {
      mergeMap[variants[i]] = canonical;
    }
  }

  const assignments: Record<string, string> = {};
  for (const { nodeId, keywords } of nodeKeywords) {
    if (keywords.length === 0) {
      assignments[nodeId] = "General";
      continue;
    }
    const resolved = keywords.map((kw) => mergeMap[kw] || kw);
    assignments[nodeId] = resolved[0];
  }

  return assignments;
}
