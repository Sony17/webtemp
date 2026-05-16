# Committed tenants

Drop a folder named after a subdomain here (or under `public/`) with an
`index.html` inside, commit, and the site goes live at
`<folder-name>.openidea.co.in` — no admin upload required.

```
tenants/
  dhabba/
    index.html
    style.css
    images/
      hero.jpg
```

Lookup order (first hit wins): admin-uploaded files (Blob in prod /
`data/tenants/<sub>/` in dev) → `tenants/<sub>/` → `public/<sub>/`.

Folder names are slugified (lowercase, hyphen-separated, ≥3 chars) and
must not clash with reserved subdomains (`www`, `admin`, `api`, `app`,
`preview`, `console`, `login`, `s`).
