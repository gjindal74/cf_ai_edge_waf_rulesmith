/**
 * Edge WAF Rulesmith - Frontend
 */

// Configuration
// Auto-detect local development
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
// For production, set your worker URL here or configure it via Pages Functions
const WORKER_URL = 'YOUR_WORKER_URL_HERE'; // e.g., 'https://edge-waf-rulesmith.your-subdomain.workers.dev'
const API_BASE = isLocalDev 
  ? 'http://localhost:8787'  // Local worker runs on 8787
  : (WORKER_URL !== 'YOUR_WORKER_URL_HERE' ? WORKER_URL : window.location.origin);  // Production: use worker URL or same origin

let sessionId = null;
let chatHistory = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    loadSession();
});

function initializeEventListeners() {
    const sendButton = document.getElementById('sendButton');
    const messageInput = document.getElementById('messageInput');
    const exampleButtons = document.querySelectorAll('.example-btn');
    const previewButton = document.getElementById('previewButton');
    const applyButton = document.getElementById('applyButton');
    const copyButton = document.getElementById('copyButton');

    // Send message on button click
    sendButton.addEventListener('click', handleSendMessage);

    // Send message on Enter key
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Example prompt buttons
    exampleButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.getAttribute('data-prompt');
            messageInput.value = prompt;
            messageInput.focus();
        });
    });

    // Rule actions
    previewButton.addEventListener('click', handleValidateRule);
    applyButton.addEventListener('click', handleApplyRule);
    copyButton.addEventListener('click', handleCopyExpression);
}

