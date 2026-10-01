# Genomic Insight Agent — Development Plan

> **Project:** Genomic Insight Agent  
> **Category:** AI Agent + Bioinformatics Platform  
> **Primary Use Case:** Research and education assistant for biological sequence analysis  
> **Initial Context:** IBM SkillsBuild University Education National Hackathon 2026  
> **Theme:** Healthcare & Wellbeing

---

# 1. Konsep Dasar Aplikasi, Penjelasan Ilmiah, Latar Belakang Masalah, dan Solusi

## 1.1 Konsep Dasar Aplikasi

**Genomic Insight Agent** adalah aplikasi bioinformatika berbasis AI Agent yang membantu pengguna menganalisis data sequence biologis, terutama DNA, melalui kombinasi antara:

- komputasi bioinformatika deterministik menggunakan Biopython,
- AI Agent untuk reasoning dan interpretasi hasil,
- antarmuka web yang mudah digunakan,
- penyimpanan lokal untuk guest,
- penyimpanan cloud opsional bagi pengguna yang memiliki akun.

Prinsip utamanya adalah:

```text
Next.js presents.

Langflow orchestrates.

IBM Granite understands, reasons, and explains.

Biopython computes.

BLAST searches sequence similarity.

NCBI / GenBank provides biological annotations.

ElysiaJS manages the application layer.

MinIO / AIStor stores research objects.

PostgreSQL remembers metadata.

Redis + BullMQ controls expensive analysis jobs and absorbs traffic bursts.
```

Aplikasi dirancang agar dapat langsung digunakan tanpa login.

Guest dapat:

```text
upload sequence
↓
analyze
↓
read AI interpretation
↓
save local history
```

Sedangkan pengguna yang memilih membuat akun mendapatkan:

```text
cloud history
project management
cross-device persistence
guest history migration
```

Authentication bukan syarat utama untuk menggunakan tools dasar.

---

## 1.2 Penjelasan Ilmiah

Data biologis seperti DNA biasanya direpresentasikan dalam bentuk sequence nucleotide:

```text
A
T
G
C
```

Setiap simbol mewakili basa nitrogen:

```text
A = Adenine
T = Thymine
G = Guanine
C = Cytosine
```

Sequence DNA dapat dianalisis untuk mendapatkan berbagai informasi biologis.

Contoh analisis dasar:

```text
sequence length
nucleotide composition
GC content
ORF detection
DNA translation
```

### Nucleotide Composition

Menghitung jumlah:

```text
A
T
G
C
```

dalam sequence.

Contoh hasil:

```json
{
  "A": 4890,
  "T": 4670,
  "G": 2610,
  "C": 4471
}
```

### GC Content

GC content menunjukkan proporsi Guanine dan Cytosine terhadap keseluruhan nucleotide.

Secara umum:

```text
GC% = (G + C) / total nucleotide × 100
```

GC content dapat menjadi salah satu indikator awal karakteristik biologis sequence.

### ORF Detection

ORF atau **Open Reading Frame** adalah region DNA yang berpotensi menghasilkan protein.

Analisis ORF dapat mencakup:

```text
start codon
reading frame
stop codon
length
strand
```

### Translation

DNA coding region dapat diterjemahkan menjadi sequence asam amino.

Contoh:

```text
DNA
ATGGCC...
↓
Protein
MA...
```

---

## 1.3 Peran AI

AI tidak digunakan untuk menghitung nucleotide atau menentukan hasil biologis secara probabilistik.

Perhitungan ilmiah dilakukan oleh tool deterministik seperti Biopython, sedangkan pencarian kemiripan sequence dilakukan melalui BLAST dan metadata biologis diambil dari sumber seperti NCBI / GenBank.

Pada arsitektur saat ini:

```text
Langflow
= orchestration layer

IBM Granite via watsonx.ai
= intent understanding + reasoning + explanation

Biopython
= deterministic local bioinformatics computation

BLAST
= sequence similarity search

NCBI / GenBank
= annotation and biological record source
```

Flow AI utama:

```text
User request
↓
Langflow Agent + IBM Granite memahami task
↓
Granite menentukan analysis plan
↓
Langflow memilih dan memanggil tool yang diperlukan
↓
Biopython / BLAST / NCBI tool menghasilkan structured evidence
↓
Granite mengintegrasikan evidence
↓
Granite menjelaskan hasil dalam bahasa yang mudah dipahami
↓
response ke user
```

Prinsip ilmiahnya:

> **AI bukan sumber kebenaran biologis. AI adalah reasoning layer yang menggabungkan evidence dari scientific tools dan biological databases.**

---

## 1.4 Latar Belakang Masalah

Banyak tool bioinformatika dapat melakukan analisis sequence dengan akurat, tetapi pengguna pemula masih menghadapi beberapa hambatan.

