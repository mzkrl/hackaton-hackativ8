# Frontend Security and Langflow Integration Plan

## Scope

Frontend tetap menggunakan skema login-not-required untuk basic sequence analysis.
User dapat masuk sebagai guest, tetapi browser dan API client harus diperlakukan
sebagai environment yang tidak tepercaya. Frontend membantu mengurangi abuse dan
menjaga data yang disimpan di browser; enforcement utama tetap berada di backend.

Langflow belum tersedia pada frontend saat ini. Koneksi ke Langflow dicatat sebagai
tech debt dan tidak boleh membuat UI menganggap analisis berhasil sebelum hasil
benar-benar dikonfirmasi oleh backend.

## Goals

- [ ] Guest dapat memakai workflow dasar tanpa registrasi.
- [ ] Upload, paste, submit analysis, dan polling memiliki batas yang jelas.
- [ ] Frontend tidak mengekspos secret atau menganggap client-side validation sebagai security boundary.
- [ ] Data guest di browser dibatasi, dapat dihapus, dan tidak menyimpan hasil sensitif secara tidak perlu.
- [ ] Kegagalan atau belum tersedianya Langflow terlihat jelas dan dapat dipulihkan.
- [ ] Kontrak integrasi Langflow terdokumentasi sebelum service disambungkan.

## Phase 1: Guest Abuse Controls

- [ ] Tambahkan client-side cooldown dan deduplication untuk submit analysis agar double-click atau retry berulang tidak membuat job ganda.
- [ ] Batasi polling per analysis dengan interval, backoff saat error, batas waktu maksimum, dan penghentian polling saat tab tidak aktif.
- [ ] Batasi jumlah analysis aktif dan jumlah tracked analysis yang disimpan per browser.
- [ ] Jangan membuat retry otomatis untuk error `4xx`, authorization, validation, atau quota.
- [ ] Untuk `429`, `503`, dan network error, tampilkan state retry yang eksplisit tanpa retry loop tanpa batas.
- [ ] Validasi ukuran file, ekstensi, tipe input, panjang sequence, dan panjang description sebelum request.
- [ ] Pastikan upload direct hanya memakai presigned URL dari backend; credential object storage tidak boleh masuk bundle frontend.
- [ ] Tampilkan batas guest dan status quota dari response backend, bukan menghitung quota secara client-side sebagai sumber kebenaran.

## Phase 2: Browser Data and Session Hardening

- [ ] Audit semua data yang ditulis ke `localStorage` atau IndexedDB; simpan metadata minimum dan hindari raw sequence, token, secret, atau credential.
- [ ] Tambahkan aksi untuk menghapus tracked analysis, guest history, dan data lokal terkait dari satu tempat.
- [ ] Terapkan expiry/retention untuk reference job guest yang sudah terminal atau terlalu lama.
- [ ] Perlakukan semua data dari API, nama file, description, sequence metadata, dan AI output sebagai untrusted text; render sebagai text, bukan HTML mentah.
- [ ] Pertahankan `credentials: "include"` hanya untuk API yang memang membutuhkan session cookie.
- [ ] Pastikan environment variable `NEXT_PUBLIC_*` hanya berisi konfigurasi publik. Secret Langflow, API key, database, Redis, dan storage tidak boleh berada di frontend.
- [ ] Review logout, session-expired state, dan perpindahan guest ke authenticated flow agar data antar-user tidak tercampur.
- [ ] Tambahkan CSP dan security headers pada deployment frontend jika kompatibel dengan Next.js/Cloudflare Pages.

## Phase 3: Backend Contract Required by Frontend

Frontend security tidak cukup tanpa enforcement server-side. Backend perlu menyediakan atau mengonfirmasi hal berikut:

