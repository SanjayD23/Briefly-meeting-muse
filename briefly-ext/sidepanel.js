let mediaRecorder;
let audioChunks = [];
let capturedStream = null;
let currentNotesData = null;
let meetSpeakerData = null;   // Holds { participants: [], timeline: [] } from Google Meet DOM
let activeMeetTabId = null;   // Tab ID of the Meet tab being recorded
const API_BASE_URL = 'http://127.0.0.1:8000';

// ──────────────────────────────────────────────
// Helper: Send a message to the content script
// running in the active Meet tab.
// Returns null gracefully if not a Meet tab.
// ──────────────────────────────────────────────
async function sendToMeetTab(type, tabId) {
    const id = tabId || activeMeetTabId;
    if (!id) return null;
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(id, { type }, (response) => {
            if (chrome.runtime.lastError) {
                // Not a Meet tab or content script not ready — fail silently
                resolve(null);
            } else {
                resolve(response);
            }
        });
    });
}

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const controlGroup = document.getElementById('controlGroup');
const statusBox = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const languageSelect = document.getElementById('languageSelect');
const downloadBtn = document.getElementById('downloadBtn');
const historyBtn = document.getElementById('historyBtn');
const backBtn = document.getElementById('backBtn');
const mainView = document.getElementById('mainView');
const historyView = document.getElementById('historyView');
const historyList = document.getElementById('historyList');

// Chat Elements
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

// Global Chat Elements
const globalChatBox = document.getElementById('globalChatBox');
const globalChatInput = document.getElementById('globalChatInput');
const globalSendBtn = document.getElementById('globalSendBtn');

// UI Toggle Logic
historyBtn.addEventListener('click', showHistory);
backBtn.addEventListener('click', hideHistory);

function showHistory() {
    mainView.style.display = "none";
    historyView.style.display = "block";
    loadHistory();
}

function hideHistory() {
    mainView.style.display = "block";
    historyView.style.display = "none";
}

function loadHistory() {
    chrome.storage.local.get({ meetingHistory: [] }, (result) => {
        const history = result.meetingHistory;
        if (history.length === 0) {
            historyList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">No history yet.</div>';
            return;
        }
        historyList.innerHTML = '';
        history.forEach((item) => {
            const date = new Date(item.timestamp).toLocaleString();
            const div = document.createElement('div');
            div.className = 'history-item';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            
            const contentDiv = document.createElement('div');
            contentDiv.style.flex = "1";
            contentDiv.style.overflow = "hidden";
            contentDiv.style.cursor = "pointer";
            contentDiv.innerHTML = `
                <div class="history-date">${date}</div>
                <div class="history-preview">${item.summary || 'Meeting Note'}</div>
            `;
            contentDiv.onclick = () => {
                currentNotesData = item;
                displayResults(item);
                hideHistory();
            };
            
            const delBtn = document.createElement('button');
            delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
            delBtn.title = 'Delete this meeting';
            delBtn.style.cssText = 'background:rgba(239, 68, 68, 0.1); color:#ef4444; border:1px solid #ef4444; border-radius:6px; cursor:pointer; padding:6px; display:flex; align-items:center; justify-content:center; opacity:0.7; transition:all 0.2s; margin-left:10px; flex-shrink:0;';
            delBtn.onmouseover = () => delBtn.style.opacity = '1';
            delBtn.onmouseout = () => delBtn.style.opacity = '0.7';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm("Are you sure you want to delete this meeting?")) {
                    deleteHistoryItem(item.timestamp);
                }
            };
            
            div.appendChild(contentDiv);
            div.appendChild(delBtn);
            historyList.appendChild(div);
        });
    });
}

function deleteHistoryItem(timestamp) {
    chrome.storage.local.get({ meetingHistory: [] }, (result) => {
        const history = result.meetingHistory.filter(item => item.timestamp !== timestamp);
        chrome.storage.local.set({ meetingHistory: history }, loadHistory);
    });
}

document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (confirm("Are you sure you want to delete ALL meeting history? This cannot be undone.")) {
        chrome.storage.local.set({ meetingHistory: [] }, loadHistory);
    }
});