### Masalah 1 — Format data biologis tidak sederhana

Format seperti FASTA dan GenBank mengandung struktur data yang harus dipahami sebelum dianalisis.

Contoh FASTA:

```text
>sequence_id description
ATGCTGATCGATCG...
```

Jika pengguna hanya membaca file sebagai string biasa, metadata dapat ikut terbaca sebagai bagian sequence apabila parsing dilakukan secara salah.

### Masalah 2 — Banyak tool membutuhkan pengetahuan teknis

Pengguna perlu memahami:

```text
tool apa yang digunakan
parameter apa yang diperlukan
hasil mana yang penting
analisis lanjutan apa yang relevan
```

### Masalah 3 — Output bioinformatika sering sulit dipahami

Tool dapat menghasilkan angka dan sequence, tetapi belum tentu menjelaskan makna biologisnya.

Contoh:

```text
GC content = 42.5%
```

Pengguna pemula masih dapat bertanya:

```text
Apakah angka ini tinggi?
Apa maknanya?
Apa yang sebaiknya dianalisis berikutnya?
```

### Masalah 4 — Hambatan penggunaan

Untuk analisis sederhana, pengguna seharusnya tidak dipaksa:

```text
register
verify email
login
```

sebelum dapat menggunakan satu tool dasar.

---

## 1.5 Solusi

Genomic Insight Agent menawarkan workflow agentic yang tidak memaksa pengguna mengetahui tool bioinformatika mana yang harus digunakan.

Basic workflow:

```text
User memberikan FASTA dan task
↓
Langflow Agent + IBM Granite memahami permintaan
↓
AI membuat analysis plan
↓
Langflow memanggil Biopython tool yang diperlukan
↓
Structured sequence analysis
↓
Granite menginterpretasikan hasil
↓
Output ke user
```

Jika task membutuhkan identifikasi atau pencarian kemiripan sequence:

```text
Input FASTA
↓
AI Task Understanding
↓
AI Analysis Planning
↓
Biopython Local Analysis
↓
BLAST Similarity Search
↓
BLAST Hits
(accession, identity, E-value, alignment)
↓
NCBI / GenBank Record Retrieval
↓
Annotation + Metadata
↓
Evidence Integration by Granite
↓
Final Biological Interpretation
↓
Output to User
```

Aplikasi bersifat:

```text
guest-first
account-optional
research-oriented
education-oriented
```

Bukan:

```text
clinical diagnosis system
disease prediction engine
treatment recommender
```

---

# 2. Fitur

## 2.1 Fitur yang Harus Ada

Fitur berikut termasuk MVP dan harus tersedia pada versi hackathon/demo.

### A. Guest Mode

User dapat menggunakan aplikasi tanpa login.

Guest dapat:

```text
upload sequence
run analysis
use AI interpretation
view local history
```

### B. FASTA Upload

Support awal:

```text
.fasta
.fa
.fna
```

### C. Biological Sequence Parsing

Gunakan Biopython:

```python
from Bio import SeqIO
```

Parser harus dapat memisahkan:

```text
sequence ID
description
sequence
```

### D. Sequence Validation

Validasi meliputi:

```text
empty sequence
invalid character
ambiguous base
sequence length
sequence type
```

### E. Nucleotide Composition

Menghitung:

```text
A
T
G
C
```

### F. GC Content

Menghitung persentase:

```text
G + C
```

terhadap total sequence.

### G. ORF Detection

Versi dasar:

```text
forward strand
reading frame
start
stop
length
```

### H. DNA Translation

Mengubah coding region menjadi protein sequence.

### I. AI Interpretation

AI menjelaskan:

```text
sequence statistics
GC content
ORF findings
translation result
possible next analysis
```

### J. AI Tool Calling

Langflow Agent menggunakan IBM Granite sebagai reasoning model untuk memahami task dan menentukan tool yang diperlukan.

Contoh local analysis:

```text
User:
"Find the longest ORF and translate it."

Granite:
understand task
↓
Langflow:
call find_orfs()
↓
Granite:
identify longest ORF
↓
Langflow:
call translate_orf()
↓
Granite:
explain result
```

Tool tidak dipanggil berdasarkan keyword hard-coded. Agent menentukan kebutuhan tool berdasarkan task pengguna dan hasil tool sebelumnya.

### K. Local History

Guest history disimpan di browser menggunakan:

```text
IndexedDB
```

Bukan hanya localStorage.

Data yang dapat disimpan:

```text
analysis metadata
sequence metadata
analysis results
conversation history
```

Raw sequence dapat disimpan secara selektif sesuai kebutuhan.

### L. Object Storage for Research Files

Authenticated users dapat menyimpan file penelitian pada object storage S3-compatible:

