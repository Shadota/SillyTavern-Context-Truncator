# CacheGuard - Smart Context Management for SillyTavern

**Made with long-form roleplays in mind!** CacheGuard intelligently manages your context window to make sure your extended roleplays will remain usable with minimal performance impact!

## The Problem

When your context window fills up, every new message forces the LLM provider to remove old messages from the start of the conversation. This causes **prompt cache invalidation** - the cached prefix becomes invalid, and your fast generations suddenly become slow. Permanently. You go from quick responses to long waits in an instant, and it never recovers because every message shifts the context again.

## The Solution

CacheGuard automatically:
- **Truncates old messages** at a configurable threshold while preserving recent context
- **Summarizes excluded messages** into compact notes that maintain story continuity
- **Retrieves semantically relevant memories** from your conversation history using vector search
- **Auto-calibrates** to optimally fill your context window without overflowing

## Key Features

🎯 **Smart Truncation** - Automatically removes old messages while keeping a configurable number of recent ones  
📝 **Auto-Summarization** - Generates concise summaries of excluded messages using your preferred LLM endpoint  
🧠 **Vector Memory** - Qdrant-powered semantic search retrieves relevant past events when contextually appropriate  
📊 **Visual Dashboard** - Real-time context utilization gauge and breakdown by category  
⚙️ **Auto-Calibration** - Self-tuning algorithm learns your optimal context size over a few generations  
🔌 **LoreVault Compatible** - Automatically tracks LoreVault memory tokens in the context breakdown

## Quick Start

1. By default, everything is enabled to work out-of-the-box!
2. Optionally configure **Auto-Summarize** with an OpenAI-compatible endpoint to allow for summarizations to happen, instead of truncated messages to be dropped completely.
3. For vector memory, configure **Qdrant** connection in the Qdrant Memory tab.
4. LoreVault simply has to be enabled in it's own extensions' settings.

## Credits & Acknowledgments

This extension builds upon excellent prior work:

- **[st-qdrant-memory](https://github.com/HO-git/st-qdrant-memory)** by HO-git - Vector memory architecture and Qdrant integration patterns
- **[SillyTavern-MessageSummarize](https://github.com/qvink/SillyTavern-MessageSummarize)** by Qvink - Summarization system design and message processing logic

Their open-source contributions made this extension possible. 🙏

## License

MIT License - See [LICENSE](LICENSE) for details.