function saveToHistory(data) {
    const historyItem = {
        timestamp: new Date().toISOString(),
        summary: data.summary,
        action_items: data.action_items,
        decisions: data.decisions,
        transcript: data.transcript,
        mermaid_diagram: data.mermaid_diagram,
        calendar_events: data.calendar_events,
        accountability: data.accountability
    };
    chrome.storage.local.get({ meetingHistory: [] }, (result) => {
        const history = result.meetingHistory;
        history.unshift(historyItem);
        chrome.storage.local.set({ meetingHistory: history });
    });
}

startBtn.addEventListener('click', async () => {
    try {
        capturedStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

        // Extract ONLY the audio track to save memory and allow long recordings
        const audioTracks = capturedStream.getAudioTracks();
        if (audioTracks.length === 0) {
            capturedStream.getTracks().forEach(t => t.stop());
            throw new Error("No audio detected. In the share dialog, select a tab and enable 'Share tab audio'.");
        }

        // Stop the video track — we only need audio
        capturedStream.getVideoTracks().forEach(t => t.stop());

        // ── Google Meet Integration: Start speaker tracking ──
        meetSpeakerData = null;
        activeMeetTabId = null;
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url && activeTab.url.includes('meet.google.com')) {
            activeMeetTabId = activeTab.id;
            const response = await sendToMeetTab('BRIEFLY_START_TRACKING', activeTab.id);
            if (response && response.status === 'ok') {
                console.log('[Briefly] Meet speaker tracking started. Initial participants:', response.participants);
            }
        }

        const audioStream = new MediaStream(audioTracks);
        mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = processAudio;
        mediaRecorder.start();

        statusBox.innerText = "Recording";
        statusBox.className = "status-pill pill-recording";
        startBtn.style.display = "none";
        languageSelect.style.display = "none";
        controlGroup.style.display = "flex";
        resultsDiv.style.display = "none";
        chatBox.innerHTML = '';
    } catch (err) {
        statusBox.innerText = `Error: ${err.message}`;
        statusBox.className = "status-pill";
        console.error(err);
    }
});


pauseBtn.addEventListener('click', () => {
    if (mediaRecorder.state === "recording") {
        mediaRecorder.pause();
        pauseBtn.innerText = "Resume";
        statusBox.innerText = "Paused";
    } else {
        mediaRecorder.resume();
        pauseBtn.innerText = "Pause";
        statusBox.innerText = "Recording";
    }
});

stopBtn.addEventListener('click', async () => {
    // ── Google Meet Integration: Stop speaker tracking BEFORE stopping recorder ──
    if (activeMeetTabId) {
        const response = await sendToMeetTab('BRIEFLY_STOP_TRACKING', activeMeetTabId);
        if (response && response.status === 'ok') {
            meetSpeakerData = response.data;
            console.log('[Briefly] Meet speaker data collected:', meetSpeakerData);
        }
        activeMeetTabId = null;
    }

    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    if (capturedStream) capturedStream.getTracks().forEach(track => track.stop());
    statusBox.innerText = "Analyzing";
    statusBox.className = "status-pill pill-processing";
    controlGroup.style.display = "none";
});

async function processAudio() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('file', audioBlob, 'meeting.webm');
    formData.append('language', languageSelect.value);

    // ── Attach speaker names from Google Meet DOM (if available) ──
    if (meetSpeakerData && meetSpeakerData.participants && meetSpeakerData.participants.length > 0) {
        formData.append('participants', JSON.stringify(meetSpeakerData.participants));
        formData.append('speaker_timeline', JSON.stringify(meetSpeakerData.timeline));
        console.log('[Briefly] Sending participant names to backend:', meetSpeakerData.participants);
    }

    try {
        const response = await fetch(`${API_BASE_URL}/process-audio`, { method: 'POST', body: formData });
        const result = await response.json();
        if (response.ok && result.status === "success") {
            currentNotesData = { ...result.data, timestamp: new Date().toISOString() }; 
            displayResults(currentNotesData);
            saveToHistory(currentNotesData);
            statusBox.innerText = "Complete";
            statusBox.className = "status-pill pill-complete";
        } else { throw new Error(result.message || `Request failed with status ${response.status}`); }
    } catch (err) {
        statusBox.innerText = `Error: ${err.message}`;
        statusBox.className = "status-pill";
        console.error('processAudio failed:', err);
    } finally {
        startBtn.style.display = "flex";
        languageSelect.style.display = "block";
    }
}

