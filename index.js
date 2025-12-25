import {
    getStringHash,
    debounce,
} from '../../../utils.js';

import {
    animation_duration,
    scrollChatToBottom,
    saveSettingsDebounced,
    getMaxContextSize,
    main_api,
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
    debug_mode: false,
};

// Global state
let TRUNCATION_INDEX = null;  // Current truncation position
let SYSTEM_OVERHEAD = 500;    // Estimated system prompt overhead (dynamically calculated)

// Load truncation index from chat metadata
function load_truncation_index() {
    const ctx = getContext();
    debug(`Attempting to load truncation index. ctx.chat_metadata[${MODULE_NAME}]:`, ctx.chat_metadata?.[MODULE_NAME]);
    if (ctx.chat_metadata?.[MODULE_NAME]?.truncation_index !== undefined) {
        TRUNCATION_INDEX = ctx.chat_metadata[MODULE_NAME].truncation_index;
        debug(`Loaded truncation index from ctx.chat_metadata: ${TRUNCATION_INDEX}`);
    } else {
        debug(`No truncation index found in ctx.chat_metadata`);
    }
}

// Save truncation index to chat metadata
async function save_truncation_index() {
    const ctx = getContext();
    if (!ctx.chat_metadata) {
        debug(`ERROR: ctx.chat_metadata is undefined!`);
        return;
    }
    if (!ctx.chat_metadata[MODULE_NAME]) {
        ctx.chat_metadata[MODULE_NAME] = {};
    }
    ctx.chat_metadata[MODULE_NAME].truncation_index = TRUNCATION_INDEX;
    debug(`Saved truncation index to ctx.chat_metadata: ${TRUNCATION_INDEX}`);
    await ctx.saveMetadata();
    debug(`Metadata saved to disk`);
}

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
    toastr.error(Array.from(args).join(' '), MODULE_NAME_FANCY);
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

// Calculate the ratio between our token counts and ST's actual prompt size
let MESSAGE_TOKEN_RATIO = 1.0;

// Calculate system overhead by comparing full prompt with message tokens
function calculate_system_overhead(chat, currentTruncationIndex) {
    const previousPromptSize = get_previous_prompt_size();
    
    if (previousPromptSize === 0) {
        return SYSTEM_OVERHEAD; // Use default if no previous prompt
    }
    
    // Count ALL messages (raw count)
    let allMessageTokens = 0;
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].is_system) {
            allMessageTokens += count_tokens(chat[i].mes);
        }
    }
    
    // Calculate the ratio: actual prompt / our raw count
    // This accounts for ST's formatting overhead per message
    if (allMessageTokens > 0) {
        MESSAGE_TOKEN_RATIO = previousPromptSize / allMessageTokens;
        debug(`Message token ratio: ${MESSAGE_TOKEN_RATIO.toFixed(3)} (${previousPromptSize} actual / ${allMessageTokens} raw)`);
    }
    
    // Now count messages from truncation index with the ratio applied
    let keptMessageTokens = 0;
    for (let i = currentTruncationIndex; i < chat.length; i++) {
        if (!chat[i].is_system) {
            keptMessageTokens += count_tokens(chat[i].mes);
        }
    }
    keptMessageTokens *= MESSAGE_TOKEN_RATIO;
    
    // System overhead = total prompt - kept message tokens
    const overhead = previousPromptSize - keptMessageTokens;
    
    debug(`Calculated system overhead: ${overhead.toFixed(0)} tokens (${previousPromptSize} total - ${keptMessageTokens.toFixed(0)} kept messages from index ${currentTruncationIndex})`);
    
    return Math.max(overhead, 500); // Minimum 500 tokens
}

// Truncation logic
function reset_truncation_index() {
    debug('Resetting truncation index');
    TRUNCATION_INDEX = null;
    save_truncation_index();
}

function should_truncate() {
    const previousSize = get_previous_prompt_size();
    const targetSize = get_settings('target_context_size');
    
    const shouldTrunc = previousSize > targetSize;
    debug(`Should truncate: ${shouldTrunc} (${previousSize} > ${targetSize})`);
    
    return shouldTrunc;
}

