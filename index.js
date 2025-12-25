// Context Truncator with Summarization
// Based on Qvink Memory by Qvink, simplified and adapted for context truncation

import {
    getStringHash,
    debounce,
    trimToEndSentence,
} from '../../../utils.js';

import {
    animation_duration,
    scrollChatToBottom,
    saveSettingsDebounced,
    getMaxContextSize,
    streamingProcessor,
    amount_gen,
    extension_prompt_roles,
    extension_prompt_types,
    chat_metadata,
} from '../../../../script.js';

import { 
    getContext, 
    extension_settings, 
    saveMetadataDebounced 
} from '../../../extensions.js';

import { itemizedPrompts } from '../../../../scripts/itemized-prompts.js';

export { MODULE_NAME };

// Module constants
const MODULE_NAME = 'context_truncator';
const MODULE_NAME_FANCY = 'Context Truncator';

// Default settings
const default_settings = {
    enabled: true,
    target_context_size: 8000,      // Target size in tokens
    batch_size: 20,                 // Messages per batch
    min_messages_to_keep: 10,       // Safety limit
    
    // Summarization settings
    auto_summarize: true,
    summary_prompt: `Summarize the following message in a single, concise sentence. Include names when possible. Response must be in past tense and contain ONLY the summary.

Message to summarize:
{{message}}`,
    summary_injection_separator: "\n* ",
    summary_injection_template: "[Following is a list of earlier events]:\n{{summaries}}\n",
    
    // Injection settings
    injection_position: extension_prompt_types.IN_PROMPT,
    injection_depth: 2,
    injection_role: extension_prompt_roles.SYSTEM,
    
    debug_mode: false,
};

// Global state
let TRUNCATION_INDEX = null;  // Current truncation position

// Utility functions
function log(...args) {
    console.log(`[${MODULE_NAME_FANCY}]`, ...args);
}

function debug(...args) {
    if (get_settings('debug_mode')) {
        console.log(`[${MODULE_NAME_FANCY}][DEBUG]`, ...args);
    }
}

function error(...args) {
    console.error(`[${MODULE_NAME_FANCY}]`, ...args);
    toastr.error(Array.from(arguments).join(' '), MODULE_NAME_FANCY);
}

// Settings management
function initialize_settings() {
    if (!extension_settings[MODULE_NAME]) {
        log('Initializing settings...');
        extension_settings[MODULE_NAME] = structuredClone(default_settings);
    }
}

function get_settings(key) {
    return extension_settings[MODULE_NAME]?.[key] ?? default_settings[key];
}

function set_settings(key, value) {
    extension_settings[MODULE_NAME][key] = value;
    saveSettingsDebounced();
}

// Token counting
function count_tokens(text, padding = 0) {
    const ctx = getContext();
    return ctx.getTokenCount(text, padding);
}

// Message data management (stores summaries and flags on messages)
function set_data(message, key, value) {
    if (message?.extra?.[MODULE_NAME]?.[key] === value) return;
    
    if (!message.extra) {
        message.extra = {};
    }
    if (!message.extra[MODULE_NAME]) {
        message.extra[MODULE_NAME] = {};
    }
    
    message.extra[MODULE_NAME][key] = value;
    
    // Also save on current swipe
    let swipe_index = message.swipe_id;
    if (swipe_index && message.swipe_info?.[swipe_index]) {
        if (!message.swipe_info[swipe_index].extra) {
            message.swipe_info[swipe_index].extra = {};
        }
        message.swipe_info[swipe_index].extra[MODULE_NAME] = structuredClone(message.extra[MODULE_NAME]);
    }
}

function get_data(message, key) {
    return message?.extra?.[MODULE_NAME]?.[key];
}

function get_memory(message) {
    return get_data(message, 'memory') ?? "";
}

// Previous prompt detection
function normalize_raw_prompt(raw_prompt) {
    if (Array.isArray(raw_prompt)) {
        return raw_prompt.map(x => x.content).join('\n');
    }
    return raw_prompt;
}

