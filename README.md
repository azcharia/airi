# Airi — Discord AI Virtual Friend

Airi adalah bot Discord AI yang berkepribadian pemalu, pendiam, tapi manis. Dibangun dengan Python, `discord.py`, dan Cerebras Cloud API.

## Fitur

- **Persona Konsisten** — Post-processing pipeline memastikan output selalu lowercase, tanpa roleplay actions, dan hanya menggunakan elipsis secukupnya.
- **Short-Term Memory** — Menyimpan 10 pesan terakhir per user sebagai konteks percakapan (in-process deque).
- **Long-Term Memory** — Mengekstrak fakta permanen tentang user (nama, hobi, dll.) menggunakan AI model kecil dan menyimpannya di **Supabase (PostgreSQL)** — tidak hilang saat Render restart.
- **Slash Commands** — `/memory` untuk melihat fakta yang diingat, `/reset` untuk menghapus semua memori.
- **Keep-Alive** — Flask web server ringan agar Render.com tidak mematikan service.

## Struktur File

```
airi/
├── .env                  # Environment variables (JANGAN commit!)
├── .env.example          # Template environment variables
├── .gitignore
├── requirements.txt
├── keep_alive.py         # Flask dummy server (port 8080)
├── memory.py             # Short-term (deque) & Long-term (Supabase) memory
├── cerebras_client.py    # Async Cerebras API wrapper + retry logic
├── main.py               # Bot utama: routing, pipeline, commands
├── start.sh              # Script deployment untuk Render
└── README.md
```

## Setup Lokal

### 1. Clone & Install

```bash
git clone <repo-url> airi
cd airi
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Setup Supabase (Database)

> Wajib dilakukan **sekali** sebelum menjalankan bot.

1. Buat akun dan project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor** di dashboard Supabase.
3. Jalankan query berikut:

```sql
-- Buat tabel users untuk menyimpan fakta user
create table if not exists public.users (
    user_id       text        primary key,
    facts         jsonb       not null default '[]'::jsonb,
    message_count integer     not null default 0,
    last_updated  timestamptz          default now()
);

-- Aktifkan Row Level Security
alter table public.users enable row level security;

-- Izinkan akses penuh untuk service role
create policy "service role full access"
    on public.users
    for all
    using (true)
    with check (true);
```

4. Ambil kredensial dari **Project Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key (bukan `anon`) → `SUPABASE_KEY` _(gunakan service_role untuk write access penuh)_

### 3. Konfigurasi `.env`

Salin `.env.example` menjadi `.env` dan isi semua nilai:

```
DISCORD_TOKEN=your_discord_bot_token
CEREBRAS_API_KEY=your_cerebras_chat_api_key
CEREBRAS_EXTRACTOR_API_KEY=your_cerebras_extractor_api_key
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your_supabase_service_role_key
FLASK_PORT=8080
```

### 4. Jalankan

```bash
python main.py
```

## Deploy ke Render.com

### 1. Push ke GitHub

Pastikan semua file (kecuali `.env`) sudah di-push ke repository GitHub.

### 2. Buat Web Service di Render

1. Login ke [render.com](https://render.com).
2. Klik **New → Web Service**.
3. Connect repository GitHub kamu.
4. Konfigurasi:
   - **Name**: `airi-bot`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python main.py`
   - **Instance Type**: `Free`
5. Tambahkan **Environment Variables**:
   - `DISCORD_TOKEN` = token bot Discord
   - `CEREBRAS_API_KEY` = API key Cerebras untuk chat model
   - `CEREBRAS_EXTRACTOR_API_KEY` = API key Cerebras untuk extractor model
   - `SUPABASE_URL` = URL project Supabase
   - `SUPABASE_KEY` = service_role key Supabase
   - `FLASK_PORT` = `8080`
6. Klik **Create Web Service**.

### 3. Anti-Sleep dengan Cron-Job

Service gratis di Render akan sleep setelah 15 menit tanpa traffic. Untuk menjaganya tetap aktif:

1. Buka [cron-job.org](https://cron-job.org) dan buat akun gratis.
2. Buat cron job baru:
   - **URL**: `https://airi-bot.onrender.com/health` (sesuaikan dengan URL Render kamu)
   - **Schedule**: Every **10 minutes** (`*/10 * * * *`)
   - **Method**: `GET`
3. Aktifkan cron job.

Dengan ini, Render akan menerima ping setiap 10 menit dan service tidak akan sleep.

## Discord Bot Setup

1. Buka [Discord Developer Portal](https://discord.com/developers/applications).
2. Buat application baru atau pilih yang sudah ada.
3. Di tab **Bot**:
   - Aktifkan **Message Content Intent**.
   - Aktifkan **Server Members Intent** (opsional).
4. Di tab **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Use Slash Commands`
5. Gunakan URL yang di-generate untuk invite bot ke server kamu.

## Cara Menggunakan

- **Mention Airi** di server: `@Airi halo apa kabar?`
- **DM Airi** langsung untuk chat pribadi.
- **`/memory`** — Lihat fakta yang Airi ingat tentang kamu.
- **`/reset`** — Hapus semua memori Airi tentang kamu.

## Tech Stack

| Komponen | Teknologi |
|----------|-----------|
| Bahasa | Python 3.10+ |
| Discord Library | discord.py 2.3+ |
| AI Model (Chat) | Cerebras `gpt-oss-120b` (fallback: `llama3.1-70b-versatile`) |
| AI Model (Memory) | Cerebras `llama3.1-8b-instant` |
| Database | Supabase (PostgreSQL) |
| Keep-Alive | Flask |
| Deployment | Render.com + cron-job.org |
