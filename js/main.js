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

// ── Past gigs ─────────────────────────────────────────
const today = new Date();
today.setHours(0, 0, 0, 0);

document.querySelectorAll('.accordion-item').forEach(item => {
    const keyEl = item.querySelector('.col-key');
    if (!keyEl) return;
    const date = new Date(keyEl.textContent.trim());
    if (!isNaN(date) && date < today) item.classList.add('past');
});

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
