import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel } from '../../IChannelDescriptor';
import { sesChannelProviderConfigSchema } from '../../../services/providers/channel/SesChannelProvider';

@singleton()
export class SesCommunicationChannel implements ICommunicationChannel {
  getType(): 'ses' { return 'ses'; }
  getName(): string { return 'AWS SES Email'; }
  getConfigSchema(): z.ZodObject<any> { return sesChannelProviderConfigSchema; }
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
