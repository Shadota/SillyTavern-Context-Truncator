# SillyTavern Context Truncator with Summarization

Intelligent context management with AI-powered summarization and batch-based truncation to prevent cache invalidation when using LLMs with caching support.

## Credits

This extension is built on the excellent foundation of [**Qvink Memory (MessageSummarize)**](https://github.com/qvink/SillyTavern-MessageSummarize) by **Qvink**. The core summarization functionality, connection profile management, and token-based truncation calculations are adapted from their work. This extension simplifies and focuses on context truncation with optional summarization, while MessageSummarize offers a full-featured memory management system.

**Thank you to Qvink for the heavy lifting!**

## Purpose

When using LLMs with caching (like Claude), removing messages one-by-one invalidates the cache on every generation, causing slower responses and higher costs. This extension intelligently manages context by:

1. **Summarizing** older messages using AI to preserve narrative continuity
2. **Truncating** in fixed batches to minimize cache invalidation
3. **Targeting** a specific context size for predictable behavior

## How It Works

1. **Monitors** the previous prompt size using SillyTavern's raw context API
2. **Detects** when the context exceeds your target size
3. **Summarizes** older messages using AI (optional but recommended)
4. **Removes** N messages at once (batch truncation) from active context
5. **Injects** summaries as extension prompts to maintain narrative continuity
6. **Learns** from each generation to improve accuracy over time
7. **Preserves** a minimum number of recent messages for safety
8. **Displays** real-time accuracy metrics with color-coded feedback

## Installation

1. Open SillyTavern
2. Go to **Extensions** > **Install Extension**
3. Enter: `https://github.com/Shadota/SillyTavern-Context-Truncator`
4. Click **Install**

## Configuration

### Core Settings

- **Enable Extension**: Toggle the extension on/off
- **Target Context Size**: The target size (in tokens) to maintain (default: 42000)
- **Batch Size**: Number of messages to remove per batch (default: 20)
- **Min Messages to Keep**: Safety limit - never go below this many messages (default: 10)

### Summarization Settings

- **Enable Summarization**: Toggle AI summarization on/off (recommended)
- **Connection Profile**: Choose a different model for summarization (optional)
  - Select "Same as Current" to use your main model
  - Select a different profile to enable **background summarization** while roleplaying
  - Allows using a faster/cheaper model for summaries while using a premium model for roleplay
- **Maximum Words per Summary**: Word limit for each summary (default: 50)
- **Summary Prompt**: Custom prompt for the AI summarizer (uses character's persona)
- **Summary Position**: Where to inject summaries (After Main Prompt, After Character Definitions, etc.)
- **Summary Depth**: How many messages to include per summary (default: 1)
- **Auto-Summarize**: Automatically summarize when new messages arrive

### Advanced Settings

- **Debug Mode**: Enable detailed logging to browser console
- **Streaming**: Enable streaming for summary generation

### Status Display

After each generation, the extension displays:
- **Actual**: The actual prompt size in tokens
- **Target**: Your configured target size
- **Difference**: How many tokens over/under target
- **Error**: Percentage error from target

**Color Coding:**
- 🟢 **Green**: Within 5% of target (excellent accuracy)
- 🟡 **Yellow**: Within 20% of target (good accuracy)
- 🔴 **Red**: Over 20% from target (needs adjustment)

### Controls

- **Reset Truncation**: Resets the truncation index and clears summaries

## Example Scenario

**Setup:**
- Target context: 45000 tokens
- Batch size: 20 messages
- Min keep: 10 messages
- Summarization: Enabled
- Chat has 400+ messages

**Execution:**
1. **Generation 1** (Initial Learning):
   - Actual: 35932 tokens
   - Target: 45000 tokens
   - Error: 20.2% (under target) 🔴
   - System learns correction factor: 0.898

2. **Generation 2** (Adapting):
   - Actual: 37730 tokens
   - Target: 45000 tokens
   - Error: 16.2% (under target) 🟡
   - System refines correction factor: 0.826

3. **Generation 3** (Converging):
   - Actual: 39381 tokens
   - Target: 45000 tokens
   - Error: 12.5% (under target) 🟡
   - Correction factor stabilizes

4. **Generation 4+** (Stable):
   - Actual: 39771 tokens
   - Target: 45000 tokens
   - Error: 11.6% (under target) 🟡
   - **Cache preserved!** ✓

**Status Display Example:**
```
Last Generation:
Actual: 39,771 tokens
Target: 45,000 tokens
Difference: -5,229 tokens
Error: 11.6%
```
(Displayed in yellow background)

**Note:** The extension learns and improves accuracy over 2-3 generations. First generation uses estimates and may be less accurate.

## Key Features

- **Adaptive Learning**: Learns from each generation to improve accuracy over time
- **Narrative Continuity**: AI summaries preserve story context even after truncation
- **Background Summarization**: Use a different model for summaries while roleplaying
- **Cache Efficiency**: 20x fewer cache invalidations (removing 20 at once vs 1 at a time)
- **Predictable Behavior**: Always removes fixed batches, not variable amounts
- **Real-time Feedback**: Color-coded status display shows actual vs target with accuracy metrics
- **Safety**: Minimum message setting prevents over-truncation
- **Automatic**: Works seamlessly in the background
- **Flexible**: Can be used with or without summarization

## Background Summarization

The extension supports using a different model for summarization than your main roleplay model. This enables:

- **Cost Optimization**: Use a cheaper model (e.g., GPT-4o-mini) for summaries while using a premium model (e.g., Claude Opus) for roleplay
- **Speed**: Use a faster model for summaries to reduce wait time
- **Independence**: Summarize in the background without interrupting your main conversation

**How to use:**
1. Set up multiple connection profiles in SillyTavern's Connection Manager
2. In the extension settings, select a different profile for "Connection Profile"
3. The extension will automatically switch to that profile when summarizing
4. Your main roleplay will continue using your primary profile

**Example Setup:**
- Main Profile: Claude Opus (for high-quality roleplay)
- Summary Profile: GPT-4o-mini (for fast, cheap summaries)
- Result: Best of both worlds - premium roleplay with efficient summarization

## Performance

- **First Generation**: ~20% error (learning phase)
- **Second Generation**: ~15% error (adapting)
- **Third+ Generations**: ~10-12% error (stable)
- **Cache Preservation**: Maintained after convergence

## Requirements

- SillyTavern v1.14.0 or higher

## Troubleshooting

### Extension not loading
- Make sure you're on SillyTavern v1.14.0 or higher
- Check browser console (F12) for errors
- Try reloading the page

### Truncation not working
- Enable **Debug Mode** in settings
- Check browser console for debug logs
- Verify **Enable Extension** is checked
- Check that **Target Context Size** is set appropriately
- Ensure you have at least one generation after enabling

### Status display not showing
- Wait for a message to be generated first
- The display only appears after the first generation
- Check that the extension is enabled

### Accuracy issues (high error percentage)
- **First generation is always less accurate** (~20% error) as the system learns
- **Accuracy improves over 2-3 generations** as the adaptive system converges
- **Typical stable accuracy**: 10-15% error (conservative, under target)
- Batch size affects accuracy - smaller batches = more precise but more cache invalidations
- Click "Reset Truncation" to restart the learning process if needed

### Summarization not working
- Verify **Enable Summarization** is checked
- Check that you have an active AI connection
- Enable **Debug Mode** to see summary generation logs
- Ensure **Summary Prompt** is not empty

## License

MIT License - See LICENSE file for details

## Author

Shadota

## Contributing

Issues and pull requests welcome at: https://github.com/Shadota/SillyTavern-Context-Truncator