function estimate_size_after_truncation(chat, truncateUpTo) {
    let total = 0;
    
    // Count messages from truncateUpTo onwards
    for (let i = truncateUpTo; i < chat.length; i++) {
        if (!chat[i].is_system) {
            total += count_tokens(chat[i].mes);
        }
    }
    
    // Apply the ratio to account for ST's formatting overhead
    total *= MESSAGE_TOKEN_RATIO;
    
    // Add dynamically calculated system overhead
    total += SYSTEM_OVERHEAD;
    
    return total;
}

function apply_truncation(chat, truncateUpTo) {
    const IGNORE_SYMBOL = getContext().symbols.ignore;
    
    debug(`Applying truncation up to index ${truncateUpTo}`);
    
    for (let i = 0; i < truncateUpTo && i < chat.length; i++) {
        if (!chat[i].is_system) {
            // Clone to avoid permanent modification
            chat[i] = structuredClone(chat[i]);
            chat[i].extra[IGNORE_SYMBOL] = true;
            
            // Store metadata
            if (!chat[i].extra[MODULE_NAME]) {
                chat[i].extra[MODULE_NAME] = {};
            }
            chat[i].extra[MODULE_NAME].truncated = true;
        }
    }
    
    return chat;
}

function perform_batch_truncation(chat, currentContextSize) {
    const batchSize = get_settings('batch_size');
    const minKeep = get_settings('min_messages_to_keep');
    const targetSize = get_settings('target_context_size');
    
    // Load truncation index from metadata if not already loaded
    if (TRUNCATION_INDEX === null) {
        load_truncation_index();
    }
    
    // Initialize to 0 if still null
    if (TRUNCATION_INDEX === null) {
        TRUNCATION_INDEX = 0;
    }
    
    const chatLength = chat.length;
    const maxTruncateUpTo = Math.max(chatLength - minKeep, 0);
    
    // Use the previous prompt size as our baseline (contextSize is unreliable due to other extensions)
    let currentSize = get_previous_prompt_size();
    debug(`Starting batch truncation. Current size: ${currentSize}, Target: ${targetSize}, Chat length: ${chatLength}, Max truncate: ${maxTruncateUpTo}, Current index: ${TRUNCATION_INDEX}`);
    
    // Calculate how many tokens we need to remove
    const tokensToRemove = currentSize - targetSize;
    
    // Count all message tokens to calculate average tokens per message
    let totalMessageTokens = 0;
    let messageCount = 0;
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].is_system) {
            totalMessageTokens += count_tokens(chat[i].mes);
            messageCount++;
        }
    }
    
    const avgTokensPerMessage = messageCount > 0 ? totalMessageTokens / messageCount : 0;
    debug(`Average tokens per message: ${avgTokensPerMessage.toFixed(0)} (${totalMessageTokens} total / ${messageCount} messages)`);
    
    // Estimate how many messages to truncate based on tokens to remove
    const messagesToTruncate = Math.ceil(tokensToRemove / avgTokensPerMessage);
    debug(`Need to remove ${tokensToRemove} tokens, estimated ${messagesToTruncate} messages`);
    
    // If we need to truncate more
    if (tokensToRemove > 0) {
        // Move forward in batches
        const targetIndex = Math.min(
            TRUNCATION_INDEX + Math.max(messagesToTruncate, batchSize),
            maxTruncateUpTo
        );
        
        debug(`Moving truncation index from ${TRUNCATION_INDEX} to ${targetIndex}`);
        TRUNCATION_INDEX = targetIndex;
    }
    // If we're over-truncated and can un-truncate
    else if (tokensToRemove < 0 && TRUNCATION_INDEX > 0) {
        // We have room to un-truncate
        const messagesToRestore = Math.floor(Math.abs(tokensToRemove) / avgTokensPerMessage);
        const targetIndex = Math.max(
            TRUNCATION_INDEX - Math.max(messagesToRestore, batchSize),
            0
        );
        
        debug(`Moving truncation index backward from ${TRUNCATION_INDEX} to ${targetIndex}`);
        TRUNCATION_INDEX = targetIndex;
    }
    
    // Save the truncation index after adjusting it
    save_truncation_index();
    
    // Apply truncation to chat
    return apply_truncation(chat, TRUNCATION_INDEX);
}