```text
FASTA
GenBank
analysis artifacts
reports
future large biological datasets
```

Storage provider yang digunakan untuk self-hosted deployment:

```text
MinIO
atau
MinIO AIStor
```

PostgreSQL tidak digunakan untuk menyimpan file binary berukuran besar. PostgreSQL menyimpan metadata dan object key, sedangkan file aktual disimpan pada object storage.

Contoh metadata:

```text
Sequence
├── id
├── project_id
├── filename
├── format
├── sequence_length
├── sequence_hash
└── object_key
```

File dapat di-upload melalui backend atau menggunakan presigned URL agar browser dapat mengirim file langsung ke object storage tanpa menerima credential storage.

### M. Optional Authentication

Login bukan syarat menggunakan tools.

Akun digunakan untuk:

```text
cloud history
project persistence
project management
cross-device access
```

### N. Guest-to-Account Migration

Jika guest membuat akun:

```text
IndexedDB
↓
Login
↓
Import local analyses
↓
ElysiaJS
↓
PostgreSQL
```

---

## 2.2 Fitur yang Disarankan Ada

Fitur ini tidak mutlak untuk MVP pertama, tetapi sangat berguna jika waktu pengembangan mencukupi.

### A. Sequence Visualization

```text
length
composition chart
GC chart
ORF table
```

### B. GenBank Support

Format:

```text
.gb
.gbk
.genbank
```

### C. Six-Frame ORF Detection

Menganalisis:

```text
3 forward frames
+
3 reverse-complement frames
```

### D. BLAST Similarity Search

Untuk sequence DNA pada tahap awal, prioritas integrasi adalah:

```text
BLASTN
```

Hasil utama yang dikembalikan ke agent:

```text
accession ID
sequence identity
E-value
bit score
alignment
```

### E. NCBI / GenBank Record Retrieval

Accession ID dari BLAST digunakan untuk mengambil record biologis terkait dari NCBI / GenBank.

Data yang relevan dapat mencakup:

```text
organism
gene
CDS
product
feature annotations
references
record metadata
```

BLAST dan GenBank diperlakukan sebagai dua tool berbeda:

```text
blast_sequence()
fetch_ncbi_record()
```

### F. Project Workspace

Authenticated user dapat membuat:

```text
Project
├── Sequence
├── Analysis
├── Conversation
└── Report
```

### G. Analysis History

Authenticated user dapat membuka kembali analisis lama.

### H. Report Generation

Generate summary:

```text
sequence metadata
analysis result
AI interpretation
```

### I. Queueing and Abuse Protection

Karena tools dasar dapat digunakan tanpa login, request yang membutuhkan komputasi atau external API tidak langsung dieksekusi oleh worker. Request masuk ke queue terlebih dahulu agar lonjakan traffic tidak membuat Bio Service, BLAST, atau AI provider overload.

Gunakan:

```text
Redis
BullMQ
```

Queue digunakan untuk:

```text
analysis jobs
BLAST jobs
AI interpretation jobs
retry handling
concurrency control
job timeout / expiration
```

Rate limiting tetap diterapkan pada API gateway dan job submission. Guest tidak membutuhkan account ID; job menggunakan anonymous job/session identifier yang dapat disimpan di browser.

### J. Reverse Proxy / API Gateway

Digunakan untuk:

```text
TLS
routing
request-size limit
rate limiting
service isolation
```

---

## 2.3 Fitur Tambahan untuk Pengembangan Kedepannya

### Bioinformatics

```text
sequence annotation
multiple sequence alignment
phylogenetic analysis
protein analysis
variant analysis
additional BLAST modes (BLASTP, BLASTX, TBLASTN, TBLASTX)
```

### External Biological Databases

Integrasi:

```text
NCBI
UniProt
Ensembl
```

### Advanced Agent Workflow

Langflow Agent dan IBM Granite dapat bekerja bersama untuk:

```text
understand complex analysis requests
plan multi-tool workflows
call Biopython tools
run BLAST similarity searches
retrieve NCBI / GenBank records
compare structured evidence
perform follow-up analysis
generate research summaries
```

### Advanced Data Visualization

Contoh:

```text
interactive genome viewer
ORF map
feature map
alignment viewer
```

### Distributed Processing

Untuk workload besar:

```text
BullMQ
Redis
multiple Bio Workers
```

### Monetization

Monetization **bukan scope hackathon/demo**.

Jika aplikasi dipublikasikan di masa depan, baru dilakukan:

```text
usage analysis
↓
infrastructure cost analysis
↓
user demand analysis
↓
monetization decision
```

Potential future model:

```text
free tools
+
paid advanced compute
```

Tetapi tidak perlu diimplementasikan sekarang.

---

# 3. Tech Stack

