export interface EmojiIdentifier {
  blocks: string[];
  userId: string;
  deviceName: string;
  createdAt: string;
}

export interface ResearchArticle {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  summary: string;
  keyPoints: string[];
  tags: string[];
  category: 'magnets' | 'hydrogen' | 'p2p' | 'infinity' | 'materials';
  readTime: number;
}

export interface SignalNode {
  id: string;
  emoji: string;
  x: number;
  y: number;
  connected: boolean;
  label: string;
}

export interface TokenGame {
  tokens: number;
  level: number;
  stars: number;
  mushrooms: number;
  stage: 'club' | 'diamond' | 'heart' | 'spade';
  bugs: number;
}

export interface ContactEntry {
  id: string;
  name: string;
  emojiId: EmojiIdentifier;
  online: boolean;
  lastSeen: string;
}

export interface NavLink {
  href: string;
  label: string;
  icon: string;
}
