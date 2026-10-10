// UI Elements
const form = document.getElementById('agent-form');
const apiKeyInput = document.getElementById('api-key');
const toggleKeyBtn = document.getElementById('toggle-key-visibility');
const startUrlInput = document.getElementById('start-url');
const taskInput = document.getElementById('task-input');
const simModeCheckbox = document.getElementById('sim-mode');
const runBtn = document.getElementById('run-btn');
const abortBtn = document.getElementById('abort-btn');
const btnText = runBtn.querySelector('.btn-text');
const btnSpinner = runBtn.querySelector('.btn-spinner');

// Viewport Elements
const viewportImage = document.getElementById('viewport-image');
const viewportUrl = document.getElementById('viewport-url');
const mouseCursor = document.getElementById('mouse-cursor');
const canvasContainer = document.getElementById('canvas-container');

// Stats Elements
const liveStatsPanel = document.getElementById('live-stats');
const statSteps = document.getElementById('stat-steps');
const statTime = document.getElementById('stat-time');
const statStatus = document.getElementById('stat-status');

// Output/Timeline Panels
const timelineList = document.getElementById('timeline-list');
const reportBox = document.getElementById('report-box');
const reportContent = document.getElementById('report-content');
const consoleOutput = document.getElementById('console-output');
const clearConsoleBtn = document.getElementById('clear-console-btn');

// History Elements
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');

// App State
let currentRunId = null;
let eventSource = null;
let startTime = null;
let timerInterval = null;
let activeRunSteps = [];

// Local Storage Key Management
const LOCAL_STORAGE_KEY = 'gemini_computer_use_key';

// Load stored API Key on init
if (localStorage.getItem(LOCAL_STORAGE_KEY)) {
  apiKeyInput.value = localStorage.getItem(LOCAL_STORAGE_KEY);
}

// Toggle Visibility of API Key Input
toggleKeyBtn.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleKeyBtn.textContent = '🔒';
  } else {
    apiKeyInput.type = 'password';
    toggleKeyBtn.textContent = '👁️';
  }
});

// Save API key on change
apiKeyInput.addEventListener('input', () => {
  localStorage.setItem(LOCAL_STORAGE_KEY, apiKeyInput.value.trim());
});

// Clear Console Helper
clearConsoleBtn.addEventListener('click', () => {
  consoleOutput.innerHTML = '<span class="sys-msg">[System] Console cleared.</span>';
});

// Spawns/Appends Logs to Console
function appendLog(text, isError = false) {
  const line = document.createElement('span');
  line.className = isError ? 'log-err' : 'log-line';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// Format Date string
function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString();
}

// Move Simulated Mouse Cursor on Viewport
function moveCursor(x, y, actionType) {
  if (!x || !y) return;
  
  // Viewport display aspect ratio scaling
  const rect = canvasContainer.getBoundingClientRect();
  
  // Coordinates are relative to 1024x768 resolution
  const percentX = (x / 1024) * 100;
  const percentY = (y / 768) * 100;
  
  mouseCursor.classList.remove('hidden');
  mouseCursor.style.left = `${percentX}%`;
  mouseCursor.style.top = `${percentY}%`;
  
  // Animate click pulse
  if (actionType === 'click' || actionType === 'type') {
    const pulse = mouseCursor.querySelector('.click-pulse');
    pulse.classList.remove('animate');
    // Trigger redraw
    void pulse.offsetWidth;
    pulse.classList.add('animate');
  }
}