## 3.1 Frontend

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui
Recharts
TanStack Query
IndexedDB
```

Responsibilities:

```text
UI
file upload
guest history
chat
dashboard
visualization
project navigation
```

---

## 3.2 Application Backend

```text
ElysiaJS
Bun
TypeScript
Drizzle ORM
PostgreSQL
```

Responsibilities:

```text
authentication
authorization
users
projects
analysis persistence
conversation persistence
guest migration
Langflow integration
API management
```

ElysiaJS dipilih karena ringan, type-safe, dan lebih cepat dikembangkan untuk scope aplikasi ini dibanding backend framework yang lebih berat.

Drizzle ORM digunakan sebagai database layer yang tetap dekat dengan SQL dan cocok dengan TypeScript + Bun.

---

## 3.3 Bioinformatics Service

```text
Python
FastAPI
Biopython
Pydantic
pytest
```

Responsibilities:

```text
FASTA parsing
validation
nucleotide counting
GC content
ORF detection
translation
future advanced bioinformatics
```

Bio Service dibuat terpisah dari ElysiaJS agar scientific computation dapat berkembang secara independen.

---

## 3.4 AI Layer

```text
Langflow
IBM Granite
watsonx.ai model inference API
```

Responsibilities:

```text
Langflow
├── agent orchestration
├── tool selection
├── tool calling
├── multi-step workflow
└── tool-result routing

IBM Granite
├── intent understanding
├── analysis planning
├── reasoning over tool results
├── biological interpretation
└── response formulation

watsonx.ai
└── Granite model provider / inference endpoint
```

Pada MVP, **Langflow menjadi satu-satunya orchestration layer**. IBM Granite digunakan sebagai reasoning model melalui provider **watsonx.ai**.

Langflow dijalankan sebagai service/container sendiri apabila self-hosted.

Arsitektur dibuat agar provider model dapat diganti di masa depan tanpa mengubah Bio Service atau frontend, misalnya ke Granite self-hosted melalui Ollama jika memang diperlukan.

---

## 3.5 Object Storage

```text
MinIO
MinIO AIStor
S3-compatible API
```

Digunakan untuk menyimpan file dan artifact penelitian yang tidak cocok disimpan langsung di PostgreSQL, seperti:

```text
raw FASTA / GenBank files
analysis artifacts
project reports
large result files
```

MinIO digunakan untuk local/self-hosted development, sedangkan MinIO AIStor dapat digunakan ketika deployment membutuhkan object-storage platform yang lebih enterprise. Keduanya diakses melalui API S3-compatible sehingga application layer tidak perlu terikat pada vendor tertentu.

Backend bertanggung jawab atas credential storage. Frontend sebaiknya menggunakan presigned URL untuk upload/download object apabila ukuran file besar atau direct-to-storage upload lebih efisien.

---

## 3.6 Database

```text
PostgreSQL
```

Digunakan sebagai persistent source of truth untuk data terstruktur, metadata, relasi project, analysis, conversation, dan reference ke object storage.

---

## 3.7 Browser Storage

```text
IndexedDB
```

Digunakan untuk guest history.

---

## 3.8 Queue and Cache

```text
Redis
BullMQ
```

Redis + BullMQ **wajib untuk MVP public/guest flow**, bukan sekadar fitur future scaling. Alasannya adalah aplikasi dapat menerima request tanpa authentication, sehingga user tidak boleh langsung membuat banyak proses berat secara bersamaan.

Redis digunakan sebagai backing store untuk BullMQ, sedangkan PostgreSQL tetap menjadi persistent source of truth untuk metadata dan status domain. Queue tidak menggantikan PostgreSQL.

Digunakan untuk:

```text
analysis job queue
BLAST job queue
AI interpretation queue
concurrency limit
retry / backoff
job timeout / expiration
queue depth monitoring
optional cache
```

Prinsipnya:

```text
User request
↓
ElysiaJS
↓
Create Analysis Job
↓
PostgreSQL stores job metadata
↓
BullMQ
↓
Redis
↓
Worker executes job
```

Dengan pola ini, request guest tetap dapat diterima walaupun worker sedang sibuk. User mendapatkan status seperti `queued`, `processing`, `completed`, atau `failed` daripada membuat HTTP request menunggu proses panjang.

---

## 3.9 Development Tools

```text
pnpm
uv
Docker
Docker Compose
GitHub Actions
ESLint
Prettier
Ruff
pytest
```

---

# 4. Arsitektur Basis Data dan API

## 4.1 Database Architecture

### Persistent Database

Gunakan:

```text
PostgreSQL
```

dengan Drizzle ORM pada ElysiaJS.

### Object Storage

Gunakan object storage S3-compatible untuk data binary atau file penelitian:

```text
MinIO / MinIO AIStor
```

Pembagian tanggung jawab:

```text
PostgreSQL
├── users
├── projects
├── sequence metadata
├── analysis metadata
├── conversation
└── object_key / file metadata

