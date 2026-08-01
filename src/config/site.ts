export const site = {
  name: '未命名的笔记',
  nameEn: 'Untitled Notes',
  description: '记录技术、思考与正在做的项目。',
  descriptionEn: 'Notes on technology, ideas, and projects in progress.',
  url: 'https://example.com',
  author: '你的名字',
  bio: '一位持续学习、写作与构建的创作者。',
  bioEn: 'A maker who keeps learning, writing, and building.',
  email: 'hello@example.com',
  social: {
    github: 'https://github.com/your-handle',
    x: 'https://x.com/your-handle',
  },
  categories: ['技术', '随笔', '项目'],
} as const;

export type UiLanguage = 'zh' | 'en';

export const ui = {
  zh: {
    home: '首页', articles: '文章', about: '关于我', search: '搜索',
    latest: '最新文章', featured: '置顶文章', categories: '分类',
    allArticles: '全部文章', readMore: '阅读全文', minutes: '分钟阅读',
    noArticles: '暂无文章。', tableOfContents: '目录', related: '相关文章',
    previous: '上一篇', next: '下一篇', language: '语言', searchHint: '搜索标题、摘要或标签…',
    searchEmpty: '没有找到相关文章。', backHome: '返回首页', toggleTheme: '切换主题',
  },
  en: {
    home: 'Home', articles: 'Articles', about: 'About', search: 'Search',
    latest: 'Latest', featured: 'Featured', categories: 'Topics',
    allArticles: 'All articles', readMore: 'Read article', minutes: 'min read',
    noArticles: 'No articles yet.', tableOfContents: 'On this page', related: 'Related reading',
    previous: 'Previous', next: 'Next', language: 'Language', searchHint: 'Search titles, summaries, or tags…',
    searchEmpty: 'No matching articles.', backHome: 'Back home', toggleTheme: 'Toggle theme',
  },
} as const;
