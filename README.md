# Ryuu Manga Reader - Netlify Proxy Fix

Versi ini memperbaiki masalah **Gagal memuat beranda** di deploy Netlify dengan menambahkan Netlify Functions proxy:

- `/api/mangadex/*` -> proxy ke `https://api.mangadex.org/*`
- `/api/image?url=...` -> proxy gambar dari `uploads.mangadex.org`

## Kenapa perlu versi ini?

Pada beberapa jaringan/browser, request langsung dari frontend ke MangaDex API bisa gagal, dibatasi, atau terblokir. Versi ini membuat request API lewat domain Netlify kamu sendiri sehingga lebih stabil.

## Cara deploy yang direkomendasikan

### Opsi 1 - GitHub + Netlify

1. Extract ZIP ini.
2. Upload semua isi folder ke repository GitHub.
3. Di Netlify pilih **Add new project**.
4. Pilih repository GitHub tersebut.
5. Setting deploy:
   - Build command: kosongkan
   - Publish directory: `.`
6. Deploy.

### Opsi 2 - Netlify CLI

```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod --dir .
```

## Catatan penting

- Versi proxy image bisa memakai bandwidth Netlify lebih banyak karena gambar dibaca lewat domain Netlify kamu.
- Untuk project publik besar, lebih baik buat backend/cache sendiri dan hormati aturan sumber konten.
- MangaPlus jangan dibuat reader langsung; gunakan link resmi saja.