MinIO / AIStor
├── FASTA files
├── GenBank files
├── generated reports
├── analysis artifacts
└── other large research files
```

Dengan pola ini, database tetap fokus pada data terstruktur sementara object storage menangani file berukuran besar.

---

## 4.2 Core Entities

```text
User
Project
Sequence
Analysis
Conversation
Report
```

Relasi dasar:

```text
User
│
└── Project
     │
     ├── Sequence
     │    │
     │    └── Analysis
     │
     ├── Conversation
     │
     └── Report
```

---

## 4.3 User

```text
id
email
name
created_at
updated_at
```

User hanya diperlukan jika pengguna membuat akun.

---

## 4.4 Project

```text
id
user_id
name
created_at
updated_at
```

---

## 4.5 Sequence

```text
id
project_id
record_id
description
format
sequence_length
sequence_hash
object_key
original_filename
created_at
```

`object_key` mengarah ke file sequence pada MinIO / AIStor. Raw sequence tidak perlu disimpan sebagai kolom database apabila file aslinya sudah berada pada object storage.

---

## 4.6 Analysis

```text
id
sequence_id
analysis_type
status
queue_job_id
result_json
error_message
created_at
updated_at
```

`status` dapat menggunakan state:

```text
queued
processing
completed
failed
```

`queue_job_id` menyimpan identifier BullMQ agar status domain di PostgreSQL dapat dikaitkan dengan execution job pada Redis. `result_json` dapat menyimpan struktur hasil bioinformatika secara fleksibel.

---

## 4.7 Conversation

```text
id
project_id
role
content
created_at
```

---

## 4.8 Report

```text
id
project_id
content
object_key
created_at
```

`content` dapat menyimpan metadata atau text ringkas, sedangkan file report final dapat disimpan sebagai object pada MinIO / AIStor melalui `object_key`.

---

## 4.9 Guest Storage Architecture

Guest tidak wajib memiliki record User.

Local state:

```text
IndexedDB

projects
analyses
conversations
```

Guest history dapat dimigrasikan setelah login.

---

## 4.10 API Architecture

Sistem memiliki dua kelompok API utama.

### Application API

Dikelola ElysiaJS.

Example:

```text
POST   /auth/login
POST   /auth/register

GET    /projects
POST   /projects
GET    /projects/:id

POST   /analyses
GET    /analyses/:id
GET    /analyses/:id/status

POST   /guest/import

GET    /conversations/:projectId
POST   /conversations
```

Analysis submission tidak harus mengeksekusi computation secara synchronous. ElysiaJS membuat analysis record, memasukkan job ke BullMQ, lalu langsung mengembalikan job identifier kepada frontend.

### Object Storage API

Dikelola ElysiaJS untuk menyediakan akses terkontrol ke MinIO / AIStor.

Example:

```text
GET    /storage/health
POST   /storage/upload
POST   /storage/presign
GET    /storage/:key
DELETE /storage/:key
```

Untuk file besar, endpoint `POST /storage/presign` dapat mengembalikan presigned URL agar browser melakukan upload langsung ke object storage. Credential MinIO / AIStor tidak pernah dikirim ke frontend.

### Bioinformatics API

Dikelola FastAPI.

Endpoint Bioinformatics API dapat didaftarkan sebagai tools pada **Langflow Agent**. IBM Granite menentukan kebutuhan analisis, lalu Langflow memanggil tool yang sesuai.

Example:

```text
POST /sequence/parse

POST /sequence/validate

POST /sequence/analyze

POST /sequence/gc-content

POST /sequence/orfs

POST /sequence/translate

POST /similarity/blast

