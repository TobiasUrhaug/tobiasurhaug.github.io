import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { ROOT, parseFrontMatter } from '../build.js';

// Only these paths are ever committed from the CMS
const SITE_PATHS = ['content', 'images', 'index.html', 'style.css', 'templates', 'js'];

const GIT_ENV = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',                 // never wait for a password
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',  // fail instead of prompting for an SSH passphrase
};

function git(...args) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd: ROOT, env: GIT_ENV, timeout: 60_000 }, (err, stdout, stderr) => {
            if (err) reject(new Error((stderr || stdout || err.message).trim()));
            else resolve(stdout);
        });
    });
}

const gitOrNull = (...args) => git(...args).catch(() => null);

// ── What changed ──────────────────────────────────────

async function changedFiles() {
    const out = await git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...SITE_PATHS);
    const entries = out.split('\0').filter(Boolean);
    const files = [];
    for (let i = 0; i < entries.length; i++) {
        const code = entries[i].slice(0, 2);
        const file = entries[i].slice(3);
        if (code.includes('R')) i++;          // renames carry the old path as an extra entry
        const status = code === '??' || code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : 'modified';
        files.push({ file, status });
    }
    return files;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const displayDate = iso => { const [y, m, d] = String(iso).split('-'); return `${d} ${MONTHS[m - 1]} ${y}`; };

async function frontMatter(file, status) {
    const src = status === 'deleted'
        ? await gitOrNull('show', `HEAD:${file}`)
        : fs.readFileSync(path.join(ROOT, file), 'utf8');
    return src ? parseFrontMatter(src).data : {};
}

async function gigChanges() {
    const load = src => yaml.load(src ?? '', { schema: yaml.CORE_SCHEMA }) ?? [];
    const before = load(await gitOrNull('show', 'HEAD:content/gigs.yml'));
    const after = load(fs.readFileSync(path.join(ROOT, 'content/gigs.yml'), 'utf8'));
    const key = g => `${g.date}|${g.title}`;
    const label = g => `${g.title} (${displayDate(g.date)})`;
    const beforeMap = new Map(before.map(g => [key(g), g]));
    const afterMap = new Map(after.map(g => [key(g), g]));

    const items = [];
    for (const [k, g] of afterMap) {
        if (!beforeMap.has(k)) items.push({ verb: 'Add', kind: 'gig', label: label(g) });
        else if (JSON.stringify(beforeMap.get(k)) !== JSON.stringify(g)) items.push({ verb: 'Update', kind: 'gig', label: label(g) });
    }
    for (const [k, g] of beforeMap) {
        if (!afterMap.has(k)) items.push({ verb: 'Remove', kind: 'gig', label: label(g) });
    }
    return items;
}

const VERB = { added: 'Add', modified: 'Update', deleted: 'Remove' };

async function describe(files) {
    const items = [];
    let layout = false;
    let images = false;

    for (const { file, status } of files) {
        if (file === 'content/gigs.yml') {
            items.push(...await gigChanges());
        } else if (file.startsWith('content/releases/')) {
            const r = await frontMatter(file, status);
            items.push({ verb: VERB[status], kind: 'release', label: `${r.id} ${r.title}` });
        } else if (file.startsWith('content/news/')) {
            const p = await frontMatter(file, status);
            items.push({ verb: VERB[status], kind: 'news post', label: `(${displayDate(p.date)})` });
        } else if (file === 'content/about.md') {
            items.push({ verb: 'Update', kind: 'about text', label: '' });
        } else if (file === 'style.css' || file.startsWith('templates/') || file.startsWith('js/')) {
            layout = true;
        } else if (file.startsWith('images/')) {
            images = true;
        }
    }

    if (layout) items.push({ verb: 'Update', kind: 'layout', label: '' });
    if (images && items.length === 0) items.push({ verb: 'Update', kind: 'images', label: '' });
    if (items.length === 0 && files.length) items.push({ verb: 'Rebuild', kind: 'site', label: '' });
    return items;
}

const itemLine = ({ verb, kind, label }) =>
    kind === 'gig' || kind === 'release' ? `${verb} ${kind}: ${label}` : `${verb} ${kind}${label ? ` ${label}` : ''}`;

function suggestMessage(items) {
    if (items.length === 0) return '';
    if (items.length === 1) return itemLine(items[0]);

    // "Update site: add 2 gigs, update news post"
    const groups = new Map();
    for (const { verb, kind } of items) {
        const k = `${verb.toLowerCase()}|${kind}`;
        groups.set(k, (groups.get(k) ?? 0) + 1);
    }
    const summary = [...groups].map(([k, n]) => {
        const [verb, kind] = k.split('|');
        return n > 1 ? `${verb} ${n} ${kind}s` : `${verb} ${kind}`;
    }).join(', ');
    return `Update site: ${summary}\n\n${items.map(i => `- ${itemLine(i)}`).join('\n')}`;
}

// ── Status & publishing ───────────────────────────────

async function upstream() {
    return (await gitOrNull('rev-parse', '--abbrev-ref', '@{u}'))?.trim() ?? null;
}

async function countCommits(range) {
    return Number((await gitOrNull('rev-list', '--count', range))?.trim() ?? 0);
}

export async function publishStatus() {
    const branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
    const files = await changedFiles();
    const items = await describe(files);
    const up = await upstream();
    return {
        branch,
        live: branch === 'master',
        upstream: up,
        unpushed: up ? await countCommits(`${up}..HEAD`) : null,
        files,
        changes: items.map(itemLine),
        message: suggestMessage(items),
    };
}

export async function publish({ message, files: selected = [] }) {
    const status = await publishStatus();
    const changed = new Set(status.files.map(f => f.file));
    const unknown = selected.filter(f => !changed.has(f));
    if (unknown.length) throw new Error(`Not a changed site file: ${unknown.join(', ')}`);

    const staged = (await git('diff', '--cached', '--name-only')).split('\n').filter(Boolean);
    const strayStaged = staged.filter(f => !selected.includes(f) && f !== 'index.html');
    if (strayStaged.length) throw new Error(`Other files are already staged (${strayStaged.join(', ')}). Unstage or commit them first.`);

    const willCommit = selected.length > 0;
    if (willCommit && !message?.trim()) throw new Error('Commit message is empty');
    if (!willCommit && !status.unpushed) throw new Error('Nothing to commit or push');

    // Refuse to push on top of commits we haven't pulled
    await git('fetch', '--quiet', 'origin');
    if (status.upstream && await countCommits(`HEAD..${status.upstream}`) > 0) {
        throw new Error(`GitHub has commits that aren't here yet. Run "git pull" first, then publish again.`);
    }

    let commit = null;
    if (willCommit) {
        const toAdd = changed.has('index.html') && !selected.includes('index.html') ? [...selected, 'index.html'] : selected;
        await git('add', '-A', '--', ...toAdd);
        await git('commit', '-m', message.trim());   // pre-commit hook rebuilds and stages index.html
        commit = (await git('rev-parse', '--short', 'HEAD')).trim();
    }

    try {
        await git('push', ...(status.upstream ? [] : ['-u', 'origin', status.branch]));
    } catch (err) {
        throw new Error(`${commit ? `Committed ${commit}, but the push` : 'Push'} failed: ${err.message}`);
    }

    return { commit, branch: status.branch, live: status.live };
}