// Build timeline cards from step events
function addTimelineStep(step) {
  const card = document.createElement('div');
  card.className = 'step-card';
  card.dataset.index = step.step;
  
  const stepNum = document.createElement('div');
  stepNum.className = 'step-badge';
  stepNum.textContent = step.step;
  
  const stepMeta = document.createElement('div');
  stepMeta.className = 'step-meta';
  
  const title = document.createElement('div');
  title.className = 'step-title';
  title.textContent = step.action ? `Action: ${step.action.toUpperCase()}` : 'Observation';
  
  const desc = document.createElement('div');
  desc.className = 'step-desc';
  desc.textContent = step.explanation || 'Examining environment screenshots';
  
  stepMeta.appendChild(title);
  stepMeta.appendChild(desc);
  
  const tag = document.createElement('div');
  tag.className = `step-action-tag ${step.action || 'view'}`;
  tag.textContent = step.action || 'observe';
  
  card.appendChild(stepNum);
  card.appendChild(stepMeta);
  card.appendChild(tag);
  
  // Interactive click to show this step's screenshot
  card.addEventListener('click', () => {
    // Clear active class from all steps
    document.querySelectorAll('.step-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    
    // Load screenshot in viewport
    viewportImage.src = step.screenshot;
    
    // Position cursor for this step if coordinates are available
    if (step.coords) {
      moveCursor(step.coords[0], step.coords[1], step.action);
    } else {
      mouseCursor.classList.add('hidden');
    }
  });
  
  timelineList.appendChild(card);
  
  // Make newly added step card active by default during run
  document.querySelectorAll('.step-card').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
  viewportImage.src = step.screenshot;
  
  if (step.coords) {
    moveCursor(step.coords[0], step.coords[1], step.action);
  } else {
    mouseCursor.classList.add('hidden');
  }
  
  timelineList.scrollTop = timelineList.scrollHeight;
}

// Start Timer Helper
function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    statTime.textContent = `${elapsed}s`;
  }, 1000);
}

// Stop Timer Helper
function stopTimer() {
  clearInterval(timerInterval);
}

// Fetch Execution History Log
async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    
    historyList.innerHTML = '';
    if (data.length === 0) {
      historyList.innerHTML = '<div class="empty-timeline">No past sessions indexed.</div>';
      return;
    }
    
    data.forEach(run => {
      const item = document.createElement('div');
      item.className = 'history-item';
      
      const header = document.createElement('div');
      header.className = 'history-item-header';
      
      const timeSpan = document.createElement('span');
      timeSpan.className = 'history-time';
      timeSpan.textContent = formatDate(run.timestamp);
      
      const statusBadge = document.createElement('span');
      statusBadge.className = `history-status-badge ${run.success ? 'success' : 'failed'}`;
      statusBadge.textContent = run.success ? 'SUCCESS' : 'FAILED';
      
      header.appendChild(timeSpan);
      header.appendChild(statusBadge);
      
      const taskDiv = document.createElement('div');
      taskDiv.className = 'history-task';
      taskDiv.textContent = run.task;
      
      const meta = document.createElement('div');
      meta.className = 'history-meta';
      meta.innerHTML = `
        <span>${run.isSimulation ? '🤖 Simulation' : '⚡ Live Agent'}</span>
        <span>Steps: ${run.stepsCount}</span>
      `;
      
      item.appendChild(header);
      item.appendChild(taskDiv);
      item.appendChild(meta);
      
      // Load historical run data on click
      item.addEventListener('click', () => {
        loadHistoricalRun(run);
      });
      
      historyList.appendChild(item);
    });
  } catch (err) {
    console.error('Error fetching history:', err);
  }
}

// Load detail of selected historical run
function loadHistoricalRun(run) {
  appendLog(`[System] Loading historical run: ${run.runId}`);
  
  // Set Url and Address Bar
  viewportUrl.textContent = run.startUrl;
  
  // Clear Active States
  liveStatsPanel.classList.remove('hidden');
  statSteps.textContent = run.stepsCount;
  statTime.textContent = '--';
  statStatus.textContent = 'Completed (Historical)';
  
  // Clear and Populate Timeline
  timelineList.innerHTML = '';
  if (run.steps && run.steps.length > 0) {
    run.steps.forEach(addTimelineStep);
    
    // Select first step
    const firstStepCard = timelineList.querySelector('.step-card');
    if (firstStepCard) firstStepCard.click();
  } else {
    timelineList.innerHTML = '<div class="empty-timeline">No step details found in historical record.</div>';
    viewportImage.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='768' viewBox='0 0 1024 768'><rect width='100%' height='100%' fill='%23181824'/><text x='50%' y='50%' font-family='sans-serif' font-size='22' fill='%23555577' text-anchor='middle'>No viewport capture available for this run</text></svg>";
    mouseCursor.classList.add('hidden');
  }
  
  // Render report
  if (run.finalReport) {
    reportBox.classList.remove('hidden');
    // Basic Markdown formatting helper
    reportContent.innerHTML = run.finalReport
      .replace(/### (.*)/g, '<h3>$1</h3>')
      .replace(/\n- (.*)/g, '<br>• $1')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  } else {
    reportBox.classList.add('hidden');
  }
  
  // Load logs to terminal
  consoleOutput.innerHTML = '';
  const lines = run.logs.split('\n');
  lines.forEach(l => {
    if (!l.trim()) return;
    const span = document.createElement('span');
    span.className = l.startsWith('[ERROR]') ? 'log-err' : 'sys-msg';
    span.textContent = l;
    consoleOutput.appendChild(span);
  });
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// Clear Session History Handler
clearHistoryBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to permanently delete all run history?')) {
    try {
      const res = await fetch('/api/history', { method: 'DELETE' });
      if (res.ok) {
        appendLog('[System] Execution history deleted.');
        loadHistory();
        timelineList.innerHTML = '<div class="empty-timeline">No agent steps recorded yet.</div>';
        reportBox.classList.add('hidden');
        liveStatsPanel.classList.add('hidden');
      }
    } catch (err) {
      appendLog('[System] Error clearing history.', true);
    }
  }
});

