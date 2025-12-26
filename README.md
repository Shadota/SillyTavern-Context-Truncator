# SillyTavern Context Truncator with Summarization

Intelligent context management with AI-powered summarization and batch-based truncation to prevent cache invalidation when using LLMs with caching support.

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
6. **Preserves** a minimum number of recent messages for safety
7. **Tracks** actual prompt size and displays accuracy metrics

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
- Target context: 42000 tokens
- Batch size: 20 messages
- Min keep: 10 messages
- Summarization: Enabled
- Chat has 100 messages

**Execution:**
1. **Generation 1**: Context = 38000 tokens → No action needed
2. **Generation 2**: Context = 43500 tokens → Exceeds target
   - Remove messages 0-19 (batch 1) from active context
   - Generate AI summary of removed messages
   - Inject summary as extension prompt
3. **Generation 3**: Context = 42318 tokens → Within target (1.7% error) 🟢
4. **Generation 4**: Context = 42771 tokens → Within target (1.8% error) 🟢
5. **Generation 5+**: Context stays near 42000 → **Cache preserved!**

**Status Display Example:**
```
Last Generation:
Actual: 42,318 tokens
Target: 42,000 tokens
Difference: +318 tokens
Error: 0.8%
```
(Displayed in green background)

## Benefits

- **Narrative Continuity**: AI summaries preserve story context even after truncation
- **Cache Efficiency**: 20x fewer cache invalidations (removing 20 at once vs 1 at a time)
- **Accurate Targeting**: Typically within 5% of target size for primary use cases
- **Predictable Behavior**: Always removes fixed batches, not variable amounts
- **Safety**: Minimum message setting prevents over-truncation
- **Transparency**: Color-coded status display shows actual vs target with accuracy metrics
- **Automatic**: Works seamlessly in the background
- **Flexible**: Can be used with or without summarization

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
- The extension is most accurate around 42000 tokens (primary use case)
- Lower or higher targets may have larger variance
- Batch size affects accuracy - smaller batches = more precise but more cache invalidations
- First generation after reset uses a 15% estimate and may be less accurate

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