// Message interception hook (called by SillyTavern before generation)
globalThis.truncator_intercept_messages = function (chat, contextSize, abort, type) {
    if (!get_settings('enabled')) {
        return chat;
    }
    
    debug(`Intercepting messages. Type: ${type}, Context: ${contextSize}`);
    
    // ALWAYS run truncation logic to maintain the truncation index
    // This is necessary because we need to re-apply truncation markers each generation
    debug('Running batch truncation logic');
    return perform_batch_truncation(chat, contextSize);
};

// Status display updates
function update_status_display() {
    const currentSize = get_previous_prompt_size();
    const targetSize = get_settings('target_context_size');
    const batchSize = get_settings('batch_size');
    const ctx = getContext();
    const chat = ctx.chat;
    
    $('#ct_current_size').text(currentSize);
    $('#ct_target_display').text(targetSize);
    $('#ct_batch_display').text(batchSize);
    $('#ct_truncation_index').text(TRUNCATION_INDEX ?? 'None');
    $('#ct_total_messages').text(chat.length);
    $('#ct_kept_messages').text(TRUNCATION_INDEX !== null ? chat.length - TRUNCATION_INDEX : chat.length);
    
    // Color coding: Red if >110% of target, Yellow if within ±10%, Green if <90%
    const lowerBound = targetSize * 0.9;   // 90% of target
    const upperBound = targetSize * 1.1;   // 110% of target
    
    if (currentSize > upperBound) {
        // Over 110% of target - RED
        $('#ct_current_size').css('color', '#ff4444');
    } else if (currentSize < lowerBound) {
        // Under 90% of target - GREEN
        $('#ct_current_size').css('color', '#44ff44');
    } else {
        // Within ±10% of target - YELLOW
        $('#ct_current_size').css('color', '#ffdd44');
    }
}

// UI binding
function bind_setting(selector, key, type = 'text', callback = null) {
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
        
        if (callback) {
            callback(value);
        }
        
        update_status_display();
    });
}

function initialize_ui_listeners() {
    log('Initializing UI listeners...');
    
    bind_setting('#ct_enabled', 'enabled', 'boolean');
    bind_setting('#ct_target_size', 'target_context_size', 'number');
    bind_setting('#ct_batch_size', 'batch_size', 'number');
    bind_setting('#ct_min_keep', 'min_messages_to_keep', 'number');
    bind_setting('#ct_debug', 'debug_mode', 'boolean');
    
    // Reset button
    $('#ct_reset').on('click', () => {
        reset_truncation_index();
        update_status_display();
        toastr.info('Truncation index reset', MODULE_NAME_FANCY);
    });
    
    // Refresh status button
    $('#ct_refresh_status').on('click', () => {
        update_status_display();
    });
    
    // Update status periodically
    setInterval(update_status_display, 3000);
}

// Event listeners
function register_event_listeners() {
    log('Registering event listeners...');
    
    const ctx = getContext();
    const eventSource = ctx.eventSource;
    const event_types = ctx.event_types;
    
    // Track the current chat to detect actual chat switches
    let currentChatId = null;
    
    // Reset truncation when switching to a different chat
    eventSource.on(event_types.CHAT_CHANGED, () => {
        const newChatId = ctx.chatId;
        if (currentChatId !== null && currentChatId !== newChatId) {
            debug('Chat switched, loading truncation index for new chat');
            TRUNCATION_INDEX = null;  // Reset to force reload
            load_truncation_index();
        } else {
            debug('Chat changed (same chat), keeping truncation index');
        }
        currentChatId = newChatId;
        update_status_display();
    });
    
    // Reset when messages are deleted
    eventSource.on(event_types.MESSAGE_DELETED, () => {
        debug('Message deleted, resetting truncation');
        reset_truncation_index();
        update_status_display();
    });
    
    // Log generation events for debugging
    eventSource.on(event_types.GENERATION_STARTED, (type) => {
        debug(`Generation started: ${type}`);
        const size = get_previous_prompt_size();
        debug(`Current context size: ${size} tokens`);
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
    log('Loading Context Truncator extension...');
    
    // Initialize
    initialize_settings();
    
    // Load settings HTML
    await load_settings_html();
    
    // Setup UI
    initialize_ui_listeners();
    register_event_listeners();
    
    // Initial status update
    update_status_display();
    
    log('Context Truncator loaded successfully');
});
