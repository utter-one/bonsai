export * from './types';
export * from './registry';

// Import all handlers to trigger decorator registration
import './auth.handler';
import './startConversation.handler';
import './resumeConversation.handler';
import './endConversation.handler';
import './startUserVoiceInput.handler';
import './sendUserVoiceChunk.handler';
import './endUserVoiceInput.handler';
import './sendUserTextInput.handler';
import './goToStage.handler';
import './setVar.handler';
import './getVar.handler';
import './getAllVars.handler';
import './runAction.handler';
