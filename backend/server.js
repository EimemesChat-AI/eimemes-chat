const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend/public')));

// --- SYSTEM PROMPT (editable here on the backend) ---
const DEFAULT_SYSTEM_PROMPT = `You are EimemesChat AI, a helpful, friendly, and knowledgeable assistant. 
You have a sleek, modern personality to match your beautiful iOS-inspired interface. 
You are concise but thorough. You speak naturally and engagingly. 
You can help with design, coding, writing, planning, education, and more.`;

// In-memory storage for settings and conversations
let appSettings = {
  appearance: 'dark',
  notifications: true,
  language: 'English',
  chatHistory: true,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0.7,
  model: 'gemini-2.0-flash'
};

// In-memory conversation store: { [sessionId]: [{role, parts}] }
const conversations = {};

// ---- API: Get settings ----
app.get('/api/settings', (req, res) => {
  res.json(appSettings);
});

// ---- API: Update settings ----
app.put('/api/settings', (req, res) => {
  appSettings = { ...appSettings, ...req.body };
  res.json({ success: true, settings: appSettings });
});

// ---- API: Clear all chats ----
app.delete('/api/chats', (req, res) => {
  Object.keys(conversations).forEach(k => delete conversations[k]);
  res.json({ success: true });
});

// ---- API: Get chat history for a session ----
app.get('/api/chat/:sessionId', (req, res) => {
  const history = conversations[req.params.sessionId] || [];
  res.json(history);
});

// ---- API: Chat with Gemini ----
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) {
    return res.status(400).json({ error: 'message and sessionId are required' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  // Build conversation history
  if (!conversations[sessionId]) conversations[sessionId] = [];
  const history = conversations[sessionId];

  // Add user message to history
  history.push({ role: 'user', parts: [{ text: message }] });

  try {
    const requestBody = {
      system_instruction: {
        parts: [{ text: appSettings.systemPrompt || DEFAULT_SYSTEM_PROMPT }]
      },
      contents: history,
      generationConfig: {
        temperature: appSettings.temperature || 0.7,
        maxOutputTokens: 1024
      }
    };

    const model = appSettings.model || 'gemini-2.0-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      // Remove the user message we just added on error
      history.pop();
      return res.status(502).json({ error: 'Gemini API error', detail: errText });
    }

    const data = await geminiRes.json();
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI.';

    // Add AI response to history
    history.push({ role: 'model', parts: [{ text: aiText }] });

    // Limit history to last 40 turns to avoid token overflow
    if (history.length > 40) history.splice(0, history.length - 40);

    // Save if chat history setting is enabled
    if (!appSettings.chatHistory) {
      delete conversations[sessionId];
    }

    res.json({ reply: aiText, sessionId });
  } catch (err) {
    console.error(err);
    history.pop();
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- API: Get recent sessions (for sidebar history) ----
app.get('/api/sessions', (req, res) => {
  const sessions = Object.entries(conversations).map(([id, msgs]) => {
    const firstUser = msgs.find(m => m.role === 'user');
    return {
      id,
      title: firstUser ? firstUser.parts[0].text.slice(0, 40) : 'New Chat'
    };
  }).reverse().slice(0, 20);
  res.json(sessions);
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`EimemesChat AI server running at http://localhost:${PORT}`);
  console.log(`Make sure GEMINI_API_KEY is set in your environment.`);
});