// Abort Action Handler
abortBtn.addEventListener('click', async () => {
  if (!currentRunId) return;
  
  appendLog('[System] Sending cancellation command...');
  try {
    const res = await fetch('/api/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: currentRunId })
    });
    
    if (res.ok) {
      appendLog('[System] Agent execution aborted successfully.');
    } else {
      appendLog('[System] Failed to abort agent. Process may have already completed.', true);
    }
  } catch (err) {
    appendLog('[System] Error communicating abort request.', true);
  }
});

// Form Submission & SSE Spawner
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const apiKey = apiKeyInput.value.trim();
  const startUrl = startUrlInput.value.trim();
  const task = taskInput.value.trim();
  const isSim = simModeCheckbox.checked;
  
  if (!isSim && !apiKey) {
    alert('Please enter a valid Gemini API Key to run in Live Mode, or select "Playground Mode (Simulation)"');
    return;
  }
  
  // Set UI running state
  runBtn.disabled = true;
  btnText.textContent = 'RUNNING AGENT...';
  btnSpinner.classList.remove('hidden');
  abortBtn.classList.remove('hidden');
  
  // Reset outputs
  timelineList.innerHTML = '';
  reportBox.classList.add('hidden');
  consoleOutput.innerHTML = '<span class="sys-msg">[System] Initializing secure agent session...</span>';
  
  currentRunId = `run_${Date.now()}`;
  activeRunSteps = [];
  viewportUrl.textContent = startUrl;
  
  // Enable Stats Panel
  liveStatsPanel.classList.remove('hidden');
  statSteps.textContent = '0';
  statStatus.textContent = 'Booting...';
  
  startTimer();
  
  try {
    // Send sensitive parameters securely via HTTP POST
    const initRes = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: currentRunId,
        task,
        url: startUrl,
        sim: isSim,
        apiKey
      })
    });
    
    if (!initRes.ok) {
      const errData = await initRes.json();
      throw new Error(errData.error || 'Failed to initialize session.');
    }
    
    appendLog('[System] Secure session initialized. Establishing stream...');
    
    // Connect to SSE stream (without passing the sensitive key in the URL)
    const sseUrl = `/api/stream-run?runId=${currentRunId}`;
    
    eventSource = new EventSource(sseUrl);
    
    eventSource.addEventListener('log', (event) => {
      const data = JSON.parse(event.data);
      appendLog(data.text, data.error);
      if (statStatus.textContent === 'Booting...') {
        statStatus.textContent = 'Running';
      }
    });
    
    eventSource.addEventListener('step', (event) => {
      const stepData = JSON.parse(event.data);
      activeRunSteps.push(stepData);
      statSteps.textContent = activeRunSteps.length;
      addTimelineStep(stepData);
      
      // Address bar url updates if screenshot was navigated
      if (stepData.action === 'navigate' && stepData.text) {
        viewportUrl.textContent = stepData.text;
      }
    });
    
    eventSource.addEventListener('result', (event) => {
      const resultData = JSON.parse(event.data);
      reportBox.classList.remove('hidden');
      // Format report
      reportContent.innerHTML = resultData.report
        .replace(/### (.*)/g, '<h3>$1</h3>')
        .replace(/\n- (.*)/g, '<br>• $1')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    });
    
    eventSource.addEventListener('done', (event) => {
      const doneData = JSON.parse(event.data);
      stopTimer();
      
      appendLog(`[System] Execution finished. Code: ${doneData.code}`);
      statStatus.textContent = doneData.success ? 'SUCCESS' : 'FINISHED (WARN)';
      
      // Reset Run Buttons
      runBtn.disabled = false;
      btnText.textContent = 'DEPLOY AGENT CYCLE';
      btnSpinner.classList.add('hidden');
      abortBtn.classList.add('hidden');
      
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      
      loadHistory();
    });
    
    eventSource.onerror = (err) => {
      stopTimer();
      appendLog('[System] EventSource connection encountered an error. Agent aborted.', true);
      statStatus.textContent = 'ERROR';
      
      runBtn.disabled = false;
      btnText.textContent = 'DEPLOY AGENT CYCLE';
      btnSpinner.classList.add('hidden');
      abortBtn.classList.add('hidden');
      
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      
      loadHistory();
    };
  } catch (err) {
    stopTimer();
    appendLog(`[System] Error: ${err.message}`, true);
    statStatus.textContent = 'INIT_FAIL';
    
    runBtn.disabled = false;
    btnText.textContent = 'DEPLOY AGENT CYCLE';
    btnSpinner.classList.add('hidden');
    abortBtn.classList.add('hidden');
    loadHistory();
  }
});

