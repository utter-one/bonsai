import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import parameter value schemas for reuse
import { parameterValueSchema, imageParameterValueSchema, audioParameterValueSchema } from '../types/parameters';

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
  conversationEventMessageSchema,
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
  userTranscribedChunkMessageSchema
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
  callToolRequestSchema,
  callToolResponseSchema,
} from '../websocket/contracts/command';

import {
  startAiGenerationOutputMessageSchema,
  sendAiVoiceChunkMessageSchema,
  endAiGenerationOutputMessageSchema,
  aiTranscribedChunkMessageSchema,
  sendAiImageOutputMessageSchema,
  sendAiAudioOutputMessageSchema,
} from '../websocket/contracts/aiResponse';

/**
 * Generates a single JSON Schema file for all WebSocket contracts.
 * This allows clients in any language to validate messages and generate types.
 */
function generateWebSocketSchemas(): void {
  const outputDir = join(__dirname, '../../schemas');
  const registry = new OpenAPIRegistry();

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  // Register reusable parameter value schemas first (so they can be referenced)
  registry.register('ImageParameterValue', imageParameterValueSchema);
  registry.register('AudioParameterValue', audioParameterValueSchema);
  registry.register('ParameterValue', parameterValueSchema);

  // Register all message schemas
  registry.register('base-input-message', baseInputMessageSchema);
  registry.register('base-output-message', baseOutputMessageSchema);
  registry.register('session-input-message', sessionInputMessageSchema);
  registry.register('session-output-message', sessionOutputMessageSchema);
  registry.register('auth-request', authRequestSchema);
  registry.register('auth-response', authResponseSchema);
  registry.register('project-settings', projectSettingsSchema);
  registry.register('start-conversation-request', startConversationRequestSchema);
  registry.register('start-conversation-response', startConversationResponseSchema);
  registry.register('resume-conversation-request', resumeConversationRequestSchema);
  registry.register('resume-conversation-response', resumeConversationResponseSchema);
  registry.register('end-conversation-request', endConversationRequestSchema);
  registry.register('end-conversation-response', endConversationResponseSchema);
  registry.register('conversation-event', conversationEventMessageSchema);
  registry.register('start-user-voice-input-request', startUserVoiceInputRequestSchema);
  registry.register('start-user-voice-input-response', startUserVoiceInputResponseSchema);
  registry.register('send-user-voice-chunk-request', sendUserVoiceChunkRequestSchema);
  registry.register('send-user-voice-chunk-response', sendUserVoiceChunkResponseSchema);
  registry.register('end-user-voice-input-request', endUserVoiceInputRequestSchema);
  registry.register('end-user-voice-input-response', endUserVoiceInputResponseSchema);
  registry.register('send-user-text-input-request', sendUserTextInputRequestSchema);
  registry.register('send-user-text-input-response', sendUserTextInputResponseSchema);
  registry.register('user-transcribed-chunk', userTranscribedChunkMessageSchema);
  registry.register('go-to-stage-request', goToStageRequestSchema);
  registry.register('go-to-stage-response', goToStageResponseSchema);
  registry.register('set-var-request', setVarRequestSchema);
  registry.register('set-var-response', setVarResponseSchema);
  registry.register('get-var-request', getVarRequestSchema);
  registry.register('get-var-response', getVarResponseSchema);
  registry.register('get-all-vars-request', getAllVarsRequestSchema);
  registry.register('get-all-vars-response', getAllVarsResponseSchema);
  registry.register('run-action-request', runActionRequestSchema);
  registry.register('run-action-response', runActionResponseSchema);
  registry.register('call-tool-request', callToolRequestSchema);
  registry.register('call-tool-response', callToolResponseSchema);
  registry.register('start-ai-generation-output', startAiGenerationOutputMessageSchema);
  registry.register('send-ai-voice-chunk', sendAiVoiceChunkMessageSchema);
  registry.register('end-ai-generation-output', endAiGenerationOutputMessageSchema);
  registry.register('ai-transcribed-chunk', aiTranscribedChunkMessageSchema);
  registry.register('send-ai-image-output', sendAiImageOutputMessageSchema);
  registry.register('send-ai-audio-output', sendAiAudioOutputMessageSchema);

  // Generate all schemas from the registry
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const openApiDoc = generator.generateComponents();
  
  // Convert OpenAPI-style $refs to JSON Schema-style $refs
  // OpenAPI uses #/components/schemas/... but JSON Schema uses #/definitions/...
  const schemasJson = JSON.stringify(openApiDoc.components?.schemas || {});
  const convertedSchemas = JSON.parse(schemasJson.replace(/#\/components\/schemas\//g, '#/definitions/'));
  
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
        definitions: convertedSchemas,
      },
      null,
      2,
    ),
  );
  console.log(`Generated: ${outputPath}`);

  const schemaCount = Object.keys(convertedSchemas).length;
  console.log(`\n✅ Successfully generated WebSocket contracts schema with ${schemaCount} schema definitions`);
}

// Run the generator
generateWebSocketSchemas();
