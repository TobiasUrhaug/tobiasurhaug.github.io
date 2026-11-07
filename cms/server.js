import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as yaml from 'js-yaml';
import sharp from 'sharp';
import { ROOT, CONTENT, build, loadContent, stringifyFrontMatter } from '../build.js';
import { publish, publishStatus } from './publish.js';

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_HTML = path.join(ROOT, 'cms', 'admin.html');
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

let publishing = false;

const GIGS_HEADER = `# One entry per gig. Order doesn't matter — the build sorts by date.
# Fields: date (YYYY-MM-DD), title, venue, location,
#         optional: link, link_label, image, text (Markdown)

`;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
};

// ── Writers ───────────────────────────────────────────

function writeGigs(gigs) {
    const sorted = [...gigs].sort((a, b) => b.date.localeCompare(a.date));
    const body = sorted.map(g => yaml.dump([g], { schema: yaml.CORE_SCHEMA, lineWidth: -1 })).join('\n');
    fs.writeFileSync(path.join(CONTENT, 'gigs.yml'), GIGS_HEADER + body);
}

function writeMarkdown(dir, slug, data, body, previousSlug) {
    fs.writeFileSync(path.join(CONTENT, dir, `${slug}.md`), stringifyFrontMatter(data, body));
    if (previousSlug && previousSlug !== slug) removeMarkdown(dir, previousSlug);
}

function removeMarkdown(dir, slug) {
    fs.rmSync(path.join(CONTENT, dir, `${slug}.md`), { force: true });
}

async function saveImage(name, dataUrl) {
    if (!SLUG.test(name.toLowerCase().replace(/_/g, '-'))) throw new Error(`Bad image name: ${name}`);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const file = `images/${name}.jpg`;
    await sharp(Buffer.from(base64, 'base64'))
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(path.join(ROOT, file));
    return file;
}

// ── HTTP plumbing ─────────────────────────────────────

function readJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
            catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function serveStatic(res, urlPath) {
    const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || rel.startsWith('node_modules') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        return send(res, 404, 'Not found', 'text/plain');
    }
    send(res, 200, fs.readFileSync(file), MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
}

async function handleApi(req, res, parts) {
    const [resource, slug] = parts;
    if (slug !== undefined && !SLUG.test(slug)) return send(res, 400, { error: `Bad slug: ${slug}` });

    if (req.method === 'GET' && resource === 'content') return send(res, 200, loadContent());

    if (resource === 'publish') {
        if (req.method === 'GET') return send(res, 200, await publishStatus());
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        if (publishing) return send(res, 409, { error: 'A publish is already running' });
        publishing = true;
        try {
            const result = await publish(await readJson(req));
            return send(res, 200, { ...result, status: await publishStatus() });
        } finally {
            publishing = false;
        }
    }

    if (req.method === 'POST' && resource === 'images') {
        const { name, dataUrl } = await readJson(req);
        return send(res, 200, { path: await saveImage(name, dataUrl) });
    }

    if (req.method === 'PUT' && resource === 'gigs') {
        writeGigs((await readJson(req)).gigs);
    } else if (req.method === 'PUT' && resource === 'about') {
        fs.writeFileSync(path.join(CONTENT, 'about.md'), (await readJson(req)).body.trim() + '\n');
    } else if ((resource === 'releases' || resource === 'news') && slug) {
        if (req.method === 'PUT') {
            const { data, body, previousSlug } = await readJson(req);
            if (previousSlug && !SLUG.test(previousSlug)) return send(res, 400, { error: 'Bad previousSlug' });
            writeMarkdown(resource, slug, data, body, previousSlug);
        } else if (req.method === 'DELETE') {
            removeMarkdown(resource, slug);
        } else {
            return send(res, 405, { error: 'Method not allowed' });
        }
    } else {
        return send(res, 404, { error: 'Unknown endpoint' });
    }

    build();
    send(res, 200, loadContent());
}

const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    try {
        if (pathname === '/admin' || pathname === '/admin/') return send(res, 200, fs.readFileSync(ADMIN_HTML), MIME['.html']);
        if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname.split('/').slice(2).filter(Boolean));
        serveStatic(res, pathname);
    } catch (err) {
        console.error(err);
        send(res, 500, { error: err.message });
    }
});

// Rebuild when templates or content files are edited by hand
let rebuildTimer = null;
for (const dir of ['templates', 'content']) {
    fs.watch(path.join(ROOT, dir), { recursive: true }, () => {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
            try {
                build();
                console.log(`Rebuilt index.html (${new Date().toLocaleTimeString()})`);
            } catch (err) {
                console.error(`Build failed: ${err.message}`);
            }
        }, 200);
    });
}

build();
server.listen(PORT, '127.0.0.1', () => {
    console.log(`CMS running → http://localhost:${PORT}/admin`);
    console.log(`Site preview → http://localhost:${PORT}/`);
});