function get_last_prompt_raw() {
    const ctx = getContext();
    const last_index = ctx.chat.length - 1;
    let raw_prompt = undefined;
    
    for (let i = itemizedPrompts.length - 1; i >= 0; i--) {
        let itemized_prompt = itemizedPrompts[i];
        if (itemized_prompt.mesId === last_index) {
            raw_prompt = itemized_prompt.rawPrompt;
            break;
        }
    }
    
    if (raw_prompt === undefined) {
        return undefined;
    }
    
    return normalize_raw_prompt(raw_prompt);
}

function get_previous_prompt_size() {
    let raw_prompt = get_last_prompt_raw();
    
    if (!raw_prompt) {
        debug('No previous prompt found');
        return 0;
    }
    
    const size = count_tokens(raw_prompt);
    debug(`Previous prompt size: ${size} tokens`);
    return size;
}

// Truncation index management
function load_truncation_index() {
    debug(`Loading truncation index from metadata`);
    if (chat_metadata?.[MODULE_NAME]?.truncation_index !== undefined) {
        TRUNCATION_INDEX = chat_metadata[MODULE_NAME].truncation_index;
        debug(`Loaded truncation index: ${TRUNCATION_INDEX}`);
    } else {
        debug(`No truncation index found`);
    }
}

function save_truncation_index() {
    if (!chat_metadata[MODULE_NAME]) {
        chat_metadata[MODULE_NAME] = {};
    }
    chat_metadata[MODULE_NAME].truncation_index = TRUNCATION_INDEX;
    chat_metadata[MODULE_NAME].target_size = get_settings('target_context_size');
    debug(`Saved truncation index: ${TRUNCATION_INDEX}`);
    saveMetadataDebounced();
}

function reset_truncation_index() {
    debug('Resetting truncation index');
    TRUNCATION_INDEX = null;
    save_truncation_index();
}

function should_recalculate_truncation() {
    // Recalculate if target size changed
    const savedTargetSize = chat_metadata?.[MODULE_NAME]?.target_size;
    const currentTargetSize = get_settings('target_context_size');
    
    if (savedTargetSize !== undefined && savedTargetSize !== currentTargetSize) {
        debug(`Target size changed from ${savedTargetSize} to ${currentTargetSize}, forcing recalculation`);
        return true;
    }
    
    return false;
}

// Calculate truncation index based on target context size
function calculate_truncation_index() {
    const ctx = getContext();
    const chat = ctx.chat;
    const targetSize = get_settings('target_context_size');
    const batchSize = get_settings('batch_size');
    const minKeep = get_settings('min_messages_to_keep');
    
    // Use current context size from intercept
    const currentPromptSize = CURRENT_CONTEXT_SIZE;
    
    if (currentPromptSize === 0) {
        debug('No context size available, cannot calculate truncation');
        return 0;
    }
    
    // Calculate chat history size (sum of all NON-TRUNCATED message tokens)
    let chatHistorySize = 0;
    let messageCount = 0;
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].is_system) {
            // Only count messages that are currently in context (not lagging)
            const isLagging = get_data(chat[i], 'lagging');
            if (!isLagging) {
                chatHistorySize += count_tokens(chat[i].mes);
                messageCount++;
            }
        }
    }
    
    // Calculate system prompt overhead (everything except chat history)
    const systemOverhead = currentPromptSize - chatHistorySize;
    
    // Calculate target chat history size
    const targetChatHistorySize = targetSize - systemOverhead;
    
    debug(`Calculating truncation index:`);
    debug(`  Current full prompt: ${currentPromptSize} tokens`);
    debug(`  Current chat history (non-truncated): ${chatHistorySize} tokens`);
    debug(`  System overhead: ${systemOverhead} tokens`);
    debug(`  Target full: ${targetSize} tokens`);
    debug(`  Target chat history: ${targetChatHistorySize} tokens`);
    
    // If chat history is under target, no truncation needed
    if (chatHistorySize <= targetChatHistorySize) {
        debug('Chat history under target, no truncation needed');
        return 0;
    }
    
    // Calculate how many tokens to remove from chat history
    const tokensToRemove = chatHistorySize - targetChatHistorySize;
    debug(`  Need to remove ${tokensToRemove} tokens from chat history`);
    
    // Calculate average tokens per message (from non-truncated messages)
    const avgTokensPerMessage = messageCount > 0 ? chatHistorySize / messageCount : 0;
    debug(`  Average tokens per message: ${avgTokensPerMessage.toFixed(0)}`);
    
    // Estimate messages to truncate
    const messagesToTruncate = Math.ceil(tokensToRemove / avgTokensPerMessage);
    debug(`  Estimated messages to truncate: ${messagesToTruncate}`);
    
    // Round up to nearest batch
    const batchesToTruncate = Math.ceil(messagesToTruncate / batchSize);
    
    // Calculate new index (add to existing truncation)
    const currentTruncationIndex = TRUNCATION_INDEX || 0;
    const newIndex = Math.min(
        currentTruncationIndex + (batchesToTruncate * batchSize),
        Math.max(chat.length - minKeep, 0)
    );
    
    debug(`  Current truncation index: ${currentTruncationIndex}`);
    debug(`  New truncation index: ${newIndex} (adding ${batchesToTruncate} batches)`);
    return newIndex;
}