GET  /ncbi/records/:accession
```

---

## 4.11 Example Bio API Response

```json
{
  "record": {
    "id": "NC_XXXXXX",
    "description": "Epinephelus bontoides mitochondrion",
    "length": 16641
  },
  "composition": {
    "A": 4890,
    "T": 4670,
    "G": 2610,
    "C": 4471
  },
  "gc_content": 42.5,
  "orfs": []
}
```

---

## 4.12 BLAST and NCBI Tool Contract

### BLAST Tool

Conceptual endpoint:

```text
POST /similarity/blast
```

Example structured output:

```json
{
  "program": "blastn",
  "hits": [
    {
      "accession": "NC_XXXXXX",
      "identity": 99.1,
      "e_value": 0.0,
      "bit_score": 2401.0
    }
  ]
}
```

### NCBI / GenBank Retrieval Tool

Conceptual endpoint:

```text
GET /ncbi/records/:accession
```

Tool ini mengambil biological record berdasarkan accession dari BLAST, bukan menganggap BLAST sendiri sebagai sumber seluruh metadata GenBank.

---

## 4.13 API Security

Bio Service sebaiknya tidak diekspos secara bebas tanpa protection.

Recommended:

```text
Frontend
↓
API Gateway / Reverse Proxy
├── ElysiaJS
└── Bio Service
```

Gateway menangani:

```text
rate limiting
request size
TLS
routing
basic service protection
object storage access control
```

---

# 5. Flowchart Sistem Sederhana

## 5.1 Guest Flow

```text
User
↓
Next.js
↓
ElysiaJS API
↓
Langflow Agent
↓
IBM Granite via watsonx.ai
↓
Tool Selection
↓
Bio Service / Other Scientific Tool
↓
Structured Result
↓
Granite Interpretation
↓
ElysiaJS
↓
Next.js
↓
IndexedDB Local History
```

Guest tidak membutuhkan record User di PostgreSQL untuk menjalankan basic tools.

---

## 5.2 Authenticated User Flow

```text
User
↓
Next.js
↓
ElysiaJS
├── Authentication
├── Project Context
└── Persistence
↓
Langflow Agent
↓
IBM Granite via watsonx.ai
↓
Scientific Tools
↓
Granite Interpretation
↓
ElysiaJS
↓
PostgreSQL
↓
MinIO / AIStor (research files)
↓
Next.js
```

---

## 5.3 Basic Agent Tool Calling Flow

```text
User Request
↓
Langflow Agent + Granite
↓
Understand Task
↓
Plan Required Analysis
↓
Need Scientific Tool?
├── No
│   ↓
│ Granite generates response
│
└── Yes
    ↓
Langflow calls Biopython Tool
    ↓
Structured Result
    ↓
Granite interprets evidence
    ↓
Frontend
```

---

## 5.4 BLAST + NCBI / GenBank Research Flow

```text
Input FASTA
↓
Langflow Agent + Granite
↓
AI Task Understanding
↓
AI Analysis Planning
↓
Biopython Local Analysis
├── validation
├── composition
├── GC content
├── ORF
└── translation when needed
↓
Granite evaluates local result
↓
Need Similarity Search?
├── No
│   ↓
│ Final Interpretation
│
└── Yes
    ↓
Langflow calls BLAST Tool
    ↓
BLAST Similarity Hits
├── accession
├── identity
├── E-value
├── bit score
└── alignment
    ↓
Granite selects relevant hit(s)
    ↓
Langflow calls NCBI / GenBank Tool
    ↓
GenBank Record / Annotation
├── organism
├── gene
├── CDS
├── product
├── features
└── references
    ↓
Granite integrates evidence
    ↓
Final Biological Interpretation
    ↓
Output to User
```

BLAST dan NCBI retrieval tetap dipisahkan agar agent dapat memutuskan kapan annotation record benar-benar diperlukan.

---

## 5.5 Research File Storage Flow

```text
User uploads FASTA / GenBank / Report
↓
Next.js
↓
ElysiaJS
↓
Request presigned upload URL
↓
MinIO / AIStor
↓
Object key returned
↓
ElysiaJS
↓
PostgreSQL stores metadata + object key
```

Untuk download, backend dapat memvalidasi authorization lalu menghasilkan presigned GET URL sehingga object tetap private.

## 4.15 Analysis Queue Architecture

Semua operasi yang berpotensi mahal atau memerlukan external service dijalankan melalui queue, terutama pada guest flow.

```text
Guest / Authenticated User
↓
Next.js
↓
ElysiaJS
↓
Validate request + rate limit
↓
Create Analysis record (PostgreSQL)
↓
BullMQ
↓
Redis
↓
Bio Worker / BLAST Worker / AI Worker
↓
Structured Result
↓
PostgreSQL updates status + result
↓
Next.js polls / receives job status
```

Queue policy minimal:

```text
maximum active jobs per worker
maximum queue depth
job timeout
retry with backoff
failed-job retention
result persistence in PostgreSQL
```

Guest job identifiers tidak bergantung pada database User. Browser menyimpan anonymous session/job reference agar guest dapat melihat progress tanpa login.

Redis dipakai untuk queue execution state dan koordinasi worker; PostgreSQL dipakai untuk durable application state sehingga restart Redis atau worker tidak menjadi satu-satunya sumber data analisis.

---

## 5.6 Guest Analysis Queue Flow

Karena anonymous/guest request dapat datang tanpa login, computation berat tidak boleh dijalankan langsung pada request HTTP.

```text
Guest User
↓
Next.js
↓
ElysiaJS
↓
Rate Limit + Validation
↓
PostgreSQL: create analysis (queued)
↓
BullMQ
↓
Redis
↓
Bio Worker / BLAST Worker / AI Worker
↓
Structured Result
↓
PostgreSQL: update analysis
↓
Next.js checks job status
↓
User receives result
```

Contoh state:

```text
queued → processing → completed
                 └→ failed