- [ ] Rate limit guest berdasarkan anonymous session, IP/device signals yang sesuai, dan endpoint; jangan percaya identifier dari client sebagai satu-satunya kontrol.
- [ ] Enforce request body size, upload size, sequence length, description length, queue depth, concurrency, timeout, dan job expiration di server.
- [ ] Pastikan ownership/authorization diperiksa pada setiap project, sequence, analysis, conversation, dan storage operation.
- [ ] Pastikan status endpoint tidak dapat dipakai untuk membaca analysis milik user atau guest session lain.
- [ ] Return stable error codes untuk validation, quota, rate limit, queue unavailable, Langflow unavailable, timeout, dan failed analysis.
- [ ] Pastikan presigned upload terikat pada project/user/session, ukuran, content type, expiry, dan object key yang aman.
- [ ] Jangan mengembalikan secret provider atau detail internal queue/storage/Langflow ke browser.
- [ ] Tambahkan audit log/metrics untuk guest submit, rejected request, quota hit, upload, dan job failure.

## Phase 4: Langflow Integration Tech Debt

### Contract

- [ ] Tentukan apakah frontend memanggil backend saja, dengan backend yang meneruskan job ke Langflow. Frontend tidak boleh memanggil Langflow langsung.
- [ ] Tentukan request contract: analysis id, sequence reference, user task, allowed tools, dan correlation/job id.
- [ ] Tentukan response contract: queued, processing, completed, failed, cancelled, result reference, dan safe error code.
- [ ] Tentukan timeout, retry policy, idempotency key, maximum tool steps, dan ukuran maksimum prompt/result.
- [ ] Pastikan structured scientific result dipisahkan dari prose AI interpretation.
- [ ] Dokumentasikan provenance: tool yang dipanggil, versi/parameter, timestamp, dan sumber evidence yang boleh ditampilkan ke user.

### Frontend Adapter

- [ ] Buat satu adapter di `front/lib` untuk status dan result Langflow melalui backend, bukan pemanggilan tersebar di komponen.
- [ ] Pertahankan UI state yang eksplisit: `idle`, `queued`, `processing`, `completed`, `failed`, `timed_out`, dan `unavailable`.
- [ ] Sediakan fallback saat Langflow belum dikonfigurasi atau sedang down: tampilkan hasil deterministic yang tersedia dan jelaskan bahwa interpretation AI belum tersedia.
- [ ] Jangan menampilkan AI interpretation sebagai fakta apabila response belum tervalidasi atau job belum completed.
- [ ] Pastikan cancel, refresh, tab close, dan reconnect tidak membuat job baru atau kehilangan reference job yang valid.

### Validation and Observability

- [ ] Tambahkan test untuk duplicate submit, polling backoff, quota/rate-limit response, expired job, malformed result, dan Langflow unavailable.
- [ ] Tambahkan contract fixture untuk response Langflow/backend yang sukses, partial, timeout, dan failed.
- [ ] Tambahkan correlation id pada request frontend jika backend menyediakan header/field tersebut.
- [ ] Catat latency submit, waktu queue, waktu Langflow, jumlah retry, dan failure code tanpa mencatat sequence mentah atau secret.

## Suggested Order

1. Konfirmasi contract error, quota, ownership, dan job lifecycle dari backend.
2. Hardening submit, upload, polling, dan local storage di frontend.
3. Tambahkan UI state untuk quota, unavailable, timeout, dan retry.
4. Finalisasi contract Langflow dengan service owner.
5. Implement adapter Langflow melalui backend.
6. Tambahkan contract tests dan abuse-focused tests.
7. Uji guest flow dengan concurrent submits, reload, reconnect, dan session transition.

## Definition of Done

- [ ] Guest masih dapat menjalankan basic analysis tanpa login.
- [ ] Double-submit, polling tanpa batas, upload berlebih, dan local history tanpa batas sudah ditangani.
- [ ] Tidak ada secret atau credential provider di client bundle.
- [ ] Server tetap menjadi sumber kebenaran untuk rate limit, quota, authorization, dan job status.
- [ ] Langflow diakses melalui backend dengan contract versioning, timeout, error state, dan fallback yang jelas.
- [ ] Frontend memiliki test untuk failure mode utama tanpa bergantung pada Langflow yang sedang hidup.
