import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import nunjucks from 'nunjucks';
import { marked } from 'marked';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const CONTENT = path.join(ROOT, 'content');

// CORE_SCHEMA keeps dates like 2026-10-14 as plain strings
const YAML_OPTS = { schema: yaml.CORE_SCHEMA };

marked.use({ breaks: true });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 2026-06-04 → 04 Jun 2026
function displayDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

// ── Reading & writing content files ───────────────────

export function parseFrontMatter(src) {
    const match = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { data: {}, body: src.trim() };
    return { data: yaml.load(match[1], YAML_OPTS) ?? {}, body: match[2].trim() };
}

export function stringifyFrontMatter(data, body) {
    const front = yaml.dump(data, { ...YAML_OPTS, lineWidth: -1 });
    return `---\n${front}---\n${body.trim()}\n`;
}

function readMarkdownDir(dir) {
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.md'))
        .map(f => {
            const { data, body } = parseFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
            return { slug: f.replace(/\.md$/, ''), ...data, body };
        });
}

const byDateDesc = (a, b) => b.date.localeCompare(a.date);

export function loadContent() {
    const gigs = yaml.load(fs.readFileSync(path.join(CONTENT, 'gigs.yml'), 'utf8'), YAML_OPTS) ?? [];
    return {
        gigs: gigs.sort(byDateDesc),
        releases: readMarkdownDir(path.join(CONTENT, 'releases')).sort(byDateDesc),
        news: readMarkdownDir(path.join(CONTENT, 'news')).sort(byDateDesc),
        about: fs.readFileSync(path.join(CONTENT, 'about.md'), 'utf8').trim(),
    };
}

// ── Rendering ─────────────────────────────────────────

// noCache so a running CMS picks up template edits
const env = nunjucks.configure(path.join(ROOT, 'templates'), { autoescape: true, noCache: true });
env.addFilter('md', str => new nunjucks.runtime.SafeString(marked.parse(str ?? '')));
env.addFilter('displayDate', displayDate);

// First non-empty line as plain text: [text](url) → text, emphasis markers dropped
env.addFilter('excerpt', str => (str ?? '').split('\n').find(line => line.trim())
    ?.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim() ?? '');

export function build() {
    const html = env.render('index.njk', loadContent());
    fs.writeFileSync(path.join(ROOT, 'index.html'), html);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    build();
    console.log('Built index.html');
}