```

Worker concurrency harus dibatasi agar jumlah job paralel sesuai kapasitas CPU, memory, external API quota, dan batas AI provider.

---

# 6. SDLC Pengembangan secara Iterative

Model pengembangan menggunakan pendekatan **Iterative Development**.

Setiap iterasi menghasilkan versi aplikasi yang dapat diuji.

Prinsip:

```text
Plan
↓
Design
↓
Build
↓
Test
↓
Evaluate
↓
Improve
↓
Next Iteration
```

Tidak seluruh fitur dibangun sekaligus.

---

## Iteration 0 — Requirement and Scope Definition

Goal:

```text
define MVP
avoid scope creep
confirm IBM requirements
```

Tasks:

- [ ] Define user persona
- [ ] Define biological analysis scope
- [ ] Confirm IBM required technology
- [ ] Define supported file formats
- [ ] Select demo dataset
- [ ] Define success criteria
- [ ] Define guest vs authenticated experience

Output:

```text
clear MVP specification
```

---

## Iteration 1 — Scientific Core

Goal:

> Membuktikan scientific computation bekerja dengan benar.

Build:

- [ ] FASTA parser
- [ ] sequence validation
- [ ] metadata extraction
- [ ] nucleotide composition
- [ ] GC content
- [ ] basic ORF detection
- [ ] translation
- [ ] unit testing

System:

```text
FASTA
↓
Biopython
↓
JSON result
```

No AI.

No database.

No frontend complexity.

---

## Iteration 2 — Bio Service API

Goal:

> Mengekspos scientific core sebagai reusable service.

Build:

- [ ] FastAPI application
- [ ] Pydantic schemas
- [ ] `/sequence/analyze`
- [ ] `/sequence/gc-content`
- [ ] `/sequence/orfs`
- [ ] `/sequence/translate`
- [ ] OpenAPI documentation
- [ ] integration tests

Output:

```text
Bio Service Container
```

---

## Iteration 3 — AI Agent Integration

Goal:

> Membuktikan Langflow Agent + IBM Granite dapat memahami task, memilih scientific tool, menjalankan analisis, dan menjelaskan hasilnya.

Build:

- [ ] Langflow setup
- [ ] IBM Granite connection through watsonx.ai
- [ ] Bio API registered as Langflow tools
- [ ] intent understanding
- [ ] analysis planning
- [ ] tool selection
- [ ] multi-step tool calling
- [ ] structured tool result handling
- [ ] scientific interpretation guardrails

Target demo:

```text
User:
"Find the longest ORF and translate it."