async function handleSendMessage() {
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const message = messageInput.value.trim();

    if (!message) return;

    // Disable input
    messageInput.disabled = true;
    sendButton.disabled = true;
    sendButton.innerHTML = '<span class="loading"></span>';

    // Add user message to chat
    addMessageToChat('user', message);
    chatHistory.push({ role: 'user', content: message });

    // Clear input
    messageInput.value = '';

    try {
        // Call API
        const response = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message,
                sessionId,
                history: chatHistory,
            }),
        });

        if (!response.ok) {
            // Try to get error message from response
            let errorMessage = `HTTP error! status: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData.error) {
                    errorMessage = errorData.error;
                } else if (errorData.message) {
                    errorMessage = errorData.message;
                }
            } catch (e) {
                // If response isn't JSON, use status text
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();

        // Update session ID
        if (data.sessionId) {
            sessionId = data.sessionId;
        }

        // Add AI response to chat
        addMessageToChat('assistant', data.message);
        chatHistory.push({ role: 'assistant', content: data.message });

        // Display generated rule
        if (data.rule) {
            displayRule(data.rule);
        }
    } catch (error) {
        console.error('Error:', error);
        console.error('API_BASE:', API_BASE);
        console.error('Full error:', error);
        
        // More detailed error messages
        let errorMsg = error.message;
        if (error.message === 'Failed to fetch') {
            errorMsg = `Failed to connect to API at ${API_BASE}. Make sure the worker is running on port 8787. Check the worker terminal for errors.`;
        } else if (error.message.includes('HTTP error')) {
            errorMsg = error.message; // Show the actual HTTP error
        }
        
        console.error('Full error details:', {
            message: error.message,
            apiBase: API_BASE,
            url: `${API_BASE}/api/chat`
        });
        
        addMessageToChat('system', `Error: ${errorMsg}`);
    } finally {
        // Re-enable input
        messageInput.disabled = false;
        sendButton.disabled = false;
        sendButton.textContent = 'Send';
        messageInput.focus();
    }
}

function addMessageToChat(role, content) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'You' : 'Rulesmith AI';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = content;

    messageDiv.appendChild(label);
    messageDiv.appendChild(bubble);
    chatMessages.appendChild(messageDiv);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function displayRule(rule) {
    const rulePreview = document.getElementById('rulePreview');
    const ruleActions = document.getElementById('ruleActions');
    const ruleExpression = document.getElementById('ruleExpression');
    const ruleAction = document.getElementById('ruleAction');
    const ruleDescription = document.getElementById('ruleDescription');

    // Clear previous rule preview
    rulePreview.innerHTML = '';

    // Create rule preview
    const ruleItem = document.createElement('div');
    ruleItem.className = 'rule-item';

    const header = document.createElement('div');
    header.className = 'rule-item-header';

    const title = document.createElement('div');
    title.className = 'rule-item-title';
    title.textContent = rule.description || 'Generated WAF Rule';

    const actionBadge = document.createElement('div');
    actionBadge.className = 'rule-item-action';
    actionBadge.textContent = rule.action || 'block';

    header.appendChild(title);
    header.appendChild(actionBadge);

    const expression = document.createElement('div');
    expression.className = 'rule-item-expression';
    expression.textContent = rule.rule || 'No expression generated';

    const explanation = document.createElement('div');
    explanation.style.marginTop = '10px';
    explanation.style.fontSize = '0.85rem';
    explanation.style.color = '#7f8c8d';
    explanation.textContent = rule.explanation || '';

    ruleItem.appendChild(header);
    ruleItem.appendChild(expression);
    ruleItem.appendChild(explanation);
    rulePreview.appendChild(ruleItem);

    // Populate form fields
    ruleExpression.value = rule.rule || '';
    ruleAction.value = rule.action || 'block';
    ruleDescription.value = rule.description || '';

    // Make expression editable
    ruleExpression.removeAttribute('readonly');
    ruleExpression.style.background = 'white';

    // Show actions panel
    ruleActions.style.display = 'block';
}

async function handleValidateRule() {
    const ruleExpression = document.getElementById('ruleExpression');
    const ruleStatus = document.getElementById('ruleStatus');
    const expression = ruleExpression.value.trim();

    if (!expression) {
        showStatus('error', 'Please provide an expression to validate');
        return;
    }

    ruleStatus.className = 'status-message info';
    ruleStatus.textContent = 'Validating...';
    ruleStatus.style.display = 'block';

    try {
        const response = await fetch(`${API_BASE}/api/rules/preview`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ expression }),
        });

        const data = await response.json();

        if (data.valid) {
            let message = '✓ Expression is valid';
            if (data.warnings && data.warnings.length > 0) {
                message += `. Warnings: ${data.warnings.join(', ')}`;
            }
            showStatus('success', message);
        } else {
            showStatus('error', `Validation failed: ${data.errors.join(', ')}`);
        }
    } catch (error) {
        showStatus('error', `Error: ${error.message}`);
    }
}

async function handleApplyRule() {
    const ruleExpression = document.getElementById('ruleExpression');
    const ruleAction = document.getElementById('ruleAction');
    const ruleDescription = document.getElementById('ruleDescription');
    const ruleEnabled = document.getElementById('ruleEnabled');
    const zoneId = document.getElementById('zoneId');
    const applyButton = document.getElementById('applyButton');
    const ruleStatus = document.getElementById('ruleStatus');

    const expression = ruleExpression.value.trim();
    const zone_id = zoneId.value.trim();

    if (!expression) {
        showStatus('error', 'Please provide an expression');
        return;
    }

    if (!zone_id) {
        showStatus('error', 'Please provide a Cloudflare Zone ID');
        return;
    }

    applyButton.disabled = true;
    applyButton.textContent = 'Applying...';
    ruleStatus.className = 'status-message info';
    ruleStatus.textContent = 'Applying rule to Cloudflare...';
    ruleStatus.style.display = 'block';

    try {
        const response = await fetch(`${API_BASE}/api/rules`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                zone_id,
                expression,
                action: ruleAction.value,
                description: ruleDescription.value || 'WAF rule',
                enabled: ruleEnabled.checked,
            }),
        });

        const data = await response.json();

        if (response.ok && data.success !== false) {
            showStatus('success', `✓ Rule applied successfully! Rule ID: ${data.result?.[0]?.id || 'N/A'}`);
            addMessageToChat('system', `Rule applied to zone ${zone_id}`);
        } else {
            const errorMsg = data.errors?.[0]?.message || data.error || 'Failed to apply rule';
            showStatus('error', `Failed: ${errorMsg}`);
        }
    } catch (error) {
        showStatus('error', `Error: ${error.message}`);
    } finally {
        applyButton.disabled = false;
        applyButton.textContent = 'Apply Rule';
    }
}

function handleCopyExpression() {
    const ruleExpression = document.getElementById('ruleExpression');
    ruleExpression.select();
    document.execCommand('copy');

    // Visual feedback
    const copyButton = document.getElementById('copyButton');
    const originalText = copyButton.textContent;
    copyButton.textContent = 'Copied!';
    setTimeout(() => {
        copyButton.textContent = originalText;
    }, 2000);
}

function showStatus(type, message) {
    const ruleStatus = document.getElementById('ruleStatus');
    ruleStatus.className = `status-message ${type}`;
    ruleStatus.textContent = message;
    ruleStatus.style.display = 'block';

    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(() => {
            ruleStatus.style.display = 'none';
        }, 5000);
    }
}

function loadSession() {
    // Load session ID from localStorage
    const savedSessionId = localStorage.getItem('rulesmith_session_id');
    if (savedSessionId) {
        sessionId = savedSessionId;
    }

    // Load zone ID if previously set
    const savedZoneId = localStorage.getItem('rulesmith_zone_id');
    if (savedZoneId) {
        document.getElementById('zoneId').value = savedZoneId;
    }
}

// Save zone ID when changed
document.getElementById('zoneId')?.addEventListener('change', (e) => {
    localStorage.setItem('rulesmith_zone_id', e.target.value);
});