async function displayResults(data) {
    document.getElementById('summaryText').innerText = data.summary || data.summaryText || 'No summary available.';
    
    const actionList = document.getElementById('actionItemsList');
    actionList.innerHTML = '';
    const actionItems = data.action_items || data.actionItems || [];
    actionItems.forEach(item => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.style.marginBottom = '8px';
        
        const textSpan = document.createElement('span');
        textSpan.innerText = item;
        
        const jiraBtn = document.createElement('button');
        jiraBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg> Create Task';
        jiraBtn.style.cssText = 'background:rgba(14, 165, 233, 0.1); color:#0ea5e9; border:1px solid #0ea5e9; border-radius:6px; padding:4px 8px; font-size:10px; cursor:pointer; font-weight:bold; margin-left:10px; flex-shrink:0; display:flex; align-items:center;';
        jiraBtn.onclick = () => generateJiraTicket(item, data.transcript, languageSelect.value);

        li.appendChild(textSpan);
        li.appendChild(jiraBtn);
        actionList.appendChild(li);
    });

    const decisionList = document.getElementById('decisionsList');
    decisionList.innerHTML = '';
    const decisions = data.decisions || data.keyDecisions || [];
    decisions.forEach(item => {
        const li = document.createElement('li');
        li.innerText = item;
        decisionList.appendChild(li);
    });

    const diagramContainer = document.getElementById('diagramContainer');
    const noDiagramMsg = document.getElementById('noDiagramMsg');
    const copyDiagramBtn = document.getElementById('copyDiagramBtn');
    const viewDiagramBtn = document.getElementById('viewDiagramBtn');

    diagramContainer.style.display = "block";
    noDiagramMsg.style.display = "none";
    copyDiagramBtn.style.display = "none";
    if (viewDiagramBtn) viewDiagramBtn.style.display = "none";

    if (data.mermaid_diagram && data.mermaid_diagram.trim() !== '') {
        try {
            let rawMermaid = data.mermaid_diagram.replace(/```mermaid/g, '').replace(/```/g, '').trim();

            const match = rawMermaid.match(/(?:^|\n)\s*(graph\b|flowchart\b|sequenceDiagram\b|classDiagram\b|stateDiagram\b|erDiagram\b|pie\b|gantt\b|journey\b|gitGraph\b|mindmap\b|timeline\b)[\s\S]*/i);
            if (!match) throw new Error("Not a valid mermaid diagram");

            rawMermaid = match[0].trim();

            // Show buttons only — no raw code displayed
            copyDiagramBtn.style.display = "flex";
            if (viewDiagramBtn) {
                const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({ code: rawMermaid, mermaid: { theme: 'dark' } }))));
                viewDiagramBtn.onclick = () => window.open('https://mermaid.live/edit#base64:' + encoded, '_blank');
                viewDiagramBtn.style.display = "flex";
            }

            copyDiagramBtn.onclick = () => {
                navigator.clipboard.writeText(rawMermaid);
                copyDiagramBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
                setTimeout(() => {
                    copyDiagramBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy Code';
                }, 2000);
            };
        } catch (e) {
            noDiagramMsg.innerText = "Could not parse diagram data.";
            noDiagramMsg.style.display = "block";
            console.error("Diagram error", e);
        }
    } else {
        noDiagramMsg.innerText = "No architecture or flow diagram required for this meeting.";
        noDiagramMsg.style.display = "block";
    }

    const deadlinesContainer = document.getElementById('deadlinesContainer');
    const deadlinesList = document.getElementById('deadlinesList');
    deadlinesList.innerHTML = '';
    
    if (data.calendar_events && data.calendar_events.length > 0) {
        data.calendar_events.forEach(ev => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.marginBottom = '8px';
            
            const textSpan = document.createElement('span');
            textSpan.innerText = `${ev.title} (${ev.start_time_iso ? new Date(ev.start_time_iso).toLocaleDateString() : 'Unknown'})`;
            
            const calBtn = document.createElement('button');
            calBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Calendar';
            calBtn.style.cssText = 'background:rgba(14, 165, 233, 0.1); color:#0ea5e9; border:1px solid #0ea5e9; border-radius:6px; padding:4px 8px; font-size:10px; cursor:pointer; font-weight:bold; margin-left:10px; flex-shrink:0; display:flex; align-items:center;';
            calBtn.onclick = () => {
                const sTime = ev.start_time_iso ? ev.start_time_iso.replace(/[-:]/g, '').split('.')[0] + 'Z' : '';
                const eTime = ev.end_time_iso ? ev.end_time_iso.replace(/[-:]/g, '').split('.')[0] + 'Z' : sTime;
                const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${sTime}/${eTime}&details=${encodeURIComponent(ev.description || '')}`;
                window.open(url, '_blank');
            };
            
            li.appendChild(textSpan);
            li.appendChild(calBtn);
            deadlinesList.appendChild(li);
        });
        deadlinesContainer.style.display = 'block';
    } else {
        deadlinesContainer.style.display = 'none';
    }

    // --- ACCOUNTABILITY / SPEAKER SECTION ---
    const accountabilityContainer = document.getElementById('accountabilityContainer');
    const accountabilityList = document.getElementById('accountabilityList');
    accountabilityList.innerHTML = '';

    const accountabilityItems = data.accountability || [];
    if (accountabilityItems.length > 0) {
        accountabilityItems.forEach((item, index) => {
            const speakerColors = ['#38bdf8', '#a78bfa', '#34d399', '#fb923c', '#f472b6'];
            const color = speakerColors[index % speakerColors.length];
            const card = document.createElement('div');
            card.style.cssText = `background: rgba(17,24,39,0.7); border: 1px solid ${color}33; border-left: 3px solid ${color}; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px;`;
            const speakerName = item.speaker || 'Speaker';
            card.innerHTML = `
                <div style="font-size: 13px; line-height: 1.7; color: #F9FAFB;">
                    <span style="font-weight: 700; color: ${color};">${speakerName} says that,</span>
                    <span> ${item.statement || ''}</span>
                </div>
            `;
            accountabilityList.appendChild(card);
        });
        accountabilityContainer.style.display = 'block';
    } else {
        accountabilityContainer.style.display = 'none';
    }

    resultsDiv.style.display = "block";
    downloadBtn.style.display = "block"; 
    document.getElementById('notionBtn').style.display = "block";
}

// Chat Logic
sendBtn.addEventListener('click', async () => {
    const question = chatInput.value.trim();
    if (!question || !currentNotesData || !currentNotesData.transcript) return;

    // Add user message to UI
    appendChatMessage('You', question, 'msg-user');
    chatInput.value = '';

    try {
        const response = await fetch('http://localhost:8000/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: currentNotesData.transcript,
                question: question
            })
        });
        const result = await response.json();
        if (result.status === "success") {
            appendChatMessage('AI', result.answer, 'msg-ai');
        } else {
            appendChatMessage('System', 'Error: Could not get answer.', 'msg-ai');
        }
    } catch (err) {
        appendChatMessage('System', 'Error: Connection failed.', 'msg-ai');
    }
});

function appendChatMessage(sender, text, className) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg';
    msgDiv.innerHTML = `<span class="${className}">${sender}:</span> ${text}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

downloadBtn.addEventListener('click', () => {
    if (!currentNotesData) return;
    const date = new Date(currentNotesData.timestamp || Date.now()).toLocaleString();
    const actionItems = currentNotesData.action_items || currentNotesData.actionItems || [];
    const decisions = currentNotesData.decisions || currentNotesData.keyDecisions || [];
    let textContent = `MEETING NOTES\nDate: ${date}\n\nSUMMARY:\n${currentNotesData.summary || currentNotesData.summaryText || 'No summary available.'}\n\nACTION ITEMS:\n`;
    actionItems.forEach(item => textContent += `- ${item}\n`);
    textContent += `\nKEY DECISIONS:\n`;
    decisions.forEach(item => textContent += `- ${item}\n`);

    const blob = new Blob([textContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Meeting_Notes_${new Date().getTime()}.txt`;
    a.click();
});

// Global Chat Logic
globalSendBtn.addEventListener('click', async () => {
    const question = globalChatInput.value.trim();
    if (!question) return;

    appendGlobalChatMessage('You', question, 'msg-user');
    globalChatInput.value = '';

    chrome.storage.local.get({ meetingHistory: [] }, async (result) => {
        const history = result.meetingHistory.map(item => ({
            date: item.timestamp,
            transcript: item.transcript
        }));
        
        if (history.length === 0) {
            appendGlobalChatMessage('System', 'No meetings recorded yet.', 'msg-ai');
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/chat-global`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    history: history,
                    question: question
                })
            });
            const res = await response.json();
            if (res.status === "success") {
                appendGlobalChatMessage('AI', res.answer, 'msg-ai');
            } else {
                appendGlobalChatMessage('System', 'Error: Could not get answer.', 'msg-ai');
            }
        } catch (err) {
            appendGlobalChatMessage('System', 'Error: Connection failed.', 'msg-ai');
        }
    });
});

