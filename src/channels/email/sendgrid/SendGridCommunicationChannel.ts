import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel } from '../../IChannelDescriptor';
import { sendGridChannelProviderConfigSchema } from '../../../services/providers/channel/SendGridChannelProvider';

@singleton()
export class SendGridCommunicationChannel implements ICommunicationChannel {
  getType(): 'sendgrid' { return 'sendgrid'; }
  getName(): string { return 'SendGrid Email'; }
  getConfigSchema(): z.ZodObject<any> { return sendGridChannelProviderConfigSchema; }
  getCapabilities() {
    return {
      supportsVoiceInput: false,
      supportsTextInput: true,
      supportsVoiceOutput: false,
      supportsTextOutput: true,
      supportsCommands: false,
      supportsEvents: false,
      supportsIncomingConnections: true,
      supportsOutgoingConnections: true,
    };
  }
}
