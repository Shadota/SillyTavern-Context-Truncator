# CacheGuard - Smart Context Management for SillyTavern

**Never lose your story's continuity again.** CacheGuard intelligently manages your context window to make sure your long roleplays will last with minimal performance impact!

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

## Installation

1. Download or clone this repository
2. Place the folder in your SillyTavern `data/default-user/extensions/` directory
3. Restart SillyTavern
4. Enable "CacheGuard" in Extensions

## Quick Start

1. **Enable Context Truncator** in the Truncation tab
2. Set your **Target Size** (or enable Auto-Calibration)
3. Optionally configure **Auto-Summarize** with an OpenAI-compatible endpoint
4. For vector memory, configure **Qdrant** connection in the Qdrant Memory tab

## Configuration Overview

| Setting | Description | Default |
|---------|-------------|---------|
| Target Size | Token limit before truncation kicks in | 8000 |
| Auto-Calibrate | Automatically tune target based on actual usage | On |
| Target Utilization | Percentage of max context to use | 80% |
| Auto-Summarize | Generate summaries for truncated messages | Off |
| Qdrant Memory | Enable vector-based memory retrieval | Off |

## Credits & Acknowledgments

This extension builds upon excellent prior work:

- **[st-qdrant-memory](https://github.com/HO-git/st-qdrant-memory)** by HO-git - Vector memory architecture and Qdrant integration patterns
- **[SillyTavern-MessageSummarize](https://github.com/qvink/SillyTavern-MessageSummarize)** by Qvink - Summarization system design and message processing logic

Their open-source contributions made this extension possible. 🙏

## License

MIT License - See [LICENSE](LICENSE) for details.