// Viewport Inspector Event Handlers
const inspectCoordsHover = document.getElementById('inspect-coords-hover');
const inspectCoordsClick = document.getElementById('inspect-coords-click');
const inspectCopyVal = document.getElementById('inspect-copy-val');
const inspectCopyBtn = document.getElementById('inspect-copy-btn');
const inspectorTargetDot = document.getElementById('inspector-target-dot');

viewportImage.addEventListener('mousemove', (e) => {
  const rect = viewportImage.getBoundingClientRect();
  
  // Scale local hover coordinate relative to native resolution (1024x768)
  const x = Math.round(((e.clientX - rect.left) / rect.width) * 1024);
  const y = Math.round(((e.clientY - rect.top) / rect.height) * 768);
  
  const clampX = Math.max(0, Math.min(1024, x));
  const clampY = Math.max(0, Math.min(768, y));
  
  inspectCoordsHover.textContent = `Hover: (${clampX}, ${clampY})`;
});

viewportImage.addEventListener('mouseleave', () => {
  inspectCoordsHover.textContent = 'Hover: (--, --)';
});

viewportImage.addEventListener('click', (e) => {
  const rect = viewportImage.getBoundingClientRect();
  const x = Math.round(((e.clientX - rect.left) / rect.width) * 1024);
  const y = Math.round(((e.clientY - rect.top) / rect.height) * 768);
  
  const clampX = Math.max(0, Math.min(1024, x));
  const clampY = Math.max(0, Math.min(768, y));
  
  // Position visual marker relative to the container element (%)
  const percentX = (clampX / 1024) * 100;
  const percentY = (clampY / 768) * 100;
  
  inspectorTargetDot.classList.remove('hidden');
  inspectorTargetDot.style.left = `${percentX}%`;
  inspectorTargetDot.style.top = `${percentY}%`;
  
  inspectCoordsClick.textContent = `Click: (${clampX}, ${clampY})`;
  inspectCopyVal.value = `[${clampX}, ${clampY}]`;
});

inspectCopyBtn.addEventListener('click', () => {
  if (!inspectCopyVal.value) return;
  navigator.clipboard.writeText(inspectCopyVal.value);
  const oldText = inspectCopyBtn.textContent;
  inspectCopyBtn.textContent = 'Copied!';
  inspectCopyBtn.style.background = 'var(--primary-cyan)';
  inspectCopyBtn.style.color = 'var(--bg-color)';
  setTimeout(() => {
    inspectCopyBtn.textContent = oldText;
    inspectCopyBtn.style.background = '';
    inspectCopyBtn.style.color = '';
  }, 1000);
});