// Update message inclusion flags (determines which messages to keep/exclude)
function update_message_inclusion_flags() {
    const ctx = getContext();
    const chat = ctx.chat;
    
    debug("Updating message inclusion flags");
    
    // Load truncation index
    if (TRUNCATION_INDEX === null) {
        load_truncation_index();
    }
    
    // Force recalculation if target size changed
    if (should_recalculate_truncation()) {
        debug('Forcing recalculation due to settings change');
        TRUNCATION_INDEX = null;
    }
    
    // Calculate new truncation index if needed
    if (TRUNCATION_INDEX === null || TRUNCATION_INDEX === 0) {
        TRUNCATION_INDEX = calculate_truncation_index();
        save_truncation_index();
    }
    
    debug(`Truncation index: ${TRUNCATION_INDEX}`);
    
    // Mark messages as lagging (excluded) or not
    for (let i = 0; i < chat.length; i++) {
        const lagging = i < TRUNCATION_INDEX;
        set_data(chat[i], 'lagging', lagging);
        
        // If lagging and has no summary, mark for summarization
        if (lagging && !get_memory(chat[i]) && !chat[i].is_system) {
            set_data(chat[i], 'needs_summary', true);
        }
    }
}

// Concatenate summaries
function concatenate_summaries(indexes) {
    const ctx = getContext();
    const chat = ctx.chat;
    const separator = get_settings('summary_injection_separator');
    
    let summary = "";
    for (let i of indexes) {
        const memory = get_memory(chat[i]);
        if (memory) {
            summary += separator + memory;
        }
    }
    
    return summary;
}

// Collect messages that need summaries injected
function collect_summary_indexes() {
    const ctx = getContext();
    const chat = ctx.chat;
    const indexes = [];
    
    for (let i = 0; i < chat.length; i++) {
        const lagging = get_data(chat[i], 'lagging');
        const memory = get_memory(chat[i]);
        
        if (lagging && memory) {
            indexes.push(i);
        }
    }
    
    return indexes;
}

// Get summary injection text
function get_summary_injection() {
    const indexes = collect_summary_indexes();
    
    if (indexes.length === 0) {
        return "";
    }
    
    const summaries = concatenate_summaries(indexes);
    const template = get_settings('summary_injection_template');
    
    return template.replace('{{summaries}}', summaries);
}

// Refresh memory state (called before generation)
function refresh_memory() {
    const ctx = getContext();
    
    if (!get_settings('enabled')) {
        ctx.setExtensionPrompt(`${MODULE_NAME}_summaries`, "");
        return;
    }
    
    debug("Refreshing memory");
    
    // Update which messages to keep/exclude
    update_message_inclusion_flags();
    
    // Get summary injection text
    const injection = get_summary_injection();
    
    // Inject summaries
    ctx.setExtensionPrompt(
        `${MODULE_NAME}_summaries`,
        injection,
        get_settings('injection_position'),
        get_settings('injection_depth'),
        false,
        get_settings('injection_role')
    );
    
    debug(`Injected ${collect_summary_indexes().length} summaries`);
}

