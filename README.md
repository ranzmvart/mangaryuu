# Ryuu Manga Reader - V2 Stable

Versi ini adalah perbaikan untuk deploy Netlify yang sudah berhasil online tetapi beberapa chapter/halaman gambar tidak tampil.

## Perbaikan utama

- UI website default **Bahasa Indonesia**.
- Bahasa manga/chapter default **English** agar chapter lebih banyak tersedia.
- Chapter kosong/external otomatis difilter agar tidak muncul di daftar baca.
- Gambar halaman memakai sistem **direct image + fallback Netlify Function image proxy**.
- URL image proxy langsung memakai `/.netlify/functions/image` agar tidak bergantung pada redirect `/api/image`.
- Pesan error reader dibuat lebih jelas.

## Struktur file yang benar

```text
mangaryuu/
├── index.html
├── netlify.toml
├── README.md
├── assets/
│   ├── css/style.css
│   └── js/app.js
└── netlify/
    └── functions/
        ├── mangadex.js
        └── image.js
```

## Setting Netlify

```text
Branch to deploy      : main
Base directory        : kosongkan jika index.html ada di root repo
Build command         : kosongkan
Publish directory     : .
Functions directory   : netlify/functions
Environment variables : kosongkan
```

## Test setelah deploy

Ganti domain sesuai domain Netlify kamu:

```text
https://mangaryuu.netlify.app/api/mangadex/manga?limit=1
```

Kalau muncul JSON, proxy MangaDex sudah aktif.

Untuk test function gambar, buka chapter dulu dari website. Jika gambar direct gagal, app otomatis mencoba lewat Netlify Function image proxy.

## Catatan

Tidak semua chapter MangaDex bisa dibaca. Beberapa chapter bisa kosong, sudah dihapus, external-only, atau gambar sedang gagal diakses. Versi ini sudah memfilter chapter dengan `pages = 0`, tetapi tetap ada kemungkinan chapter tertentu gagal karena sumbernya di MangaDex.

MangaPlus jangan dibuat reader langsung di website sendiri; gunakan link resmi saja.
