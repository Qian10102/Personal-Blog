import rss from '@astrojs/rss';
import { getPublishedPosts } from '../lib/posts';
import { site } from '../config/site';
export async function GET(context) {
  const posts = await getPublishedPosts();
  return rss({ title: site.name, description: site.description, site: context.site, items: posts.map((post) => ({ title: post.data.title, description: post.data.description, pubDate: post.data.pubDate, link: `/posts/${post.id}/` })) });
}