// Global variable to store context size from intercept
let CURRENT_CONTEXT_SIZE = 0;

// Message interception hook (called by SillyTavern before generation)
globalThis.truncator_intercept_messages = function (chat, contextSize, abort, type) {
    if (!get_settings('enabled')) {
        return chat;
    }
    
    // Store context size for calculation
    CURRENT_CONTEXT_SIZE = contextSize;
    
    // Refresh memory state (calculates truncation, sets flags)
    refresh_memory();
    
    debug(`Intercepting messages. Type: ${type}, Context: ${contextSize}`);
    
    // Determine which messages to process
    let start = chat.length - 1;
    if (type === 'continue') start--;
    
    // Get IGNORE_SYMBOL
    const ctx = getContext();
    const IGNORE_SYMBOL = ctx.symbols.ignore;
    
    // Mark messages with IGNORE_SYMBOL based on lagging flag
    for (let i = start; i >= 0; i--) {
        delete chat[i].extra?.ignore_formatting;
        
        const message = chat[i];
        const lagging = get_data(message, 'lagging');
        
        chat[i] = structuredClone(chat[i]);
        chat[i].extra[IGNORE_SYMBOL] = !lagging;  // TRUE = keep, FALSE = ignore
    }
    
    debug(`Applied IGNORE_SYMBOL based on lagging flags`);
    
    return chat;
};

// Summarization functionality
class SummaryQueue {
    constructor() {
        this.queue = [];
        this.active = false;
    }
    
    async summarize(indexes) {
        if (!Array.isArray(indexes)) {
            indexes = [indexes];
        }
        
        for (let index of indexes) {
            this.queue.push(index);
        }
        
        if (!this.active) {
            await this.process();
        }
    }
    
    async process() {
        this.active = true;
        
        while (this.queue.length > 0) {
            const index = this.queue.shift();
            await this.summarize_message(index);
        }
        
        this.active = false;
    }
    
    async summarize_message(index) {
        const ctx = getContext();
        const message = ctx.chat[index];
        
        if (!message || message.is_system) {
            return;
        }
        
        debug(`Summarizing message ${index}...`);
        
        // Create summary prompt
        const prompt_template = get_settings('summary_prompt');
        const prompt = prompt_template.replace('{{message}}', message.mes);
        
        // Generate summary
        try {
            const messages = [{
                role: 'system',
                content: prompt
            }];
            
            const result = await ctx.generateRaw(prompt, '', false, false);
            
            if (result) {
                let summary = result;
                
                // Trim incomplete sentences if enabled
                if (ctx.powerUserSettings.trim_sentences) {
                    summary = trimToEndSentence(summary);
                }
                
                // Store summary
                set_data(message, 'memory', summary);
                set_data(message, 'needs_summary', false);
                set_data(message, 'hash', getStringHash(message.mes));
                
                debug(`Summarized message ${index}: "${summary}"`);
            }
        } catch (e) {
            error(`Failed to summarize message ${index}:`, e);
            set_data(message, 'error', String(e));
        }
        
        // Refresh memory after summarization
        refresh_memory();
    }
}

const summaryQueue = new SummaryQueue();

// Auto-summarization
async function auto_summarize_chat() {
    const ctx = getContext();
    const chat = ctx.chat;
    
    if (!get_settings('auto_summarize')) {
        return;
    }
    
    debug('Auto-summarizing chat...');
    
    // Find messages that need summaries
    const to_summarize = [];
    for (let i = 0; i < chat.length; i++) {
        if (get_data(chat[i], 'needs_summary')) {
            to_summarize.push(i);
        }
    }
    
    if (to_summarize.length > 0) {
        debug(`Auto-summarizing ${to_summarize.length} messages`);
        await summaryQueue.summarize(to_summarize);
    }
}