// Timeline Slideshow Playback State & Event Handlers
let playbackInterval = null;
let isPlaying = false;

const playPrevBtn = document.getElementById('play-prev-btn');
const playToggleBtn = document.getElementById('play-toggle-btn');
const playNextBtn = document.getElementById('play-next-btn');
const playbackSpeedSelect = document.getElementById('playback-speed');

function playNextStep() {
  const cards = Array.from(timelineList.querySelectorAll('.step-card'));
  if (cards.length === 0) return;
  
  const activeCard = timelineList.querySelector('.step-card.active');
  let nextIndex = 0;
  
  if (activeCard) {
    const currentIndex = cards.indexOf(activeCard);
    nextIndex = (currentIndex + 1) % cards.length;
  }
  
  cards[nextIndex].click();
}

function playPrevStep() {
  const cards = Array.from(timelineList.querySelectorAll('.step-card'));
  if (cards.length === 0) return;
  
  const activeCard = timelineList.querySelector('.step-card.active');
  let prevIndex = cards.length - 1;
  
  if (activeCard) {
    const currentIndex = cards.indexOf(activeCard);
    prevIndex = (currentIndex - 1 + cards.length) % cards.length;
  }
  
  cards[prevIndex].click();
}

function togglePlayback() {
  if (isPlaying) {
    clearInterval(playbackInterval);
    playToggleBtn.textContent = '⏯️';
    isPlaying = false;
    appendLog('[System] Slideshow playback paused.');
  } else {
    const cards = timelineList.querySelectorAll('.step-card');
    if (cards.length === 0) return;
    
    isPlaying = true;
    playToggleBtn.textContent = '⏸️';
    appendLog('[System] Starting slideshow auto-playback.');
    
    const intervalTime = parseInt(playbackSpeedSelect.value, 10);
    playbackInterval = setInterval(playNextStep, intervalTime);
  }
}

playToggleBtn.addEventListener('click', togglePlayback);
playNextBtn.addEventListener('click', playNextStep);
playPrevBtn.addEventListener('click', playPrevStep);

playbackSpeedSelect.addEventListener('change', () => {
  if (isPlaying) {
    clearInterval(playbackInterval);
    const intervalTime = parseInt(playbackSpeedSelect.value, 10);
    playbackInterval = setInterval(playNextStep, intervalTime);
  }
});

// Dynamic Health Checks
async function checkSystemHealth() {
  const badgeNode = document.getElementById('badge-node');
  const badgePlaywright = document.getElementById('badge-playwright');
  const badgeKey = document.getElementById('badge-key');
  
  try {
    const res = await fetch('/api/status');
    const status = await res.json();
    
    badgeNode.querySelector('span:not(.badge-indicator)').textContent = `Node: ${status.status}`;
    badgeNode.querySelector('.badge-indicator').className = 'badge-indicator online';
    
    badgePlaywright.querySelector('span:not(.badge-indicator)').textContent = `Playwright: ${status.playwright}`;
    badgePlaywright.querySelector('.badge-indicator').className = `badge-indicator ${status.playwright === 'READY' ? 'online' : 'offline'}`;
    
    badgeKey.querySelector('span:not(.badge-indicator)').textContent = `API Key: ${status.apiKey === 'CONFIGURED' ? 'CONFIGURED' : 'NOT SET'}`;
    badgeKey.querySelector('.badge-indicator').className = `badge-indicator ${status.apiKey === 'CONFIGURED' ? 'configured' : 'offline'}`;
  } catch (err) {
    badgeNode.querySelector('span:not(.badge-indicator)').textContent = 'Node: OFFLINE';
    badgeNode.querySelector('.badge-indicator').className = 'badge-indicator offline';
    
    badgePlaywright.querySelector('span:not(.badge-indicator)').textContent = 'Playwright: OFFLINE';
    badgePlaywright.querySelector('.badge-indicator').className = 'badge-indicator offline';
    
    badgeKey.querySelector('span:not(.badge-indicator)').textContent = 'API Key: OFFLINE';
    badgeKey.querySelector('.badge-indicator').className = 'badge-indicator offline';
  }
}

// Initialize on Load
loadHistory();
checkSystemHealth();

