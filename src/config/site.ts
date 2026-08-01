export const site = {
  name: 'Zihan QIAN',
  nameEn: 'Zihan QIAN',
  description: '记录工程学习、交通物流与项目思考。',
  descriptionEn: 'Notes on engineering, transport, logistics and projects.',
  descriptionFr: "Notes sur l'ingénierie, le transport, la logistique et les projets.",
  url: 'https://example.com',
  author: 'Zihan QIAN',
  bio: '北京航空航天大学交通运输与物流专业学生，关注工程实践、交通与物流。',
  bioEn: 'Transport and Logistics student at Beihang University, interested in engineering practice, transport and logistics.',
  bioFr: "Étudiant en transport et logistique à l'Université Beihang, intéressé par la pratique de l'ingénierie, le transport et la logistique.",
  email: 'zihan.qian.insa@gmail.com',
  social: {
    github: 'https://github.com/your-handle',
    x: 'https://x.com/your-handle',
  },
  categories: ['技术', '随笔', '项目'],
} as const;

export type UiLanguage = 'zh' | 'en' | 'fr';

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
  fr: {
    home: 'Accueil', articles: 'Articles', about: 'À propos', search: 'Recherche',
    latest: 'Derniers articles', featured: 'À la une', categories: 'Thèmes',
    allArticles: 'Tous les articles', readMore: "Lire l'article", minutes: 'min de lecture',
    noArticles: 'Aucun article pour le moment.', tableOfContents: 'Sur cette page', related: 'À lire aussi',
    previous: 'Précédent', next: 'Suivant', language: 'Langue', searchHint: 'Rechercher un titre, un résumé ou un tag…',
    searchEmpty: 'Aucun article correspondant.', backHome: "Retour à l'accueil", toggleTheme: 'Changer le thème',
  },
} as const;
