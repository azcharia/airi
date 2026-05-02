# Airi — Discord AI Virtual Friend

Airi adalah bot Discord AI yang berkepribadian pemalu, pendiam, tapi manis. Proyek ini telah direfaktor sepenuhnya menggunakan **Node.js** dan memanfaatkan **Azure AI Foundry** sebagai penyedia model LLM utama.

## ✨ Fitur Utama

- **Persona Konsisten** — Pipeline pemrosesan teks memastikan output selalu lowercase, tanpa aksi roleplay, dan menggunakan elipsis (`...`) secara natural.
- **Short-Term Memory** — Menyimpan konteks percakapan terakhir (10 pesan) per pengguna dalam memori aplikasi.
- **Long-Term Memory** — Mengekstrak fakta permanen tentang pengguna (nama, preferensi, riwayat penting) dan menyimpannya di **Supabase (PostgreSQL)**.
- **Azure AI Integration** — Menggunakan model **Kimi-K2.5** (atau model lain yang kompatibel) melalui endpoint Azure AI Foundry untuk respons yang cepat dan cerdas.
- **Slash Commands** — `/memory` untuk melihat apa yang Airi ingat tentang Anda, dan `/reset` untuk menghapus semua data memori.

## 📁 Struktur Proyek

```text
airi/
├── src/
│   ├── index.js      # Logika bot utama & event handler Discord
│   ├── aiClient.js   # Wrapper API Azure OpenAI dengan retry logic
│   └── memory.js     # Manajemen memori (Short-term Map & Supabase LTM)
├── .env              # Konfigurasi environment (JANGAN commit!)
├── Dockerfile        # Konfigurasi containerization (Node.js 18)
├── package.json      # Dependensi Node.js
└── schema.sql        # Skema database untuk Supabase
```

## 🚀 Setup Lokal

### 1. Instalasi Dependensi
Pastikan Anda memiliki [Node.js](https://nodejs.org/) versi 18 atau lebih baru.
```bash
npm install
```

### 2. Konfigurasi Database (Supabase)
Jalankan perintah SQL yang ada di `schema.sql` pada SQL Editor di dashboard Supabase Anda untuk menyiapkan tabel `users`.

### 3. Konfigurasi Environment
Buat file `.env` berdasarkan `.env.example` dan lengkapi nilai-nilainya:
```env
DISCORD_TOKEN=token_bot_anda
AZURE_API_KEY=key_azure_ai_anda
AZURE_ENDPOINT=https://your-resource.services.ai.azure.com/openai/v1/
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_service_role_key
```

### 4. Jalankan Bot
```bash
npm start
```

## 🐳 Docker Deployment
Bot ini siap untuk dideploy menggunakan Docker:
```bash
docker build -t airi-bot .
docker run --env-file .env airi-bot
```

## 🛠 Tech Stack
- **Runtime**: Node.js 18+
- **Library**: `discord.js`, `openai`, `@supabase/supabase-js`
- **AI Model**: Kimi-K2.5 via Azure AI Foundry
- **Database**: Supabase (PostgreSQL)
- **Hosting**: Azure / Render (Container based)