function appendGlobalChatMessage(sender, text, className) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg';
    msgDiv.innerHTML = `<span class="${className}">${sender}:</span> ${text}`;
    globalChatBox.appendChild(msgDiv);
    globalChatBox.scrollTop = globalChatBox.scrollHeight;
}

// --- JIRA LOGIC ---
const jiraModal = document.getElementById('jiraModal');
const jiraContent = document.getElementById('jiraContent');
document.getElementById('closeJiraBtn').onclick = () => jiraModal.style.display = 'none';
document.getElementById('copyJiraBtn').onclick = () => {
    navigator.clipboard.writeText(jiraContent.innerText);
    document.getElementById('copyJiraBtn').innerText = "Copied!";
    setTimeout(() => document.getElementById('copyJiraBtn').innerText = "Copy Task", 2000);
};

async function generateJiraTicket(actionItem, transcript, language) {
    jiraContent.innerText = "Generating ticket... Please wait.";
    jiraModal.style.display = 'flex';
    try {
        const response = await fetch(`${API_BASE_URL}/generate-ticket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action_item: actionItem, transcript: transcript, language: language || 'English' })
        });
        const res = await response.json();
        if (res.status === "success" && res.ticket) {
            const t = res.ticket;
            jiraContent.innerText = `[${t.title}]\n\nDESCRIPTION:\n${t.description}\n\nACCEPTANCE CRITERIA:\n${(t.acceptance_criteria || []).map(c => `- ${c}`).join('\n')}`;
        } else {
            jiraContent.innerText = "Error: Could not generate ticket.";
        }
    } catch(err) {
        jiraContent.innerText = "Connection failed.";
    }
}

// --- NOTION EXPORT LOGIC ---
document.getElementById('notionBtn').addEventListener('click', () => {
    if (!currentNotesData) return;
    const date = new Date(currentNotesData.timestamp || Date.now()).toLocaleDateString();
    
    let md = `# Meeting Notes: ${date}\n\n## 📝 Summary\n${currentNotesData.summary || ''}\n\n`;
    
    md += `## ✅ Action Items\n`;
    (currentNotesData.action_items || []).forEach(item => md += `- [ ] ${item}\n`);
    
    md += `\n## 🎯 Key Decisions\n`;
    (currentNotesData.decisions || []).forEach(item => md += `- ${item}\n`);
    
    if (currentNotesData.mermaid_diagram) {
        md += `\n## 🗺️ Architecture / Flow\n\`\`\`mermaid\n${currentNotesData.mermaid_diagram}\n\`\`\`\n`;
    }
    
    navigator.clipboard.writeText(md);
    const btn = document.getElementById('notionBtn');
    btn.innerText = "Copied to Clipboard!";
    setTimeout(() => btn.innerText = "Copy for Notion", 2000);
});