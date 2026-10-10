# 👁️ Gemini Computer Use - Visual Playground & Operator

[![Gemini API](https://img.shields.io/badge/Gemini_API-Multimodal_Computer_Use-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium_Engine-45ba4b?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Python](https://img.shields.io/badge/Python-3.12-blue?logo=python&logoColor=white)](https://python.org)
[![Express](https://img.shields.io/badge/Express-Glassmorphic_Dashboard-black?logo=express&logoColor=white)](https://expressjs.com)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A state-of-the-art developer playground, visualizer, and diagnostics console for Google's **Gemini Multimodal Computer Use API** (version `google-genai>=2.7.0`). Built and maintained by **Omniverso Digital**.

---

## Key Features

1. **Live Agent Mode:**
   - Spawns a real Gemini 3.5 Flash model interaction loop using the `interactions` API.
   - Operates a headless Chromium browser instance in Playwright (1024x768 viewport).
   - Feeds screenshots dynamically to the model.
   - Interprets returned `function_call` tool requests (`left_click`, `type`, `scroll`, etc.) and executes them locally in Playwright.

2. **Visual Playground (Simulation) Mode:**
   - Allows immediate testing of the playground UI and diagnostics visualizer without needing an active Gemini API Key.
   - Steps through realistic browser automation scenarios (e.g. Wikipedia researches, flight lookups, Google searches).
   - Operates a real headless browser session to capture actual screenshots of page transitions, overlaying animated mouse cursors and clicks.

3. **Sleek Visual Diagnostics Dashboard:**
   - **Address Bar & Viewport:** Renders the page screenshots. Shows simulated cursor pointer coordinates and mouse click pulses in real-time.
   - **System Logs Console:** Real-time log streaming from the underlying agent sub-process.
   - **Timeline accordion:** Step-by-step breakdown of actions taken (clicks, typing, scrollings). Clicking any card navigates the viewport image and mouse coordinates to that step's state.
   - **Run History Log:** Persistent run details. Allows clicking past runs to examine their reports, console history, timeline steps, and coordinates.

---

## Installation & Setup

### Prerequisites
- Node.js (version 18 or higher)
- Python (version 3.10 or higher)

### Setup Instructions

1. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

2. **Initialize Python Virtual Environment:**
   Create a python virtual environment named `.venv` in the project root:
   ```bash
   python -m venv .venv
   ```

3. **Install Python dependencies:**
   Activate your virtual environment and run:
   ```bash
   .venv\Scripts\pip install -r requirements.txt
   ```
   Or on macOS/Linux:
   ```bash
   .venv/bin/pip install -r requirements.txt
   ```

4. **Install Playwright Browsers:**
   Ensure Playwright's chromium browser binaries are installed:
   ```bash
   .venv\Scripts\playwright install chromium
   ```
   Or on macOS/Linux:
   ```bash
   .venv/bin/playwright install chromium
   ```

5. **Start the server:**
   ```bash
   npm start
   ```
   The visualizer dashboard will boot and listen at **`http://localhost:3010`**.

---

## Architecture Details

- **Backend:** `server.js` serves the static assets (the UI) and exposes `/api/stream-run` SSE endpoint. When triggered, it spawns `agent.py` as a subprocess and streams real-time console logs and steps back.
- **Agent Loop:** `agent.py` implements the Look-Think-Act loop. Each step consists of `page.screenshot()`, sending the image to Gemini (via `google-genai`), reading the recommended `function_call`, executing the event, and outputting step JSON details to standard output.
- **Frontend Visualizer:** `public/app.js` listens to EventSource streams, recalculates coordinate offsets to overlay the custom cursor on the captured screenshots, and builds the timeline accordion.