Granite understands task
↓
Langflow calls find_orfs
↓
Granite identifies the longest ORF
↓
Langflow calls translate_orf
↓
Granite explains the result
```

---

## Iteration 4 — Basic Frontend

Goal:

> User dapat menggunakan aplikasi dari browser.

Build:

- [ ] landing page
- [ ] FASTA uploader
- [ ] analysis loading state
- [ ] analysis dashboard
- [ ] nucleotide chart
- [ ] GC card
- [ ] ORF result
- [ ] AI interpretation
- [ ] chat interface

---

## Iteration 5 — Guest Mode

Goal:

> Aplikasi dapat digunakan tanpa authentication.

Build:

- [ ] IndexedDB setup
- [ ] save local analysis
- [ ] load local history
- [ ] delete local history
- [ ] guest session UX

Output:

```text
Guest
↓
Use Tool
↓
History Persisted Locally
```

---

## Iteration 6 — Application Backend

Goal:

> Menambahkan persistence dan project management dengan application layer yang ringan.

Build:

- [ ] ElysiaJS + Bun
- [ ] Drizzle ORM
- [ ] PostgreSQL
- [ ] MinIO / AIStor object storage
- [ ] S3-compatible storage client
- [ ] upload / presign API
- [ ] object metadata + object key persistence
- [ ] Project API
- [ ] Sequence metadata
- [ ] Analysis history
- [ ] Conversation persistence
- [ ] Redis integration
- [ ] BullMQ queue setup
- [ ] Analysis job lifecycle
- [ ] Worker concurrency limits
- [ ] Job retry / backoff
- [ ] Queue status API
- [ ] Langflow API integration

---

## Iteration 7 — Optional Authentication

Goal:

> Authentication menjadi value-add, bukan gatekeeper.

Build:

- [ ] register
- [ ] login
- [ ] auth middleware
- [ ] user ownership
- [ ] cloud history
- [ ] project persistence
- [ ] authenticated object storage access

---

## Iteration 8 — Guest Migration

Goal:

> Guest dapat membawa local history ke account.

Flow:

```text
Guest IndexedDB
↓
Register/Login
↓
Import Local Analyses
↓
ElysiaJS
↓
PostgreSQL
```

Build:

- [ ] guest import endpoint
- [ ] local/cloud duplicate handling
- [ ] migration confirmation UI
- [ ] migration tests

---

## Iteration 8.5 — BLAST and NCBI Integration

Goal:

> Membuktikan agent dapat melakukan similarity search dan mengambil annotation evidence dari NCBI / GenBank.

Build:

- [ ] BLASTN tool integration
- [ ] structured BLAST hit parser
- [ ] accession extraction
- [ ] NCBI / GenBank record retrieval tool
- [ ] tool result schemas
- [ ] Langflow multi-tool workflow test
- [ ] evidence-aware Granite prompt
- [ ] error / no-hit handling

Target demo:

```text
User uploads unknown DNA sequence
↓
Biopython analyzes locally
↓
Langflow calls BLASTN
↓
BLAST returns candidate accession
↓
Langflow retrieves GenBank record
↓
Granite explains the sequence using tool evidence
```

---

## Iteration 9 — UX and Reliability

Goal:

> Menjadikan MVP layak dipresentasikan.

Improve:

- [ ] error handling
- [ ] upload validation
- [ ] loading feedback
- [ ] responsive UI
- [ ] retry states
- [ ] empty states
- [ ] scientific disclaimer
- [ ] queue overflow handling
- [ ] concurrent guest request test
- [ ] worker timeout / retry test
- [ ] polished demo flow

---

## Iteration 10 — Deployment

Build:

```text
frontend container
application-api container (ElysiaJS + Bun)
bio-service container (FastAPI + Biopython)
langflow container
postgres container/service
redis container/service
bio/analysis worker container(s)
minio container/service
```

External AI provider:

```text
Langflow
↓
watsonx.ai API
↓
IBM Granite
```

Add:

- [ ] Docker Compose
- [ ] environment variables
- [ ] Langflow configuration
- [ ] watsonx.ai credentials
- [ ] API gateway / reverse proxy
- [ ] CI/CD
- [ ] deployment test
- [ ] MinIO / AIStor bucket configuration
- [ ] storage credentials via environment/secrets
- [ ] object storage healthcheck
- [ ] private bucket policy validation
- [ ] Redis configuration
- [ ] BullMQ worker deployment
- [ ] queue concurrency limits
- [ ] queue monitoring / healthcheck

---

## Iteration 11 — Hackathon Finalization

Focus:

```text
reliability
demo clarity
scientific credibility
agent behavior
storytelling
```

Deliver:

- [ ] MVP
- [ ] technical diagram
- [ ] documentation
- [ ] demo video
- [ ] business/product explanation
- [ ] final presentation

Do not add random features during this iteration.

---

## Iteration 12 — Future Scaling

Redis + BullMQ sudah menjadi bagian MVP karena guest access dapat menghasilkan concurrent jobs tanpa authentication. Future scaling berfokus pada peningkatan kapasitas dan reliability, bukan baru menambahkan queue.

Potential additions:

```text
multiple queue workers
separate Bio / BLAST / AI worker pools
Redis high availability / scaling
queue priority classes
distributed rate limiting
analysis result cache
large genome processing
job deduplication
automatic worker autoscaling
```

Trigger conditions:

```text
high concurrent usage
large queue depth
analysis takes several seconds or more
large genome processing
external API bottleneck
need for priority jobs
worker scaling
```


# Final MVP Definition

The project is considered technically successful when this basic flow works reliably:

```text
User uploads FASTA and gives a task
↓
ElysiaJS validates request + creates analysis job
↓
BullMQ queues the job in Redis
↓
Worker executes Langflow Agent + IBM Granite + scientific tools
↓
Biopython performs deterministic analysis
↓
Structured result returns to worker / Granite
↓
PostgreSQL stores durable analysis status + result
↓
Result is shown in frontend
↓
Guest history is stored locally
```

For similarity-based research workflow:

```text
Local sequence analysis
↓
BLAST similarity search
↓
BLAST hit + accession
↓
NCBI / GenBank record retrieval
↓
Granite combines local analysis + BLAST evidence + annotation
↓
Final research-oriented interpretation
```

For authenticated users:

```text
Login
↓
Project stored through ElysiaJS + Drizzle
↓
PostgreSQL
↓
MinIO / AIStor for research files
↓
History synchronized
```

At that point:

> **Stop expanding the feature list and improve reliability, UX, scientific credibility, and demo quality.**

---

# Final Project Pitch

> **Genomic Insight Agent is an AI-powered bioinformatics research assistant that combines deterministic biological computation with agentic reasoning to transform raw DNA sequences into understandable and actionable research insights.**
