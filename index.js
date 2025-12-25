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

// Truncation logic
function reset_truncation_index() {
    debug('Resetting truncation index');
    TRUNCATION_INDEX = null;
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
    
    for (let i = truncateUpTo; i < chat.length; i++) {
        if (!chat[i].is_system) {
            total += count_tokens(chat[i].mes);
        }
    }
    
    // Add overhead estimate for system prompts, etc.
    total += 500;
    
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

function perform_batch_truncation(chat) {
    const batchSize = get_settings('batch_size');
    const minKeep = get_settings('min_messages_to_keep');
    const targetSize = get_settings('target_context_size');
    
    // Initialize truncation index if not set
    if (TRUNCATION_INDEX === null) {
        TRUNCATION_INDEX = 0;
    }
    
    const chatLength = chat.length;
    const maxTruncateUpTo = Math.max(chatLength - minKeep, 0);
    
    debug(`Starting batch truncation. Chat length: ${chatLength}, Max truncate: ${maxTruncateUpTo}`);
    
    // Keep trimming in batches until we're under the target
    let currentSize = get_previous_prompt_size();
    
    while (currentSize > targetSize && TRUNCATION_INDEX < maxTruncateUpTo) {
        // Advance truncation index by batch size
        const newIndex = Math.min(TRUNCATION_INDEX + batchSize, maxTruncateUpTo);
        
        debug(`Truncating batch: index ${TRUNCATION_INDEX} -> ${newIndex}`);
        
        TRUNCATION_INDEX = newIndex;
        
        // Recalculate size after this batch
        currentSize = estimate_size_after_truncation(chat, TRUNCATION_INDEX);
        
        debug(`Estimated size after truncation: ${currentSize} tokens`);
    }
    
    // Apply truncation to chat
    return apply_truncation(chat, TRUNCATION_INDEX);
}

// Message interception hook (called by SillyTavern before generation)
globalThis.truncator_intercept_messages = function (chat, contextSize, abort, type) {
    if (!get_settings('enabled')) {
        return chat;
    }
    
    debug(`Intercepting messages. Type: ${type}, Context: ${contextSize}`);
    
    // Check if we need to truncate based on previous prompt
    if (should_truncate()) {
        debug('Truncation needed, performing batch truncation');
        return perform_batch_truncation(chat);
    }
    
    // Apply existing truncation if any
    if (TRUNCATION_INDEX !== null && TRUNCATION_INDEX > 0) {
        debug(`Applying existing truncation index: ${TRUNCATION_INDEX}`);
        return apply_truncation(chat, TRUNCATION_INDEX);
    }
    
    return chat;
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
    
    // Color coding
    if (currentSize > targetSize) {
        $('#ct_current_size').css('color', 'var(--SmartThemeEmColor)');
    } else {
        $('#ct_current_size').css('color', 'var(--SmartThemeQuoteColor)');
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
    
    // Reset truncation when chat changes
    eventSource.on(event_types.CHAT_CHANGED, () => {
        debug('Chat changed, resetting truncation');
        reset_truncation_index();
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