// Event listeners
function register_event_listeners() {
    log('Registering event listeners...');
    
    const ctx = getContext();
    const eventSource = ctx.eventSource;
    const event_types = ctx.event_types;
    
    let currentChatId = null;
    
    // Reset truncation when switching chats
    eventSource.on(event_types.CHAT_CHANGED, () => {
        const newChatId = ctx.chatId;
        if (currentChatId !== null && currentChatId !== newChatId) {
            debug('Chat switched, loading truncation index');
            TRUNCATION_INDEX = null;
            load_truncation_index();
        }
        currentChatId = newChatId;
        refresh_memory();
    });
    
    // Reset when messages deleted
    eventSource.on(event_types.MESSAGE_DELETED, () => {
        reset_truncation_index();
        refresh_memory();
    });
    
    // Auto-summarize on new messages
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (id) => {
        if (streamingProcessor && !streamingProcessor.isFinished) return;
        await auto_summarize_chat();
    });
    
    eventSource.on(event_types.USER_MESSAGE_RENDERED, async (id) => {
        await auto_summarize_chat();
    });
}

// UI binding
function bind_setting(selector, key, type = 'text') {
    const element = $(selector);
    
    if (element.length === 0) {
        error(`No element found for selector [${selector}]`);
        return;
    }
    
    // Set initial value
    if (type === 'boolean') {
        element.prop('checked', get_settings(key));
    } else {
        element.val(get_settings(key));
    }
    
    // Listen for changes
    element.on('change', function() {
        let value;
        if (type === 'boolean') {
            value = $(this).prop('checked');
        } else if (type === 'number') {
            value = Number($(this).val());
        } else {
            value = $(this).val();
        }
        
        debug(`Setting [${key}] changed to [${value}]`);
        set_settings(key, value);
        refresh_memory();
    });
}

function initialize_ui_listeners() {
    log('Initializing UI listeners...');
    
    bind_setting('#ct_enabled', 'enabled', 'boolean');
    bind_setting('#ct_target_size', 'target_context_size', 'number');
    bind_setting('#ct_batch_size', 'batch_size', 'number');
    bind_setting('#ct_min_keep', 'min_messages_to_keep', 'number');
    bind_setting('#ct_auto_summarize', 'auto_summarize', 'boolean');
    bind_setting('#ct_debug', 'debug_mode', 'boolean');
    
    // Reset button
    $('#ct_reset').on('click', () => {
        reset_truncation_index();
        toastr.info('Truncation index reset', MODULE_NAME_FANCY);
    });
    
    // Summarize all button
    $('#ct_summarize_all').on('click', async () => {
        const ctx = getContext();
        const chat = ctx.chat;
        const indexes = [];
        
        for (let i = 0; i < chat.length; i++) {
            if (!chat[i].is_system && !get_memory(chat[i])) {
                indexes.push(i);
            }
        }
        
        if (indexes.length > 0) {
            toastr.info(`Summarizing ${indexes.length} messages...`, MODULE_NAME_FANCY);
            await summaryQueue.summarize(indexes);
            toastr.success('Summarization complete', MODULE_NAME_FANCY);
        } else {
            toastr.info('All messages already summarized', MODULE_NAME_FANCY);
        }
    });
}

// Load settings HTML
async function load_settings_html() {
    log('Loading settings HTML...');
    
    const module_dir = new URL(import.meta.url).pathname;
    const settings_path = module_dir.substring(0, module_dir.lastIndexOf('/')) + '/settings.html';
    
    await $.get(settings_path).then(response => {
        $('#extensions_settings2').append(response);
        log('Settings HTML loaded');
    }).catch(err => {
        error('Failed to load settings HTML:', err);
    });
}

// Entry point
jQuery(async function () {
    log('Loading Context Truncator with Summarization...');
    
    // Initialize
    initialize_settings();
    
    // Load settings HTML
    await load_settings_html();
    
    // Setup UI and events
    initialize_ui_listeners();
    register_event_listeners();
    
    log('Context Truncator loaded successfully');
});
