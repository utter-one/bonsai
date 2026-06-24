import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel } from '../../IChannelDescriptor';
import { smtpImapChannelProviderConfigSchema } from '../../../services/providers/channel/SmtpImapChannelProvider';

@singleton()
export class SmtpImapCommunicationChannel implements ICommunicationChannel {
  getType(): 'smtp_imap' {
    return 'smtp_imap';
  }

  getName(): string {
    return 'SMTP/IMAP Email';
  }

  getConfigSchema(): z.ZodObject<any> {
    return smtpImapChannelProviderConfigSchema;
  }

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
