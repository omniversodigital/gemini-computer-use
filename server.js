import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3010;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const RUNS_DIR = path.join(__dirname, 'public', 'runs');
const HISTORY_FILE = path.join(__dirname, 'history.json');

// Ensure directories exist
if (!fs.existsSync(RUNS_DIR)) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

// Validate runId to prevent path traversals (CWE-22)
const validateRunId = (runId) => {
  return typeof runId === 'string' && /^[a-zA-Z0-9_-]+$/.test(runId);
};

// Temp store for run parameters to avoid exposing keys in query strings (CWE-598)
const runParamsStore = new Map();

// Read run history (Asynchronous non-blocking)
const getHistory = async () => {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    const data = await fs.promises.readFile(HISTORY_FILE, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading history:', err);
    return [];
  }
};

// Save run history (Asynchronous non-blocking)
const saveHistory = async (history) => {
  try {
    await fs.promises.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('Error writing history:', err);
  }
};

// Active processes map to allow cancellation
const activeProcesses = new Map();

// Endpoint to list history
app.get('/api/history', async (req, res) => {
  const history = await getHistory();
  res.json(history);
});

// Endpoint to delete history
app.delete('/api/history', async (req, res) => {
  await saveHistory([]);
  // Also clean runs folder
  try {
    fs.rmSync(RUNS_DIR, { recursive: true, force: true });
    fs.mkdirSync(RUNS_DIR, { recursive: true });
  } catch (e) {
    console.error(e);
  }
  res.json({ success: true });
});

// Endpoint to abort an active run
app.post('/api/abort', (req, res) => {
  const { runId } = req.body;
  if (!validateRunId(runId)) {
    return res.status(400).json({ success: false, error: 'Invalid runId format.' });
  }
  if (activeProcesses.has(runId)) {
    const child = activeProcesses.get(runId);
    try {
      child.kill();
      activeProcesses.delete(runId);
      console.log(`Run ${runId} was aborted by user request.`);
      return res.json({ success: true, message: 'Process aborted successfully' });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }
  res.status(404).json({ success: false, error: 'No active process found for this run ID' });
});

// Endpoint to check system status
app.get('/api/status', (req, res) => {
  const hasApiKey = !!process.env.GEMINI_API_KEY;
  const venvPythonWin = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
  const venvPythonUnix = path.join(__dirname, '.venv', 'bin', 'python');
  const pythonConfigured = fs.existsSync(venvPythonWin) || fs.existsSync(venvPythonUnix);
  
  res.json({
    status: 'ONLINE',
    python: pythonConfigured ? 'READY' : 'MISSING',
    playwright: pythonConfigured ? 'READY' : 'MISSING',
    apiKey: hasApiKey ? 'CONFIGURED' : 'NOT_CONFIGURED'
  });
});

// Endpoint to initialize a secure run session to avoid query parameter leakage (CWE-598)
app.post('/api/run', (req, res) => {
  const { runId, task, url, sim, apiKey } = req.body;
  if (!runId || !task) {
    return res.status(400).json({ success: false, error: 'runId and task are required.' });
  }
  if (!validateRunId(runId)) {
    return res.status(400).json({ success: false, error: 'Invalid runId format.' });
  }
  runParamsStore.set(runId, { task, url, sim: String(sim), apiKey });
  res.json({ success: true });
});

// Server-Sent Events (SSE) streaming endpoint for live execution
app.get('/api/stream-run', (req, res) => {
  const { runId } = req.query;

  if (!runId || !validateRunId(runId)) {
    res.status(400).write('Invalid or missing runId query parameter.');
    res.end();
    return;
  }

  const params = runParamsStore.get(runId);
  if (!params) {
    res.status(404).write('Run parameters not found. Initialize via POST /api/run first.');
    res.end();
    return;
  }

  const { task, url, sim, apiKey } = params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Find python executable in the local virtual environment if present
  let pythonPath = 'python';
  const venvPythonWin = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
  const venvPythonUnix = path.join(__dirname, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPythonWin)) {
    pythonPath = venvPythonWin;
  } else if (fs.existsSync(venvPythonUnix)) {
    pythonPath = venvPythonUnix;
  }

  const args = [
    'agent.py',
    '--task', task,
    '--run-id', runId,
    '--url', url || 'https://www.google.com'
  ];

  if (sim === 'true') {
    args.push('--sim');
  } else if (apiKey) {
    args.push('--api-key', apiKey);
  }

  console.log(`[Server] Spawning: ${pythonPath} ${args.join(' ')}`);

  const child = spawn(pythonPath, args, {
    cwd: __dirname,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  });

  activeProcesses.set(runId, child);

  let logs = '';
  let steps = [];
  let finalResult = null;

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'step') {
          steps.push(parsed);
          sendEvent('step', parsed);
        } else if (parsed.type === 'info') {
          sendEvent('log', { text: parsed.message });
          logs += `[INFO] ${parsed.message}\n`;
        } else if (parsed.type === 'result') {
          finalResult = parsed;
          sendEvent('result', parsed);
        } else if (parsed.type === 'error') {
          sendEvent('log', { text: `[ERROR] ${parsed.message}`, error: true });
          logs += `[ERROR] ${parsed.message}\n`;
        }
      } catch (err) {
        // Not JSON, treat as raw log line
        sendEvent('log', { text: line });
        logs += `${line}\n`;
      }
    }
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    sendEvent('log', { text: text, error: true });
    logs += `[STDERR] ${text}`;
  });

  child.on('close', async (code) => {
    activeProcesses.delete(runId);
    runParamsStore.delete(runId);
    const success = code === 0 && (!finalResult || finalResult.status === 'success');
    
    // Create history entry
    const historyEntry = {
      runId,
      timestamp: new Date().toISOString(),
      task,
      startUrl: url || 'https://www.google.com',
      isSimulation: sim === 'true',
      success,
      stepsCount: steps.length,
      finalReport: finalResult ? finalResult.report : 'No report compiled.',
      steps: steps,
      logs: logs
    };

    const history = await getHistory();
    history.unshift(historyEntry);
    await saveHistory(history);

    sendEvent('done', { success, runId, code });
    res.end();
  });

  req.on('close', () => {
    runParamsStore.delete(runId);
    if (activeProcesses.has(runId)) {
      console.log(`Client disconnected. Killing process for run ID: ${runId}`);
      try {
        child.kill();
      } catch (_) {}
      activeProcesses.delete(runId);
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Gemini Computer Use visualizer running at http://localhost:${PORT}`);
});
