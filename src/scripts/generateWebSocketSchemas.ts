import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import all WebSocket contract schemas
import {
  baseInputMessageSchema,
  baseOutputMessageSchema,
  sessionInputMessageSchema,
  sessionOutputMessageSchema,
} from '../websocket/contracts/common';

import { authRequestSchema, authResponseSchema, projectSettingsSchema } from '../websocket/contracts/auth';

import {
  startConversationRequestSchema,
  startConversationResponseSchema,
  resumeConversationRequestSchema,
  resumeConversationResponseSchema,
  endConversationRequestSchema,
  endConversationResponseSchema,
} from '../websocket/contracts/session';

import {
  startUserVoiceInputRequestSchema,
  startUserVoiceInputResponseSchema,
  sendUserVoiceChunkRequestSchema,
  sendUserVoiceChunkResponseSchema,
  endUserVoiceInputRequestSchema,
  endUserVoiceInputResponseSchema,
  sendUserTextInputRequestSchema,
  sendUserTextInputResponseSchema,
} from '../websocket/contracts/userInput';

import {
  goToStageRequestSchema,
  goToStageResponseSchema,
  setVarRequestSchema,
  setVarResponseSchema,
  getVarRequestSchema,
  getVarResponseSchema,
  getAllVarsRequestSchema,
  getAllVarsResponseSchema,
  runActionRequestSchema,
  runActionResponseSchema,
} from '../websocket/contracts/command';

import {
  startAiVoiceOutputMessageSchema,
  sendAiVoiceChunkMessageSchema,
  endAiVoiceOutputMessageSchema,
} from '../websocket/contracts/aiResponse';

/**
 * Generates a single JSON Schema file for all WebSocket contracts.
 * This allows clients in any language to validate messages and generate types.
 */
function generateWebSocketSchemas(): void {
  const outputDir = join(__dirname, '../../schemas');

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  // Define all schemas to export with their names and categories
  const schemas: Record<string, any> = {
    // Base schemas
    'base-input-message': baseInputMessageSchema,
    'base-output-message': baseOutputMessageSchema,
    'session-input-message': sessionInputMessageSchema,
    'session-output-message': sessionOutputMessageSchema,

    // Authentication
    'auth-request': authRequestSchema,
    'auth-response': authResponseSchema,
    'project-settings': projectSettingsSchema,

    // Session lifecycle
    'start-conversation-request': startConversationRequestSchema,
    'start-conversation-response': startConversationResponseSchema,
    'resume-conversation-request': resumeConversationRequestSchema,
    'resume-conversation-response': resumeConversationResponseSchema,
    'end-conversation-request': endConversationRequestSchema,
    'end-conversation-response': endConversationResponseSchema,

    // User input
    'start-user-voice-input-request': startUserVoiceInputRequestSchema,
    'start-user-voice-input-response': startUserVoiceInputResponseSchema,
    'send-user-voice-chunk-request': sendUserVoiceChunkRequestSchema,
    'send-user-voice-chunk-response': sendUserVoiceChunkResponseSchema,
    'end-user-voice-input-request': endUserVoiceInputRequestSchema,
    'end-user-voice-input-response': endUserVoiceInputResponseSchema,
    'send-user-text-input-request': sendUserTextInputRequestSchema,
    'send-user-text-input-response': sendUserTextInputResponseSchema,

    // Commands
    'go-to-stage-request': goToStageRequestSchema,
    'go-to-stage-response': goToStageResponseSchema,
    'set-var-request': setVarRequestSchema,
    'set-var-response': setVarResponseSchema,
    'get-var-request': getVarRequestSchema,
    'get-var-response': getVarResponseSchema,
    'get-all-vars-request': getAllVarsRequestSchema,
    'get-all-vars-response': getAllVarsResponseSchema,
    'run-action-request': runActionRequestSchema,
    'run-action-response': runActionResponseSchema,

    // AI responses
    'start-ai-voice-output': startAiVoiceOutputMessageSchema,
    'send-ai-voice-chunk': sendAiVoiceChunkMessageSchema,
    'end-ai-voice-output': endAiVoiceOutputMessageSchema,
  };

  // Generate all schemas into a single file
  const allSchemas: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    allSchemas[name] = schema.toJSONSchema();
  }

  const outputPath = join(outputDir, 'websocket-contracts.json');
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'https://nexus-backend.utter.one/schemas/websocket-contracts.json',
        title: 'WebSocket Message Contracts',
        description: 'JSON Schema definitions for all WebSocket message types in the Nexus Backend API',
        version: '1.0.0',
        definitions: allSchemas,
      },
      null,
      2,
    ),
  );
  console.log(`Generated: ${outputPath}`);

  console.log(`\n✅ Successfully generated WebSocket contracts schema with ${Object.keys(schemas).length} message types`);
}

// Run the generator
generateWebSocketSchemas();
