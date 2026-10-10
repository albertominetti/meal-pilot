process.env.NODE_ENV = 'test';
process.env.MEALPILOT_LLM_MODE = 'mock';
delete process.env.GEMINI_API_KEY;
// Keep the offline suite offline even when a developer's .env has a key.
process.env.YOUTUBE_API_KEY = '';
