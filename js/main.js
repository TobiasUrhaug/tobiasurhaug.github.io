const navLinks = document.querySelectorAll('nav a[data-section]');
const sections = document.querySelectorAll('main section');

function show(id) {
    sections.forEach(s => s.classList.toggle('active', s.id === id));
    navLinks.forEach(a => a.classList.toggle('active', a.dataset.section === id));
}

navLinks.forEach(a => {
    a.addEventListener('click', e => {
        e.preventDefault();
        show(a.dataset.section);
    });
});

// default to news
show('news');

// ── Past gigs & next gig bar ──────────────────────────
const today = new Date();
today.setHours(0, 0, 0, 0);

let nextGig = null;

document.querySelectorAll('#gigs .accordion-item').forEach(item => {
    const keyEl = item.querySelector('.col-key');
    if (!keyEl) return;
    const date = new Date(keyEl.textContent.trim());
    if (isNaN(date)) return;
    if (date < today) {
        item.classList.add('past');
    } else if (!nextGig || date < nextGig.date) {
        nextGig = { date, item };
    }
});

const nextGigBar = document.getElementById('next-gig-bar');
if (nextGigBar && nextGig) {
    const title   = nextGig.item.querySelector('.col-title')?.textContent.trim() ?? '';
    const venue   = nextGig.item.querySelector('.col-venue')?.textContent.trim() ?? '';
    const meta    = nextGig.item.querySelector('.col-meta')?.textContent.trim() ?? '';
    const dateStr = nextGig.item.querySelector('.col-key')?.textContent.trim() ?? '';
    const href    = nextGig.item.querySelector('.accordion-body-inner a')?.href ?? '#';
    const text    = `Next gig: ${title} — ${venue}, ${meta} — ${dateStr}`;
    nextGigBar.innerHTML = `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
}

// ── Accordion ─────────────────────────────────────────
document.querySelectorAll('.accordion-item .table-row').forEach(btn => {
    btn.addEventListener('click', () => {
        const item = btn.closest('.accordion-item');
        const isOpen = item.classList.contains('open');

        document.querySelectorAll('.accordion-item.open').forEach(other => {
            if (other !== item) {
                other.classList.remove('open');
                other.querySelector('.table-row').setAttribute('aria-expanded', 'false');
            }
        });

        item.classList.toggle('open', !isOpen);
        btn.setAttribute('aria-expanded', String(!isOpen));
    });
});
