<div align="center">

# 🎙️ Briefly — Meeting Muse

**AI-powered browser extension to record, transcribe, and summarize your meetings — right inside Chrome.**

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Gemini AI](https://img.shields.io/badge/Google%20Gemini-API-8E75B2?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

[Features](#-features) • [Tech Stack](#-tech-stack) • [Getting Started](#-getting-started) • [API Reference](#-api-reference) • [Contributing](#-contributing) • [Team](#-team)

</div>

---

## 📸 Overview

Briefly is a full-stack Chrome browser extension that silently records your meetings on Google Meet, Microsoft Teams, and YouTube, then uses Google's **Gemini 1.5** AI to produce accurate transcriptions, intelligent summaries, speaker accountability reports, Jira-ready action items, and more — all in a sleek, dark-mode Side Panel.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎙️ **Audio Recording** | Captures tab audio via Chrome's `tabCapture` API — no system muting |
| 🤖 **AI Transcription** | Powered by Google Gemini 1.5 Flash & Pro for accurate, fast results |
| 📋 **Smart Summaries** | Auto-generated meeting summaries with key decisions and action items |
| 👥 **Speaker Accountability** | Tracks participant names and highlights their key statements |
| 🔄 **Resilient API Calls** | Exponential backoff + multi-model fallback to handle rate limits gracefully |
| 📊 **Mermaid Diagrams** | AI-generated visual flowcharts from your meeting content |
| 🌍 **Multi-language** | Summaries and Jira tickets respect the user's selected language |
| 🕘 **Meeting History** | Browse and revisit all past meeting summaries in the dashboard |
| 💬 **Global Chat** | Chat with your meeting data using a persistent AI assistant |
| 🗓️ **Calendar Integration** | Manage your schedule from the side panel |
| 🎨 **Premium Dark UI** | Cohesive dark-mode interface with SVG icons and smooth animations |

---

## 💻 Tech Stack

### 🧩 Frontend — Chrome Extension (Manifest V3)
- **HTML5 & CSS3** — Custom CSS variables, premium dark-mode design system
- **Vanilla JavaScript** — DOM manipulation, event handling, extension logic
- **Chrome Extension APIs**:
  - `chrome.sidePanel` — Main UI panel
  - `chrome.tabCapture` — Tab audio recording
  - `chrome.storage.local` — Local data persistence
  - `chrome.runtime` / Service Workers — Background task management
- **Web Audio API** — `AudioContext` for audio stream routing and processing

### ⚙️ Backend — Python API
- **FastAPI** — High-performance async REST API framework
- **Uvicorn** — ASGI server
- **Pydantic** — Data validation and settings management
- **Python 3.10+** — Core backend language

### 🤖 AI & Integrations
- **Google Gemini API** — `gemini-1.5-flash` (primary) and `gemini-1.5-pro` (fallback)
- **google-genai SDK** — Official Python SDK for Gemini

---

## 🚀 Getting Started

### Prerequisites

- **Google Chrome** (latest version)
- **Python 3.10+**
- **Git**
- A **Google Gemini API key** → [Get one free here](https://aistudio.google.com/app/apikey)

---

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/briefly-meeting-muse.git
cd briefly-meeting-muse
```

---

### 2. Set Up the Backend

```bash
cd briefly-api

# Create and activate a virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt
```

#### Configure Environment Variables

Create a `.env` file inside `briefly-api/`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

> ⚠️ Never commit your `.env` file. It is already listed in `.gitignore`.

#### Start the API Server

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

---

### 3. Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **"Load unpacked"**
4. Select the `briefly-ext/` folder
5. The Briefly icon will appear in your Chrome toolbar
6. Click it → **"Open Side Panel"** to launch the UI

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/transcribe` | Upload audio file → returns transcription + summary |
| `GET` | `/health` | Health check |

### Example Request

```bash
curl -X POST "http://localhost:8000/transcribe" \
  -H "accept: application/json" \
  -F "file=@meeting_audio.webm;type=audio/webm"
```

---

## 🗂️ Project Structure

```
briefly-meeting-muse/
├── briefly-ext/            # Chrome Extension (Frontend)
│   ├── manifest.json       # Extension configuration (Manifest V3)
│   ├── background.js       # Service worker — audio capture & messaging
│   ├── sidepanel.html      # Main UI layout
│   ├── sidepanel.js        # UI logic, state management
│   ├── content_script.js   # Injected into Google Meet to detect speakers
│   └── styles/             # CSS design system
│
├── briefly-api/            # Python Backend (FastAPI)
│   ├── main.py             # FastAPI app & route definitions
│   ├── requirements.txt    # Python dependencies
│   └── .env                # 🔒 Local secrets (not committed)
│
└── README.md
```

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Commit your changes** using conventional commits:
   ```bash
   git commit -m "feat: add speaker timeline view"
   ```
4. **Push** your branch:
   ```bash
   git push origin feature/your-feature-name
   ```
5. **Open a Pull Request** on GitHub with a clear description

### Commit Convention

| Prefix | When to use |
|--------|-------------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation update |
| `style:` | Formatting, no logic change |
| `refactor:` | Code restructure |
| `chore:` | Build, dependencies |

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 👥 Team

Built with ❤️ for the **Meeting Muse Hackathon 2026**

| Name | Role | GitHub |
|------|------|--------|
| Sanjay | Full-Stack Developer | [@YourGitHub](https://github.com/) |
| *(Add teammates)* | *(Role)* | *(Link)* |

---

<div align="center">

**⭐ If you found this useful, please star the repo!**

Made with [Google Gemini](https://ai.google.dev/) · [FastAPI](https://fastapi.tiangolo.com/) · [Chrome Extensions](https://developer.chrome.com/docs/extensions/)

</div>
